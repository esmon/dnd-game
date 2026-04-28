import { NextRequest, NextResponse } from "next/server";

import { supabase, supabaseAdmin } from "@/lib/supabase";
import type {
  AbilityScores,
  Character,
  CharacterUpdate,
} from "@/lib/db/schema";
import type { Weapon } from "@/lib/game/types";

const ABILITY_KEYS: ReadonlyArray<keyof AbilityScores> = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
];

function isAbilityScores(v: unknown): v is AbilityScores {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return ABILITY_KEYS.every((k) => typeof o[k] === "number");
}

function isWeapon(v: unknown): v is Weapon {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.baseId === "string" &&
    typeof o.name === "string" &&
    typeof o.damage === "string" &&
    typeof o.bonus === "number"
  );
}

function isWeaponArray(v: unknown): v is Weapon[] {
  return Array.isArray(v) && v.every(isWeapon);
}

function weaponsAreSubsetById(
  equipped: Weapon[],
  inventory: Weapon[],
): boolean {
  const ids = new Set(inventory.map((w) => w.id));
  return equipped.every((w) => ids.has(w.id));
}

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

  if (body.weapons !== undefined && !isWeaponArray(body.weapons)) {
    return NextResponse.json(
      { error: "invalid weapons: expected Weapon[]" },
      { status: 400 },
    );
  }
  if (body.inventory !== undefined && !isWeaponArray(body.inventory)) {
    return NextResponse.json(
      { error: "invalid inventory: expected Weapon[]" },
      { status: 400 },
    );
  }
  if (
    body.weapons !== undefined &&
    body.inventory !== undefined &&
    !weaponsAreSubsetById(body.weapons, body.inventory)
  ) {
    return NextResponse.json(
      { error: "every equipped weapon id must exist in inventory" },
      { status: 400 },
    );
  }

  const update: CharacterUpdate = {};
  if (typeof body.current_hp === "number") update.current_hp = body.current_hp;
  if (typeof body.xp === "number") update.xp = body.xp;
  if (typeof body.level === "number") update.level = body.level;
  if (body.weapons !== undefined) update.weapons = body.weapons;
  if (body.inventory !== undefined) update.inventory = body.inventory;
  if (typeof body.max_hp === "number") update.max_hp = body.max_hp;
  if (typeof body.proficiency_bonus === "number") {
    update.proficiency_bonus = body.proficiency_bonus;
  }
  if (isAbilityScores(body.ability_scores)) {
    update.ability_scores = body.ability_scores;
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
