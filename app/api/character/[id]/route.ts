import { NextRequest, NextResponse } from "next/server";

import { supabase, supabaseAdmin } from "@/lib/supabase";
import type {
  AbilityScores,
  Character,
  CharacterUpdate,
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
    typeof o.bonus === "number" &&
    (o.damageType === "slashing" ||
      o.damageType === "piercing" ||
      o.damageType === "bludgeoning")
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

  if (body.known_spells !== undefined && !isSpellArray(body.known_spells)) {
    return NextResponse.json(
      { error: "invalid known_spells: expected Spell[]" },
      { status: 400 },
    );
  }
  if (
    body.equipped_spells !== undefined &&
    !isSpellArray(body.equipped_spells)
  ) {
    return NextResponse.json(
      { error: "invalid equipped_spells: expected Spell[]" },
      { status: 400 },
    );
  }
  if (body.spell_slots !== undefined && !isSpellSlots(body.spell_slots)) {
    return NextResponse.json(
      { error: "invalid spell_slots: expected Record<string, number>" },
      { status: 400 },
    );
  }
  if (body.consumables !== undefined && !isConsumableArray(body.consumables)) {
    return NextResponse.json(
      { error: "invalid consumables: expected Consumable[]" },
      { status: 400 },
    );
  }
  // When both arrive together, equipped must be a subset by id of known.
  // When only equipped arrives, validate against the row's existing known_spells.
  if (body.equipped_spells !== undefined) {
    const known =
      body.known_spells !== undefined
        ? body.known_spells
        : (owned.row.known_spells ?? []);
    if (!spellsAreSubsetById(body.equipped_spells, known)) {
      return NextResponse.json(
        { error: "every equipped spell id must exist in known_spells" },
        { status: 400 },
      );
    }
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
  if (body.known_spells !== undefined) update.known_spells = body.known_spells;
  if (body.equipped_spells !== undefined) {
    update.equipped_spells = body.equipped_spells;
  }
  if (body.spell_slots !== undefined) update.spell_slots = body.spell_slots;
  if (body.consumables !== undefined) update.consumables = body.consumables;

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
