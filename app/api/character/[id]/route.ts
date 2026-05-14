import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity, isOwnedBy } from "@/lib/auth/server-identity";
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
  request: NextRequest,
): Promise<
  | { kind: "ok"; row: Character }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
> {
  const identity = await getRequestIdentity(request);
  if (!identity.userId && !identity.sessionId) return { kind: "forbidden" };

  const { data, error } = await supabase
    .from("characters")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return { kind: "error", message: error.message };
  if (!data) return { kind: "not_found" };

  const row = data as Character;
  if (!isOwnedBy(row, identity)) return { kind: "forbidden" };
  return { kind: "ok", row };
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const owned = await loadOwnedRow(id, request);
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
  const { id } = await ctx.params;
  const body = (await request.json()) as CharacterUpdate;

  const owned = await loadOwnedRow(id, request);
  if (owned.kind === "error") {
    return NextResponse.json({ error: owned.message }, { status: 500 });
  }
  if (owned.kind === "not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (owned.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Build the update field-by-field. Validator failures used to reject
  // the entire PATCH; that meant a single malformed legacy spell or
  // consumable in the body would silently 400 every persist tick,
  // taking stats / xp / hp / level down with it. Now we log + skip
  // the offending field so the rest of the update lands.
  const update: CharacterUpdate = {};
  const skipped: string[] = [];

  if (typeof body.current_hp === "number") update.current_hp = body.current_hp;
  if (typeof body.xp === "number") update.xp = body.xp;
  if (typeof body.level === "number") update.level = body.level;
  if (typeof body.max_hp === "number") update.max_hp = body.max_hp;
  if (typeof body.proficiency_bonus === "number") {
    update.proficiency_bonus = body.proficiency_bonus;
  }
  if (isAbilityScores(body.ability_scores)) {
    update.ability_scores = body.ability_scores;
  } else if (body.ability_scores !== undefined) {
    skipped.push("ability_scores");
  }

  if (body.weapons !== undefined) {
    if (isWeaponArray(body.weapons)) update.weapons = body.weapons;
    else skipped.push("weapons");
  }
  if (body.inventory !== undefined) {
    if (isWeaponArray(body.inventory)) update.inventory = body.inventory;
    else skipped.push("inventory");
  }
  // Subset check only meaningful when both sides survived validation.
  if (
    update.weapons !== undefined &&
    update.inventory !== undefined &&
    !weaponsAreSubsetById(update.weapons, update.inventory)
  ) {
    delete update.weapons;
    delete update.inventory;
    skipped.push("weapons+inventory(subset)");
  }

  if (body.known_spells !== undefined) {
    if (isSpellArray(body.known_spells)) update.known_spells = body.known_spells;
    else skipped.push("known_spells");
  }
  if (body.equipped_spells !== undefined) {
    if (isSpellArray(body.equipped_spells)) {
      update.equipped_spells = body.equipped_spells;
    } else {
      skipped.push("equipped_spells");
    }
  }
  if (update.equipped_spells !== undefined) {
    const known = update.known_spells ?? owned.row.known_spells ?? [];
    if (!spellsAreSubsetById(update.equipped_spells, known)) {
      delete update.equipped_spells;
      skipped.push("equipped_spells(subset)");
    }
  }
  if (body.spell_slots !== undefined) {
    if (isSpellSlots(body.spell_slots)) update.spell_slots = body.spell_slots;
    else skipped.push("spell_slots");
  }
  if (body.consumables !== undefined) {
    if (isConsumableArray(body.consumables)) {
      update.consumables = body.consumables;
    } else {
      skipped.push("consumables");
    }
  }
  if (body.equipped_armor !== undefined) {
    update.equipped_armor = body.equipped_armor;
  }
  if (body.equipped_shield !== undefined) {
    update.equipped_shield = body.equipped_shield;
  }
  if (body.armor_inventory !== undefined) {
    update.armor_inventory = body.armor_inventory;
  }
  if (typeof body.wins === "number") update.wins = body.wins;
  if (typeof body.losses === "number") update.losses = body.losses;
  if (typeof body.runaways === "number") update.runaways = body.runaways;

  if (skipped.length > 0) {
    console.warn(
      `[PATCH /character/${id}] skipped malformed fields:`,
      skipped.join(", "),
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

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  const owned = await loadOwnedRow(id, request);
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
