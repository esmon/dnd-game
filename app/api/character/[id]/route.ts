import { NextRequest, NextResponse } from "next/server";

import { supabase, supabaseAdmin } from "@/lib/supabase";
import type { Character, CharacterUpdate } from "@/lib/db/schema";

type RouteContext = { params: Promise<{ id: string }> };

async function loadOwnedRow(
  id: string,
  sessionId: string,
): Promise<
  | { kind: "ok"; row: Character }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
> {
  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return { kind: "error", message: error.message };
  if (!data) return { kind: "not_found" };

  const row = data as Character;
  if (row.session_id !== sessionId) return { kind: "forbidden" };
  return { kind: "ok", row };
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "missing X-Session-Id" },
      { status: 400 },
    );
  }

  const { id } = await ctx.params;
  const owned = await loadOwnedRow(id, sessionId);
  if (owned.kind === "error") {
    return NextResponse.json({ error: owned.message }, { status: 500 });
  }
  if (owned.kind === "not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (owned.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(owned.row);
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "missing X-Session-Id" },
      { status: 400 },
    );
  }

  const { id } = await ctx.params;
  const body = (await request.json()) as CharacterUpdate;

  const owned = await loadOwnedRow(id, sessionId);
  if (owned.kind === "error") {
    return NextResponse.json({ error: owned.message }, { status: 500 });
  }
  if (owned.kind === "not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (owned.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update: CharacterUpdate = {};
  if (typeof body.current_hp === "number") update.current_hp = body.current_hp;
  if (typeof body.xp === "number") update.xp = body.xp;
  if (typeof body.level === "number") update.level = body.level;
  if (Array.isArray(body.weapons)) update.weapons = body.weapons;

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

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "missing X-Session-Id" },
      { status: 400 },
    );
  }

  const { id } = await ctx.params;

  const owned = await loadOwnedRow(id, sessionId);
  if (owned.kind === "error") {
    return NextResponse.json({ error: owned.message }, { status: 500 });
  }
  if (owned.kind === "not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (owned.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from("characters")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
