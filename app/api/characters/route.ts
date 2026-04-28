import { NextRequest, NextResponse } from "next/server";

import { supabase, supabaseAdmin } from "@/lib/supabase";
import type {
  AbilityScores,
  Character,
  NewCharacter,
} from "@/lib/db/schema";
import type { Consumable, Spell, Weapon } from "@/lib/game/types";

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

function isSpell(v: unknown): v is Spell {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.baseId === "string" &&
    typeof o.name === "string" &&
    typeof o.level === "number" &&
    typeof o.damage === "string" &&
    typeof o.damageType === "string" &&
    typeof o.school === "string"
  );
}

function isSpellArray(v: unknown): v is Spell[] {
  return Array.isArray(v) && v.every(isSpell);
}

function isConsumable(v: unknown): v is Consumable {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.kind === "scroll") {
    return (
      typeof o.id === "string" &&
      typeof o.spellName === "string" &&
      typeof o.spellLevel === "number" &&
      typeof o.damage === "string" &&
      typeof o.damageType === "string"
    );
  }
  if (o.kind === "potion") {
    return (
      typeof o.id === "string" &&
      typeof o.baseId === "string" &&
      typeof o.name === "string" &&
      typeof o.healDice === "string" &&
      typeof o.rarity === "string"
    );
  }
  return false;
}

function isConsumableArray(v: unknown): v is Consumable[] {
  return Array.isArray(v) && v.every(isConsumable);
}

function isSpellSlots(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (n) => typeof n === "number",
  );
}

function weaponsAreSubsetById(
  equipped: Weapon[],
  inventory: Weapon[],
): boolean {
  const ids = new Set(inventory.map((w) => w.id));
  return equipped.every((w) => ids.has(w.id));
}

function spellsAreSubsetById(equipped: Spell[], known: Spell[]): boolean {
  const ids = new Set(known.map((s) => s.id));
  return equipped.every((s) => ids.has(s.id));
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

  const knownSpells = body.known_spells ?? [];
  const equippedSpells = body.equipped_spells ?? [];
  const spellSlots = body.spell_slots ?? {};
  const consumables = body.consumables ?? [];

  if (!isSpellArray(knownSpells)) {
    return NextResponse.json(
      { error: "invalid known_spells: expected Spell[]" },
      { status: 400 },
    );
  }
  if (!isSpellArray(equippedSpells)) {
    return NextResponse.json(
      { error: "invalid equipped_spells: expected Spell[]" },
      { status: 400 },
    );
  }
  if (!isSpellSlots(spellSlots)) {
    return NextResponse.json(
      { error: "invalid spell_slots: expected Record<string, number>" },
      { status: 400 },
    );
  }
  if (!isConsumableArray(consumables)) {
    return NextResponse.json(
      { error: "invalid consumables: expected Consumable[]" },
      { status: 400 },
    );
  }
  if (!spellsAreSubsetById(equippedSpells, knownSpells)) {
    return NextResponse.json(
      { error: "every equipped spell id must exist in known_spells" },
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
    known_spells: knownSpells,
    equipped_spells: equippedSpells,
    spell_slots: spellSlots,
    consumables,
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
