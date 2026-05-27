import { NextRequest, NextResponse } from "next/server";

import { findCampaign } from "@/lib/dm/campaigns";
import type {
  NewStoryMessage,
  StoryCampaign,
  StoryMessage,
} from "@/lib/dm/db";
import { broadcastStoryUpdate } from "@/lib/dm/realtime";
import { FAILURE_END } from "@/lib/dm/types";
import type { Campaign } from "@/lib/coop/types";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/story/[id]/combat/end — called by the story page after
// it observes the linked coop campaign reach `finished`. Posts an
// outcome system message into the story log, clears
// active_combat_campaign_id so the locked dialog can close on
// subsequent loads, and returns the closing message.
//
// Idempotent on retry: if there's no active combat (already
// resolved), returns 200 with no message. The dialog might fire
// this twice in a flaky network — we don't want the second call to
// 4xx and confuse the UI.
//
// Authorization: SSR client + RLS gates story membership; we still
// check the caller is the active DM seat (story owner / human DM)
// in TS because RLS only enforces membership.
export async function POST(_request: NextRequest, ctx: RouteContext) {
  const { id: storyId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  const { data: storyRow, error: storyError } = await supabase
    .from("story_campaigns")
    .select("*")
    .eq("id", storyId)
    .maybeSingle();
  if (storyError) {
    return NextResponse.json({ error: storyError.message }, { status: 500 });
  }
  if (!storyRow) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const story = storyRow as StoryCampaign;
  const isDm =
    (story.dm_kind === "self" && story.user_id === user.id) ||
    (story.dm_kind === "human" && story.dm_user_id === user.id) ||
    story.dm_kind === "ai";
  if (!isDm) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Already cleared — no-op success so retries don't 409.
  if (!story.active_combat_campaign_id) {
    return NextResponse.json({ ok: true, alreadyCleared: true });
  }

  // Coop tables already have RLS that allows campaign members to
  // read. The story owner is the campaign creator, so the SSR
  // client can read this row.
  const { data: combatRow, error: combatError } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", story.active_combat_campaign_id)
    .maybeSingle();
  if (combatError) {
    return NextResponse.json(
      { error: combatError.message },
      { status: 500 },
    );
  }
  if (!combatRow) {
    // The coop row was deleted (cascade GC? manual cleanup?). Clear
    // the stale pointer and report success so the UI unsticks.
    await supabase
      .from("story_campaigns")
      .update({ active_combat_campaign_id: null })
      .eq("id", storyId);
    return NextResponse.json({ ok: true, alreadyCleared: true });
  }

  const combat = combatRow as Campaign;
  if (combat.status !== "finished" && combat.status !== "between_encounters") {
    // Combat is still live — caller is wrong to be ending it.
    return NextResponse.json(
      { error: "combat is still active" },
      { status: 409 },
    );
  }

  // Map coop outcomes to story-log copy. 'between_encounters' only
  // exists for multi-encounter coop runs; for our single-encounter
  // story combats it shouldn't normally appear, but treat it as a
  // win for safety (the encounter cleared, the player survived).
  let content: string;
  let outcome: "won" | "lost" | "fled";
  if (combat.status === "between_encounters") {
    outcome = "won";
    content = "The encounter is over. You catch your breath.";
  } else if (combat.outcome === "won") {
    outcome = "won";
    content = "Victory. The encounter is over.";
  } else if (combat.outcome === "lost") {
    outcome = "lost";
    content = "Defeat. You fall.";
  } else {
    // Outcome is null on a forfeit/run-away. The coop forfeit route
    // sets status='finished' + outcome=null; treat as fled.
    outcome = "fled";
    content = "You disengage and slip away.";
  }

  const insert: NewStoryMessage = {
    campaign_id: storyId,
    role: "system",
    content,
    author_user_id: user.id,
    metadata: {
      scene_id: story.current_scene_id,
      kind: "encounter_resolved",
      combat_campaign_id: combat.id,
      outcome,
    },
  };

  // Insert the outcome message + clear the pointer atomically-ish:
  // both updates target story_campaigns / story_messages which have
  // RLS allowing the owner. If the insert fails we don't clear, so
  // a retry can post the message.
  const { data: inserted, error: insertError } = await supabase
    .from("story_messages")
    .insert(insert)
    .select()
    .single();
  if (insertError) {
    return NextResponse.json(
      { error: insertError.message },
      { status: 500 },
    );
  }

  const { error: clearError } = await supabase
    .from("story_campaigns")
    .update({ active_combat_campaign_id: null })
    .eq("id", storyId);
  if (clearError) {
    // The closing message already landed — log and continue. The
    // pointer will be cleared on the next /combat/end retry (which
    // is idempotent above).
    console.error("clear active_combat_campaign_id failed", clearError.message);
  }

  // A lost fight ends the run. Without this the scene stayed active
  // and the player just saw the same actions again. Conclude to the
  // failure ending: flip status + post the campaign's failure copy
  // (same shape as advancing to FAILURE_END).
  if (outcome === "lost") {
    const template = findCampaign(story.campaign_template_id);
    const { error: failError } = await supabase
      .from("story_campaigns")
      .update({ status: "completed_failure" })
      .eq("id", storyId);
    if (failError) {
      console.error("conclude-on-loss status update failed", failError.message);
    } else if (template) {
      const conclusion: NewStoryMessage = {
        campaign_id: storyId,
        role: "narrative",
        content: template.conclusion.failure,
        author_user_id: null,
        metadata: {
          scene_id: story.current_scene_id,
          kind: "conclusion",
          outcome: FAILURE_END,
        },
      };
      const { error: concludeError } = await supabase
        .from("story_messages")
        .insert(conclusion);
      if (concludeError) {
        console.error("conclude-on-loss message failed", concludeError.message);
      }
    }
  }

  // Best-effort: delete the coop campaign now that it's resolved.
  // Keeps the campaigns table from accumulating one-shot rows.
  // Non-blocking — if it fails the campaign sits orphaned but the
  // story carries on.
  void supabaseAdmin
    .from("campaigns")
    .delete()
    .eq("id", combat.id)
    .then(({ error }) => {
      if (error) {
        console.error("combat campaign GC failed", error.message);
      }
    });

  // Fight resolved — clear the locked dialog on every member's page
  // and surface the outcome message + updated HP/XP/loot.
  await broadcastStoryUpdate(storyId);

  return NextResponse.json({
    ok: true,
    outcome,
    message: inserted as StoryMessage,
  });
}
