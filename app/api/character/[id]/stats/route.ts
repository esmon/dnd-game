import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity, isOwnedBy } from "@/lib/auth/server-identity";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import type { Character } from "@/lib/db/schema";

// Dedicated stats sync. The main PATCH route runs validators against
// every shaped field in the body; a single malformed legacy spell or
// consumable used to drop the whole update on the floor — wins /
// losses / runaways included. That's been made non-fatal, but stats
// are simple integers and don't need to ride on the validity of
// anything else, so they get their own route. The client fires this
// in addition to the main PATCH so the counters always land even if
// future regressions break the bigger payload.

type RouteContext = { params: Promise<{ id: string }> };
type StatsBody = { wins?: unknown; losses?: unknown; runaways?: unknown };

export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  const identity = await getRequestIdentity(request);
  if (!identity.userId && !identity.sessionId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Ownership check uses the read-only client (same pattern as the
  // main PATCH) so RLS still gates who sees what.
  const { data: rowData, error: rowError } = await supabase
    .from("characters")
    .select("id, user_id, session_id")
    .eq("id", id)
    .maybeSingle();
  if (rowError) {
    return NextResponse.json({ error: rowError.message }, { status: 500 });
  }
  if (!rowData) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!isOwnedBy(rowData, identity)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: StatsBody;
  try {
    body = (await request.json()) as StatsBody;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const update: { wins?: number; losses?: number; runaways?: number } = {};
  if (typeof body.wins === "number" && body.wins >= 0) update.wins = body.wins;
  if (typeof body.losses === "number" && body.losses >= 0) {
    update.losses = body.losses;
  }
  if (typeof body.runaways === "number" && body.runaways >= 0) {
    update.runaways = body.runaways;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "no valid stats fields" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("characters")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data as Character);
}
