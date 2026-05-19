import { NextRequest, NextResponse } from "next/server";

import type {
  NewStoryMessage,
  StoryCampaign,
  StoryMessage,
} from "@/lib/dm/db";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };
const MAX_CONTENT = 4000;

// POST /api/story/[id]/messages — append a message to the
// conversation log. Body: { role, content }.
//
// Authorization is split between two layers:
//   1. RLS gates membership: only owner / dm_user_id can SELECT
//      the parent campaign or INSERT into story_messages. That's
//      enough to keep non-members out entirely.
//   2. This route additionally restricts which `role` a member
//      can post — only the campaign owner can post 'player'
//      rows; only the DM seat can post 'narrative'. The DB
//      can't see that distinction (one membership policy covers
//      both), so it's enforced here.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  let body: { role?: string; content?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { role, content } = body;
  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT) {
    return NextResponse.json(
      { error: `content too long (max ${MAX_CONTENT})` },
      { status: 400 },
    );
  }
  if (role !== "player" && role !== "narrative") {
    return NextResponse.json(
      { error: "role must be 'player' or 'narrative'" },
      { status: 400 },
    );
  }

  // RLS filters out campaigns the caller isn't a member of, so a
  // null result here means either it doesn't exist or they can't
  // see it. 404 either way.
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
  // Role-action gate: 'player' = campaign owner, 'narrative' = the
  // active DM seat. RLS already proved the caller is one of them;
  // this just maps role → allowed actor.
  if (role === "player" && c.user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (role === "narrative") {
    const allowed =
      (c.dm_kind === "self" && c.user_id === user.id) ||
      (c.dm_kind === "human" && c.dm_user_id === user.id);
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  if (c.status !== "active") {
    return NextResponse.json(
      { error: "campaign is not active" },
      { status: 409 },
    );
  }

  const insert: NewStoryMessage = {
    campaign_id: id,
    role,
    content,
    author_user_id: user.id,
    metadata: { scene_id: c.current_scene_id },
  };

  const { data: inserted, error: insertError } = await supabase
    .from("story_messages")
    .insert(insert)
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Touch the campaign's updated_at so the picker / dashboard
  // surfaces recently-played campaigns first. The story_campaigns
  // touch trigger handles this when we explicitly UPDATE — the
  // world_state assignment is a no-op data-wise but bumps the trigger.
  await supabase
    .from("story_campaigns")
    .update({ world_state: c.world_state })
    .eq("id", id);

  return NextResponse.json(inserted as StoryMessage, { status: 201 });
}
