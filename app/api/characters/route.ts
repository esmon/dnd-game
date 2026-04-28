import { NextRequest, NextResponse } from "next/server";

import { supabase, supabaseAdmin } from "@/lib/supabase";
import type {
  AbilityScores,
  Character,
  NewCharacter,
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

export async function GET(request: NextRequest) {
  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "missing X-Session-Id" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []) as Character[]);
}

export async function POST(request: NextRequest) {
  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "missing X-Session-Id" },
      { status: 400 },
    );
  }

  const body = (await request.json()) as Partial<NewCharacter>;

  if (
    typeof body.name !== "string" ||
    body.name.trim().length === 0 ||
    !isAbilityScores(body.ability_scores) ||
    typeof body.max_hp !== "number" ||
    body.max_hp <= 0
  ) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (!isWeaponArray(body.weapons)) {
    return NextResponse.json(
      { error: "invalid weapons: expected Weapon[]" },
      { status: 400 },
    );
  }
  if (!isWeaponArray(body.inventory)) {
    return NextResponse.json(
      { error: "invalid inventory: expected Weapon[]" },
      { status: 400 },
    );
  }
  if (!weaponsAreSubsetById(body.weapons, body.inventory)) {
    return NextResponse.json(
      { error: "every equipped weapon id must exist in inventory" },
      { status: 400 },
    );
  }

  const insert: NewCharacter = {
    session_id: sessionId,
    name: body.name,
    race: body.race ?? "",
    subrace: body.subrace ?? null,
    class: body.class ?? "",
    subclass: body.subclass ?? null,
    background: body.background ?? "",
    alignment: body.alignment ?? "",
    level: body.level ?? 1,
    xp: body.xp ?? 0,
    ability_scores: body.ability_scores,
    max_hp: body.max_hp,
    current_hp: body.current_hp ?? body.max_hp,
    proficiency_bonus: body.proficiency_bonus ?? 2,
    weapons: body.weapons,
    inventory: body.inventory,
    avatar_url: body.avatar_url ?? null,
  };

  if (
    insert.race === "" ||
    insert.class === "" ||
    insert.background === "" ||
    insert.alignment === ""
  ) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("characters")
    .insert(insert)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data as Character, { status: 201 });
}
