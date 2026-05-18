import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity, isOwnedBy } from "@/lib/auth/server-identity";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import type { Character } from "@/lib/db/schema";

// Scalar character sync. The main PATCH route runs validators against
// every shaped field (weapons, spells, consumables) and any single
// malformed legacy item could drop the whole update on the floor —
// including primitives like level / xp / current_hp. Even with the
// non-fatal validator fix in place, this route is the durable path
// for the small set of integer fields that drive game progression
// and counters. The client fires it on every persist tick alongside
// the main PATCH so these fields always land.
//
// Limited to integer scalars on purpose: no validators, no
// possibility of a single bad field blocking another. Negative
// values are clamped out so a buggy reducer can't accidentally
// regress someone to a negative HP / XP / level.

type RouteContext = { params: Promise<{ id: string }> };
type ScalarBody = {
  wins?: unknown;
  losses?: unknown;
  runaways?: unknown;
  level?: unknown;
  xp?: unknown;
  current_hp?: unknown;
  max_hp?: unknown;
  proficiency_bonus?: unknown;
};

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

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

  let body: ScalarBody;
  try {
    body = (await request.json()) as ScalarBody;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const update: {
    wins?: number;
    losses?: number;
    runaways?: number;
    level?: number;
    xp?: number;
    current_hp?: number;
    max_hp?: number;
    proficiency_bonus?: number;
  } = {};
  if (isNonNegativeInt(body.wins)) update.wins = body.wins;
  if (isNonNegativeInt(body.losses)) update.losses = body.losses;
  if (isNonNegativeInt(body.runaways)) update.runaways = body.runaways;
  if (isNonNegativeInt(body.level)) update.level = body.level;
  if (isNonNegativeInt(body.xp)) update.xp = body.xp;
  if (isNonNegativeInt(body.current_hp)) update.current_hp = body.current_hp;
  if (isNonNegativeInt(body.max_hp)) update.max_hp = body.max_hp;
  if (isNonNegativeInt(body.proficiency_bonus)) {
    update.proficiency_bonus = body.proficiency_bonus;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "no valid scalar fields" },
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
