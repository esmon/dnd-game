import { NextRequest, NextResponse } from "next/server";

import { findCampaign } from "@/lib/dm/campaigns";
import type {
  NewStoryMessage,
  StoryCampaign,
  StoryCampaignStatus,
  StoryMessage,
} from "@/lib/dm/db";
import { broadcastStoryUpdate } from "@/lib/dm/realtime";
import { FAILURE_END, SUCCESS_END } from "@/lib/dm/types";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/story/[id]/advance — move the campaign to the next
// scene (or end it). Body: { to: string } where `to` matches a
// transition on the current scene — either a sibling scene id or
// one of the two conclusion markers (`conclusion:success` /
// `conclusion:failure`).
//
// Side effects:
//   * On scene → scene: update current_scene_id; auto-publish the
//     new scene's readAloud as narrative messages.
//   * On scene → conclusion:*: flip status to completed_success or
//     completed_failure; auto-publish the conclusion text as a
//     narrative message. current_scene_id stays at the last live
//     scene so we can still render the DM notes panel if needed.
//
// Authorization: RLS on the SELECT + INSERT + UPDATE gates the
// caller. Role-action gate (only the active DM seat can advance)
// runs in TS since RLS only covers membership.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  let body: { to?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { to } = body;
  if (typeof to !== "string" || to.length === 0) {
    return NextResponse.json({ error: "missing target scene" }, { status: 400 });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("story_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const c = campaign as StoryCampaign;
  // Only the active DM seat can advance the story.
  const isDm =
    (c.dm_kind === "self" && c.user_id === user.id) ||
    (c.dm_kind === "human" && c.dm_user_id === user.id) ||
    c.dm_kind === "ai"; // future: workflow drives this server-side
  if (!isDm) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (c.status !== "active") {
    return NextResponse.json(
      { error: "campaign is not active" },
      { status: 409 },
    );
  }

  const template = findCampaign(c.campaign_template_id);
  if (!template) {
    return NextResponse.json(
      { error: `unknown campaign template: ${c.campaign_template_id}` },
      { status: 500 },
    );
  }
  const currentScene = template.scenes.find((s) => s.id === c.current_scene_id);
  if (!currentScene) {
    return NextResponse.json(
      { error: `current scene not in template: ${c.current_scene_id}` },
      { status: 500 },
    );
  }

  // The target must be one of the current scene's declared
  // transitions. Stops a bad client from jumping to arbitrary
  // scenes / forcing a conclusion.
  const transition = currentScene.transitions.find((t) => t.to === to);
  if (!transition) {
    return NextResponse.json(
      { error: `no transition to ${to} from ${currentScene.id}` },
      { status: 400 },
    );
  }

  // Conclusion branch.
  if (to === SUCCESS_END || to === FAILURE_END) {
    const newStatus: StoryCampaignStatus =
      to === SUCCESS_END ? "completed_success" : "completed_failure";
    const closingText =
      to === SUCCESS_END
        ? template.conclusion.success
        : template.conclusion.failure;

    const { error: updateError } = await supabase
      .from("story_campaigns")
      .update({ status: newStatus })
      .eq("id", id);
    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }

    const closingMessage: NewStoryMessage = {
      campaign_id: id,
      role: "narrative",
      content: closingText,
      author_user_id: null,
      metadata: {
        scene_id: c.current_scene_id,
        kind: "conclusion",
        outcome: to,
      },
    };
    const { data: insertedClosing, error: insertError } = await supabase
      .from("story_messages")
      .insert(closingMessage)
      .select()
      .single();
    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 },
      );
    }

    await broadcastStoryUpdate(id);
    return NextResponse.json({
      campaign: { ...c, status: newStatus } satisfies StoryCampaign,
      newMessages: [insertedClosing as StoryMessage],
    });
  }

  // Normal scene transition.
  const nextScene = template.scenes.find((s) => s.id === to);
  if (!nextScene) {
    return NextResponse.json(
      { error: `target scene not in template: ${to}` },
      { status: 500 },
    );
  }

  const { error: updateError } = await supabase
    .from("story_campaigns")
    .update({ current_scene_id: nextScene.id })
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Seed the new scene's readAloud the same way campaign create
  // does — one row per passage so they render as distinct beats.
  const seedMessages: NewStoryMessage[] = nextScene.readAloud.map(
    (content) => ({
      campaign_id: id,
      role: "narrative",
      content,
      author_user_id: null,
      metadata: { scene_id: nextScene.id, kind: "scene_opening" },
    }),
  );

  let inserted: StoryMessage[] = [];
  if (seedMessages.length > 0) {
    const { data: rows, error: insertError } = await supabase
      .from("story_messages")
      .insert(seedMessages)
      .select();
    if (insertError) {
      // Non-fatal: scene moved; the player can read the script in
      // the DM notes panel if it didn't auto-publish.
      console.error("scene seed messages failed", insertError.message);
    } else {
      inserted = (rows ?? []) as StoryMessage[];
    }
  }

  await broadcastStoryUpdate(id);
  return NextResponse.json({
    campaign: {
      ...c,
      current_scene_id: nextScene.id,
    } satisfies StoryCampaign,
    newMessages: inserted,
  });
}
