import { NextRequest, NextResponse } from "next/server";

import type { StoryPlayer } from "@/lib/dm/db";
import { broadcastStoryUpdate } from "@/lib/dm/realtime";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/story/[id]/player — update the caller's own roster
// row in the lobby. Body: { ready?: boolean }. RLS's update policy
// already restricts a player to their own row (auth.uid() =
// user_id), so we don't re-check ownership beyond resolving which
// row to touch.
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  let body: { ready?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (typeof body.ready !== "boolean") {
    return NextResponse.json({ error: "ready must be a boolean" }, {
      status: 400,
    });
  }

  const { data: updated, error } = await supabase
    .from("story_players")
    .update({ is_ready: body.ready })
    .eq("campaign_id", id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "you are not in this story" },
      { status: 404 },
    );
  }

  // Ping the lobby so the DM (and other players) see the ready
  // badge flip without waiting on their poll tick.
  await broadcastStoryUpdate(id);

  return NextResponse.json(updated as StoryPlayer);
}
