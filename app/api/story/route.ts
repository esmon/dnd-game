import { NextRequest, NextResponse } from "next/server";

import { findCampaign } from "@/lib/dm/campaigns";
import type {
  NewStoryCampaign,
  NewStoryMessage,
  NewStoryPlayer,
  StoryCampaign,
  StoryMode,
  StoryPlayerRole,
} from "@/lib/dm/db";
import type { Character } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

// GET /api/story — list the signed-in user's story campaigns
// (newest first). RLS on story_campaigns filters by auth.uid(); we
// rely on it rather than re-filtering in code so a future policy
// change is the single source of truth.
export async function GET() {
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

// POST /api/story — start a new campaign.
// Body: { campaignTemplateId, characterId, mode, dmRole? }.
//   mode 'solo' → dm_kind 'self', status 'active', one player row
//     (the owner's character), first scene's readAloud seeded.
//     Caller redirects straight into play.
//   mode 'coop' → dm_kind 'human', status 'lobby'. No readAloud
//     yet — the story begins when the DM starts it from the lobby.
//     dmRole decides the creator's seat:
//       'dm'     → role 'dm' row (no character), dm_user_id = owner
//       'player' → role 'player' row (their character), DM seat
//                  open (dm_user_id null) for someone to claim.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  let body: {
    characterId?: string;
    campaignTemplateId?: string;
    mode?: StoryMode;
    dmRole?: StoryPlayerRole;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { characterId, campaignTemplateId } = body;
  const mode: StoryMode = body.mode === "coop" ? "coop" : "solo";
  // For coop the creator picks a seat; default to DM if unspecified.
  const dmRole: StoryPlayerRole = body.dmRole === "player" ? "player" : "dm";
  if (!campaignTemplateId) {
    return NextResponse.json(
      { error: "missing campaignTemplateId" },
      { status: 400 },
    );
  }
  // A character is required unless the creator is opening a coop
  // story as the DM (they run the world, no character).
  const needsCharacter = mode === "solo" || dmRole === "player";
  if (needsCharacter && !characterId) {
    return NextResponse.json({ error: "missing characterId" }, { status: 400 });
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

  // Load the full character (for the roster snapshot) when one is
  // needed. characters has no RLS yet — supabaseAdmin + explicit
  // owner check.
  let character: Character | null = null;
  if (needsCharacter && characterId) {
    const { data: charRow, error: charError } = await supabaseAdmin
      .from("characters")
      .select("*")
      .eq("id", characterId)
      .maybeSingle();
    if (charError) {
      return NextResponse.json({ error: charError.message }, { status: 500 });
    }
    if (!charRow) {
      return NextResponse.json(
        { error: "character not found" },
        { status: 404 },
      );
    }
    if ((charRow as Character).user_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    character = charRow as Character;
  }

  const firstScene = template.scenes[0];
  const isCoop = mode === "coop";
  const campaignInsert: NewStoryCampaign = {
    user_id: user.id,
    // Legacy column: keep the owner's character where we have one.
    character_id: character?.id ?? "",
    campaign_template_id: campaignTemplateId,
    current_scene_id: firstScene.id,
    world_state: {},
    mode,
    dm_kind: isCoop ? "human" : "self",
    // Coop-as-DM claims the seat now; coop-as-player leaves it open.
    dm_user_id: isCoop && dmRole === "dm" ? user.id : null,
    status: isCoop ? "lobby" : "active",
  };

  const { data: campaignRow, error: campaignError } = await supabase
    .from("story_campaigns")
    .insert(campaignInsert)
    .select()
    .single();
  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 });
  }
  const campaign = campaignRow as StoryCampaign;

  // Creator's roster row. Solo + coop-as-player bring a character;
  // coop-as-DM takes the dm seat with none.
  const creatorRole: StoryPlayerRole = isCoop ? dmRole : "player";
  const playerInsert: NewStoryPlayer = {
    campaign_id: campaign.id,
    user_id: user.id,
    role: creatorRole,
    character_id: creatorRole === "player" ? (character?.id ?? null) : null,
    character_snapshot: creatorRole === "player" ? character : null,
    // Solo is ready by definition; in a lobby the creator still
    // readies up (the DM's "ready" is implicit via Start, mirroring
    // coop, but we set true to keep the roster tidy).
    is_ready: !isCoop,
    position: 0,
  };
  const { error: playerError } = await supabase
    .from("story_players")
    .insert(playerInsert);
  if (playerError) {
    // Roll back the campaign so we don't orphan it.
    await supabaseAdmin.from("story_campaigns").delete().eq("id", campaign.id);
    return NextResponse.json({ error: playerError.message }, { status: 500 });
  }

  // Solo starts playing immediately, so seed the opening narrative
  // now. Coop waits in the lobby — the start route seeds when the
  // DM kicks off.
  if (!isCoop) {
    const seedMessages: NewStoryMessage[] = firstScene.readAloud.map(
      (content) => ({
        campaign_id: campaign.id,
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
        console.error("story seed messages failed", seedError.message);
      }
    }
  }

  return NextResponse.json(campaign, { status: 201 });
}
