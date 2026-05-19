import { NextRequest, NextResponse } from "next/server";

import { findCampaign } from "@/lib/dm/campaigns";
import type {
  NewStoryCampaign,
  NewStoryMessage,
  StoryCampaign,
} from "@/lib/dm/db";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

// GET /api/story — list the signed-in user's story campaigns
// (newest first). RLS on story_campaigns filters by auth.uid(); we
// rely on it rather than re-filtering in code so a future policy
// change is the single source of truth.
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("story_campaigns")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []) as StoryCampaign[]);
}

// POST /api/story — start a new campaign. Body: { characterId,
// campaignTemplateId }. Validates the template exists in the
// registry, looks up the character (no RLS on characters yet —
// uses supabaseAdmin + explicit owner check), then INSERTs the
// campaign + seed messages via the SSR client so RLS's INSERT
// policies enforce ownership at the DB layer.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  let body: { characterId?: string; campaignTemplateId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { characterId, campaignTemplateId } = body;
  if (!characterId || !campaignTemplateId) {
    return NextResponse.json(
      { error: "missing characterId or campaignTemplateId" },
      { status: 400 },
    );
  }

  const template = findCampaign(campaignTemplateId);
  if (!template) {
    return NextResponse.json(
      { error: `unknown campaign template: ${campaignTemplateId}` },
      { status: 400 },
    );
  }
  if (template.scenes.length === 0) {
    return NextResponse.json(
      { error: "campaign template has no scenes" },
      { status: 500 },
    );
  }

  // Verify the character belongs to the caller. characters has no
  // RLS yet — supabaseAdmin + explicit check until that gap closes.
  const { data: charRow, error: charError } = await supabaseAdmin
    .from("characters")
    .select("id, user_id")
    .eq("id", characterId)
    .maybeSingle();
  if (charError) {
    return NextResponse.json({ error: charError.message }, { status: 500 });
  }
  if (!charRow) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }
  if (charRow.user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const firstScene = template.scenes[0];
  const campaignInsert: NewStoryCampaign = {
    user_id: user.id,
    character_id: characterId,
    campaign_template_id: campaignTemplateId,
    current_scene_id: firstScene.id,
    world_state: {},
    dm_kind: "self",
    dm_user_id: null,
    status: "active",
  };

  const { data: campaign, error: campaignError } = await supabase
    .from("story_campaigns")
    .insert(campaignInsert)
    .select()
    .single();

  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 });
  }

  // Seed the first scene's readAloud passages as opening narrative.
  // One row per passage so the UI can render them as distinct beats.
  // RLS's INSERT policy gates these on the parent campaign's
  // ownership — auth.uid() must match c.user_id or c.dm_user_id.
  const seedMessages: NewStoryMessage[] = firstScene.readAloud.map(
    (content) => ({
      campaign_id: (campaign as StoryCampaign).id,
      role: "narrative",
      content,
      author_user_id: null,
      metadata: { scene_id: firstScene.id, kind: "scene_opening" },
    }),
  );
  if (seedMessages.length > 0) {
    const { error: seedError } = await supabase
      .from("story_messages")
      .insert(seedMessages);
    if (seedError) {
      // Non-fatal — campaign exists, opening can be re-derived if
      // needed. Log and continue so we don't leave the caller without
      // a campaign id to navigate to.
      console.error("story seed messages failed", seedError.message);
    }
  }

  return NextResponse.json(campaign as StoryCampaign, { status: 201 });
}
