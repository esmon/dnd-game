import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import type {
  NewStoryMessage,
  StoryCampaign,
  StoryMessage,
} from "@/lib/dm/db";
import { supabase, supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };
const MAX_CONTENT = 4000;

// POST /api/story/[id]/messages — append a message to the
// conversation log. Body: { role, content }. For Phase 0 the
// player posts 'player' rows; future phases will add 'narrative'
// (DM-authored) and 'tool' (DM-triggered actions). We let the
// caller specify the role but gate which roles a given identity
// can post: 'player' for the campaign owner, 'narrative' for
// dm_user_id (Phase 1), 'tool' / 'system' are server-only for now.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { userId } = await getRequestIdentity(request);
  if (!userId) {
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
  // Role-based gate: 'player' = campaign owner, 'narrative' = the
  // DM seat (whoever's running it). For dm_kind='self' the owner
  // is both, which is fine.
  if (role === "player" && c.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (role === "narrative") {
    const allowed =
      (c.dm_kind === "self" && c.user_id === userId) ||
      (c.dm_kind === "human" && c.dm_user_id === userId);
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
    author_user_id: userId,
    metadata: { scene_id: c.current_scene_id },
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("story_messages")
    .insert(insert)
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Touch the campaign's updated_at so the picker / dashboard
  // surfaces recently-played campaigns first. The story_campaigns
  // touch trigger handles this when we explicitly UPDATE.
  await supabaseAdmin
    .from("story_campaigns")
    .update({ world_state: c.world_state })
    .eq("id", id);

  return NextResponse.json(inserted as StoryMessage, { status: 201 });
}
