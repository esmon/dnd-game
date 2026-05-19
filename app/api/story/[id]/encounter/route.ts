import { NextRequest, NextResponse } from "next/server";

import { findCampaign } from "@/lib/dm/campaigns";
import type {
  NewStoryMessage,
  StoryCampaign,
  StoryMessage,
} from "@/lib/dm/db";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/story/[id]/encounter — fire the "an encounter begins"
// beat into the story log. Body: { monsterIndex, count?, intent? }.
// Validates that the named encounter actually belongs to the
// current scene so a stray client can't spawn arbitrary fights.
//
// This is the DM-tool surface that AI / arena integration will
// build on:
//   - For now: posts a single system message ("⚔ Encounter — 3
//     goblins. Roll initiative.") that the DM follows up with
//     narration. The fight itself is roleplayed in messages.
//   - Next phase: launching an actual arena combat instance keyed
//     to this campaign + encounter, with the outcome posted back as
//     a follow-up message. The shape of this route doesn't need to
//     change for that — `encounter_started` becomes the trigger
//     event a follow-up `encounter_resolved` matches against.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  let body: { monsterIndex?: string; count?: number; intent?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { monsterIndex, count, intent } = body;
  if (typeof monsterIndex !== "string" || monsterIndex.length === 0) {
    return NextResponse.json(
      { error: "missing monsterIndex" },
      { status: 400 },
    );
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
  // Only the active DM can trigger encounters — same gate the
  // advance route uses. RLS already covered membership.
  const isDm =
    (c.dm_kind === "self" && c.user_id === user.id) ||
    (c.dm_kind === "human" && c.dm_user_id === user.id) ||
    c.dm_kind === "ai";
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

  // Match by monsterIndex (+ count if provided) so the DM can only
  // trigger encounters declared on the current scene. Stops a bad
  // client from spawning arbitrary fights.
  const declared = currentScene.scripted.encounters ?? [];
  const matching = declared.find(
    (e) =>
      e.monsterIndex === monsterIndex &&
      (count === undefined || e.count === count),
  );
  if (!matching) {
    return NextResponse.json(
      {
        error: `no matching encounter on scene "${currentScene.id}" for ${monsterIndex}`,
      },
      { status: 400 },
    );
  }

  const summaryCount =
    typeof matching.count === "number" && matching.count > 1
      ? `${matching.count} × ${matching.monsterIndex}`
      : matching.monsterIndex;
  const intentNote = matching.intent ?? intent ?? null;
  const content = intentNote
    ? `⚔ Encounter — ${summaryCount}. ${intentNote}`
    : `⚔ Encounter — ${summaryCount}.`;

  const insert: NewStoryMessage = {
    campaign_id: id,
    role: "system",
    content,
    author_user_id: user.id,
    metadata: {
      scene_id: currentScene.id,
      kind: "encounter_started",
      monsterIndex: matching.monsterIndex,
      count: matching.count ?? 1,
      intent: matching.intent ?? null,
      trigger: matching.trigger,
    },
  };

  const { data: inserted, error: insertError } = await supabase
    .from("story_messages")
    .insert(insert)
    .select()
    .single();
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(inserted as StoryMessage, { status: 201 });
}
