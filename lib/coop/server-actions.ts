// Server-side resolution for the campaign action types. Each resolver
// reads the acting player + campaign state, returns the patch to apply
// (action row + monster updates + player snapshot patch). The route
// applies the patch and walks the monster chain afterwards.
//
// Mirrors the solo arena's PLAYER_ATTACK / CAST_SPELL / SMITE_ATTACK
// reducer paths, but rolls dice on the server so co-op is cheating-
// resistant. Damage math reuses lib/dnd/combat + class-features
// unchanged.

import {
  applyDamageMultiplier,
  damageMultiplier,
  rollAttack,
  weaponAttackAbility,
} from "@/lib/dnd/combat";
import { computeWeaponAttackDamage } from "@/lib/dnd/class-features";
import { findClass } from "@/lib/dnd/classes";
import { abilityModifier } from "@/lib/dnd/derive";
import { findLowestSlot } from "@/lib/dnd/spells";
import { rollDice } from "@/lib/game/dice";
import type { Character } from "@/lib/db/schema";
import type {
  Consumable,
  Monster,
  Potion,
  Scroll,
  Spell,
  Weapon,
} from "@/lib/game/types";
import type { CampaignPlayer } from "@/lib/coop/types";

export type AttackBody = {
  kind: "attack";
  weaponId: string;
  targetMonsterIndex: number;
};

export type SpellBody = {
  kind: "spell";
  spellId: string;
  targetMonsterIndex: number;
};

export type ScrollBody = {
  kind: "scroll";
  scrollId: string;
  targetMonsterIndex: number;
};

export type HealBody = { kind: "heal" };

export type PotionBody = { kind: "potion"; potionId: string };

export type SkipBody = { kind: "skip" };

export type ActionBody =
  | AttackBody
  | SpellBody
  | ScrollBody
  | HealBody
  | PotionBody
  | SkipBody;

// Result of a player-side resolver. The route applies these mutations
// before walking the monster chain.
export type Resolution =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      // Action row to insert (turn_number is filled in by the caller).
      action: {
        actor_kind: "player";
        actor_player_id: string;
        target_kind: "player" | "monster" | null;
        target_player_id: string | null;
        target_monster_index: number | null;
        kind: string;
        payload: Record<string, unknown>;
      };
      // Monster pool replacement (full new array). Resolver returns the
      // unchanged array when no monster damage was dealt.
      monsters: Monster[];
      // Optional snapshot replacement for the actor (e.g. consumed slot
      // / consumable). When present, the route writes it back to
      // campaign_players.character_snapshot.
      snapshotPatch?: Character;
      // Optional player HP delta (e.g. heal / potion). Applied to the
      // actor's row.
      currentHpPatch?: number;
    };

// Helper: load a weapon from the player's snapshot by id (frozen
// inventory at join time, so the lookup is O(weapons.length) and
// always small).
function findWeapon(snapshot: Character, weaponId: string): Weapon | null {
  return snapshot.weapons.find((w) => w.id === weaponId) ?? null;
}

function findSpell(snapshot: Character, spellId: string): Spell | null {
  return snapshot.equipped_spells.find((s) => s.id === spellId) ?? null;
}

function findScroll(snapshot: Character, scrollId: string): Scroll | null {
  return (
    snapshot.consumables.find(
      (c): c is Scroll => c.kind === "scroll" && c.id === scrollId,
    ) ?? null
  );
}

function findPotion(snapshot: Character, potionId: string): Potion | null {
  return (
    snapshot.consumables.find(
      (c): c is Potion => c.kind === "potion" && c.id === potionId,
    ) ?? null
  );
}

function consumeConsumable(
  consumables: Consumable[],
  id: string,
): Consumable[] {
  // Remove only the first match — duplicates of the same item all share
  // ids in our schema only by accident, but be defensive.
  let removed = false;
  return consumables.filter((c) => {
    if (removed) return true;
    if (c.id === id) {
      removed = true;
      return false;
    }
    return true;
  });
}

export function resolveAttack(
  body: AttackBody,
  player: CampaignPlayer,
  monsters: Monster[],
): Resolution {
  const weapon = findWeapon(player.character_snapshot, body.weaponId);
  if (!weapon) {
    return { ok: false, status: 400, error: "weapon not found" };
  }
  if (
    body.targetMonsterIndex < 0 ||
    body.targetMonsterIndex >= monsters.length
  ) {
    return { ok: false, status: 400, error: "target out of range" };
  }
  const target = monsters[body.targetMonsterIndex];
  if (target.health <= 0) {
    return { ok: false, status: 409, error: "target already dead" };
  }

  const ability = weaponAttackAbility(
    weapon,
    player.character_snapshot.ability_scores,
  );
  const attackMod =
    abilityModifier(player.character_snapshot.ability_scores[ability]) +
    player.character_snapshot.proficiency_bonus;
  const attack = rollAttack(attackMod, target.ac);

  let damage = 0;
  let damageNote = "";
  if (attack.hit) {
    const raw = computeWeaponAttackDamage(
      player.character_snapshot.class,
      player.character_snapshot.level,
      weapon.damage,
      attack.crit,
    );
    const m = damageMultiplier(
      weapon.damageType,
      target.damageResistances,
      target.damageImmunities,
      target.damageVulnerabilities,
    );
    damage = applyDamageMultiplier(raw, m);
    damageNote = m.label;
  }

  const newMonsters = monsters.map((mon, i) =>
    i === body.targetMonsterIndex
      ? { ...mon, health: Math.max(0, mon.health - damage) }
      : mon,
  );

  return {
    ok: true,
    action: {
      actor_kind: "player",
      actor_player_id: player.id,
      target_kind: "monster",
      target_player_id: null,
      target_monster_index: body.targetMonsterIndex,
      kind: "attack",
      payload: {
        actor_name: player.character_snapshot.name,
        target_name: target.name,
        weapon_name: weapon.name,
        damage_type: weapon.damageType,
        damage,
        d20: attack.d20,
        hit: attack.hit,
        crit: attack.crit,
        missed: !attack.hit,
        note: damageNote,
      },
    },
    monsters: newMonsters,
  };
}

// Spells use the spellcasting ability mod + proficiency bonus as the
// attack modifier (collapsing 5e's spell-attack vs save dichotomy
// into one path, matching what solo does).
export function resolveSpell(
  body: SpellBody,
  player: CampaignPlayer,
  monsters: Monster[],
): Resolution {
  const spell = findSpell(player.character_snapshot, body.spellId);
  if (!spell) {
    return { ok: false, status: 400, error: "spell not found / not equipped" };
  }

  // AoE spells: skip the target index check, hit every alive monster
  // with one damage roll, then apply each monster's per-type
  // resistance multiplier so a fire-immune monster takes 0 from
  // Fireball even when the rest of the room melts.
  if (spell.aoe) {
    const aliveIndices = monsters
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.health > 0);
    if (aliveIndices.length === 0) {
      return { ok: false, status: 409, error: "no living targets" };
    }

    let snapshot = player.character_snapshot;
    if (spell.level > 0) {
      const remaining = snapshot.spell_slots[String(spell.level)] ?? 0;
      if (remaining <= 0) {
        return {
          ok: false,
          status: 409,
          error: `out of L${spell.level} spell slots`,
        };
      }
      snapshot = {
        ...snapshot,
        spell_slots: {
          ...snapshot.spell_slots,
          [String(spell.level)]: remaining - 1,
        },
      };
    }

    // Roll once; every monster takes the same raw damage modulated
    // by their resistance (per 5e RAW each target rolls a save, but
    // we're skipping saves for now — full damage as the simple MVP).
    const raw = rollDice(spell.damage);
    const targets = aliveIndices.map(({ m, i }) => {
      const mult = damageMultiplier(
        spell.damageType,
        m.damageResistances,
        m.damageImmunities,
        m.damageVulnerabilities,
      );
      const dmg = applyDamageMultiplier(raw, mult);
      return {
        monster_index: i,
        name: m.name,
        damage: dmg,
        note: mult.label,
      };
    });

    const damageByIndex = new Map<number, number>();
    for (const t of targets) damageByIndex.set(t.monster_index, t.damage);
    const newMonsters = monsters.map((mon, i) => {
      const dmg = damageByIndex.get(i);
      if (dmg === undefined) return mon;
      return { ...mon, health: Math.max(0, mon.health - dmg) };
    });

    return {
      ok: true,
      action: {
        actor_kind: "player",
        actor_player_id: player.id,
        // Stamp the first hit on the column so existing single-target
        // consumers still see *something* sensible; AoE-aware code
        // walks payload.targets for the full picture.
        target_kind: "monster",
        target_player_id: null,
        target_monster_index: targets[0].monster_index,
        kind: "spell",
        payload: {
          actor_name: snapshot.name,
          spell_name: spell.name,
          spell_level: spell.level,
          damage_type: spell.damageType,
          aoe: true,
          targets,
        },
      },
      monsters: newMonsters,
      snapshotPatch: snapshot,
    };
  }

  if (
    body.targetMonsterIndex < 0 ||
    body.targetMonsterIndex >= monsters.length
  ) {
    return { ok: false, status: 400, error: "target out of range" };
  }
  const target = monsters[body.targetMonsterIndex];
  if (target.health <= 0) {
    return { ok: false, status: 409, error: "target already dead" };
  }

  // Slot accounting (skip for cantrips at level 0).
  let snapshot = player.character_snapshot;
  if (spell.level > 0) {
    const remaining = snapshot.spell_slots[String(spell.level)] ?? 0;
    if (remaining <= 0) {
      return {
        ok: false,
        status: 409,
        error: `out of L${spell.level} spell slots`,
      };
    }
    snapshot = {
      ...snapshot,
      spell_slots: {
        ...snapshot.spell_slots,
        [String(spell.level)]: remaining - 1,
      },
    };
  }

  const klass = findClass(snapshot.class);
  const ability = klass?.spellcastingAbility ?? "int";
  const attackMod =
    abilityModifier(snapshot.ability_scores[ability]) +
    snapshot.proficiency_bonus;
  const attack = rollAttack(attackMod, target.ac);

  let damage = 0;
  let damageNote = "";
  if (attack.hit) {
    const raw =
      rollDice(spell.damage) + (attack.crit ? rollDice(spell.damage) : 0);
    const m = damageMultiplier(
      spell.damageType,
      target.damageResistances,
      target.damageImmunities,
      target.damageVulnerabilities,
    );
    damage = applyDamageMultiplier(raw, m);
    damageNote = m.label;
  }

  const newMonsters = monsters.map((mon, i) =>
    i === body.targetMonsterIndex
      ? { ...mon, health: Math.max(0, mon.health - damage) }
      : mon,
  );

  return {
    ok: true,
    action: {
      actor_kind: "player",
      actor_player_id: player.id,
      target_kind: "monster",
      target_player_id: null,
      target_monster_index: body.targetMonsterIndex,
      kind: "spell",
      payload: {
        actor_name: snapshot.name,
        target_name: target.name,
        spell_name: spell.name,
        spell_level: spell.level,
        damage_type: spell.damageType,
        damage,
        d20: attack.d20,
        hit: attack.hit,
        crit: attack.crit,
        missed: !attack.hit,
        note: damageNote,
      },
    },
    monsters: newMonsters,
    snapshotPatch: snapshot,
  };
}

// Scrolls are one-shot spell-attacks: no slot cost, item is consumed
// regardless of hit/miss (matches 5e convention that the casting
// resolves either way).
export function resolveScroll(
  body: ScrollBody,
  player: CampaignPlayer,
  monsters: Monster[],
): Resolution {
  const scroll = findScroll(player.character_snapshot, body.scrollId);
  if (!scroll) {
    return { ok: false, status: 400, error: "scroll not found" };
  }
  if (
    body.targetMonsterIndex < 0 ||
    body.targetMonsterIndex >= monsters.length
  ) {
    return { ok: false, status: 400, error: "target out of range" };
  }
  const target = monsters[body.targetMonsterIndex];
  if (target.health <= 0) {
    return { ok: false, status: 409, error: "target already dead" };
  }

  const klass = findClass(player.character_snapshot.class);
  // Non-casters fall back to INT for scroll attacks (matches solo).
  const ability = klass?.spellcastingAbility ?? "int";
  const attackMod =
    abilityModifier(player.character_snapshot.ability_scores[ability]) +
    player.character_snapshot.proficiency_bonus;
  const attack = rollAttack(attackMod, target.ac);

  let damage = 0;
  let damageNote = "";
  if (attack.hit) {
    const raw =
      rollDice(scroll.damage) + (attack.crit ? rollDice(scroll.damage) : 0);
    const m = damageMultiplier(
      scroll.damageType,
      target.damageResistances,
      target.damageImmunities,
      target.damageVulnerabilities,
    );
    damage = applyDamageMultiplier(raw, m);
    damageNote = m.label;
  }

  const newMonsters = monsters.map((mon, i) =>
    i === body.targetMonsterIndex
      ? { ...mon, health: Math.max(0, mon.health - damage) }
      : mon,
  );
  const snapshot: Character = {
    ...player.character_snapshot,
    consumables: consumeConsumable(
      player.character_snapshot.consumables,
      body.scrollId,
    ),
  };

  return {
    ok: true,
    action: {
      actor_kind: "player",
      actor_player_id: player.id,
      target_kind: "monster",
      target_player_id: null,
      target_monster_index: body.targetMonsterIndex,
      kind: "scroll",
      payload: {
        actor_name: snapshot.name,
        target_name: target.name,
        spell_name: scroll.spellName,
        damage_type: scroll.damageType,
        damage,
        d20: attack.d20,
        hit: attack.hit,
        crit: attack.crit,
        missed: !attack.hit,
        note: damageNote,
      },
    },
    monsters: newMonsters,
    snapshotPatch: snapshot,
  };
}

// In-combat self-heal. Only available to classes with
// canSelfHealInCombat (Cleric / Druid / Bard / Paladin / Ranger /
// Fighter), at or above their healMinLevel, and consumes a spell slot
// when healCostsSlot. Rolls 1d10; clamped to maxHealth.
export function resolveHeal(player: CampaignPlayer): Resolution {
  const klass = findClass(player.character_snapshot.class);
  if (!klass?.canSelfHealInCombat) {
    return { ok: false, status: 409, error: "class can't self-heal in combat" };
  }
  if (player.character_snapshot.level < (klass.healMinLevel ?? 1)) {
    return {
      ok: false,
      status: 409,
      error: `heal unlocks at level ${klass.healMinLevel ?? 1}`,
    };
  }
  if (player.current_hp >= player.character_snapshot.max_hp) {
    return { ok: false, status: 409, error: "already at full HP" };
  }

  let snapshot = player.character_snapshot;
  let slotLevel: number | null = null;
  if (klass.healCostsSlot) {
    const lowest = findLowestSlot(snapshot.spell_slots);
    if (!lowest) {
      return { ok: false, status: 409, error: "out of spell slots" };
    }
    slotLevel = lowest.level;
    snapshot = {
      ...snapshot,
      spell_slots: {
        ...snapshot.spell_slots,
        [String(lowest.level)]: lowest.remaining - 1,
      },
    };
  }

  const amount = rollDice("1d10");
  const newHp = Math.min(snapshot.max_hp, player.current_hp + amount);

  return {
    ok: true,
    action: {
      actor_kind: "player",
      actor_player_id: player.id,
      target_kind: "player",
      target_player_id: player.id,
      target_monster_index: null,
      kind: "heal",
      payload: {
        actor_name: snapshot.name,
        target_name: snapshot.name,
        amount,
        slot_level: slotLevel,
      },
    },
    monsters: [],
    snapshotPatch: snapshot,
    currentHpPatch: newHp,
  };
}

// Potions are pure consumables — no slot cost, no class gating. Heal
// for the rolled dice; consume the item.
export function resolvePotion(
  body: PotionBody,
  player: CampaignPlayer,
): Resolution {
  const potion = findPotion(player.character_snapshot, body.potionId);
  if (!potion) {
    return { ok: false, status: 400, error: "potion not found" };
  }
  if (player.current_hp >= player.character_snapshot.max_hp) {
    return { ok: false, status: 409, error: "already at full HP" };
  }

  const amount = rollDice(potion.healDice);
  const newHp = Math.min(
    player.character_snapshot.max_hp,
    player.current_hp + amount,
  );
  const snapshot: Character = {
    ...player.character_snapshot,
    consumables: consumeConsumable(
      player.character_snapshot.consumables,
      body.potionId,
    ),
  };

  return {
    ok: true,
    action: {
      actor_kind: "player",
      actor_player_id: player.id,
      target_kind: "player",
      target_player_id: player.id,
      target_monster_index: null,
      kind: "potion",
      payload: {
        actor_name: snapshot.name,
        target_name: snapshot.name,
        potion_name: potion.name,
        amount,
      },
    },
    monsters: [],
    snapshotPatch: snapshot,
    currentHpPatch: newHp,
  };
}

export function resolveSkip(player: CampaignPlayer): Resolution {
  return {
    ok: true,
    action: {
      actor_kind: "player",
      actor_player_id: player.id,
      target_kind: null,
      target_player_id: null,
      target_monster_index: null,
      kind: "skip",
      payload: { actor_name: player.character_snapshot.name },
    },
    monsters: [],
  };
}

// Top-level dispatcher. The route hands us the parsed body + player +
// current monster pool; we return whichever sub-resolver matches.
export function resolvePlayerAction(
  body: ActionBody,
  player: CampaignPlayer,
  monsters: Monster[],
): Resolution {
  switch (body.kind) {
    case "attack":
      return resolveAttack(body, player, monsters);
    case "spell":
      return resolveSpell(body, player, monsters);
    case "scroll":
      return resolveScroll(body, player, monsters);
    case "heal":
      return resolveHeal(player);
    case "potion":
      return resolvePotion(body, player);
    case "skip":
      return resolveSkip(player);
  }
}
