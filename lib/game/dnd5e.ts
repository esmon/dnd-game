import { crsForLevel } from "@/lib/dnd/encounter";
import type { Monster, MonsterIndex } from "./types";

// /api/2014/ is the current path; the bare /api/monsters route 301-redirects.
const API_BASE = "https://www.dnd5eapi.co/api/2014";
const IMAGE_BASE = "https://www.dnd5eapi.co";

// dnd5eapi expects fractional CRs as decimals in the query string.
function crToQueryValue(cr: string): string {
  if (cr === "1/8") return "0.125";
  if (cr === "1/4") return "0.25";
  if (cr === "1/2") return "0.5";
  return cr;
}

type RawMonsterIndex = { index: string; name: string; url?: string };

type RawMonsterDamage = {
  damage_dice?: string;
  damage_type?: { name?: string };
};

type RawMonsterAction = {
  name?: string;
  attack_bonus?: number;
  damage?: RawMonsterDamage[];
};

type RawMonsterAc =
  | number
  | Array<{ value?: number; type?: string }>
  | undefined;

type RawMonster = {
  index: string;
  name: string;
  hit_points: number;
  hit_dice: string;
  xp: number;
  challenge_rating?: number;
  image?: string | null;
  actions?: RawMonsterAction[];
  armor_class?: RawMonsterAc;
  damage_resistances?: string[];
  damage_immunities?: string[];
  damage_vulnerabilities?: string[];
  dexterity?: number;
};

export function pickRandomMonsterIndex(
  indices: MonsterIndex[],
): MonsterIndex | null {
  if (indices.length === 0) return null;
  return indices[Math.floor(Math.random() * indices.length)];
}

export async function fetchMonsterIndexList(level: number): Promise<MonsterIndex[]> {
  return fetchMonsterIndexListByCrs(crsForLevel(level));
}

export async function fetchMonsterIndexListByCrs(
  crs: string[],
): Promise<MonsterIndex[]> {
  if (crs.length === 0) return [];
  const query = crs
    .map((c) => `challenge_rating=${crToQueryValue(c)}`)
    .join("&");
  const url = `${API_BASE}/monsters/?${query}`;
  const res = await fetch(url, {
    // Cache the index list for an hour — it never really changes.
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`dnd5eapi index list failed: ${res.status}`);
  }
  const data = (await res.json()) as { results?: RawMonsterIndex[] };
  const results = data.results ?? [];
  return results.map((r) => ({ index: r.index, name: r.name }));
}

// Estimate "biggest" damage by max die value (NdM → N*M). Avoids needing to
// roll just to compare actions.
function diceMax(dice: string): number {
  const m = dice.match(/^(\d+)d(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * parseInt(m[2], 10);
}

type PickedAction = {
  damageDice: string;
  attackBonus: number;
  damageType: string;
};

function pickPrimaryAction(raw: RawMonster): PickedAction {
  let best: PickedAction | null = null;
  for (const a of raw.actions ?? []) {
    const d = a.damage?.[0];
    const dice = d?.damage_dice;
    if (!dice || !/\d+d\d+/.test(dice)) continue;
    const candidate: PickedAction = {
      damageDice: dice,
      attackBonus: typeof a.attack_bonus === "number" ? a.attack_bonus : 0,
      damageType: (d?.damage_type?.name ?? "bludgeoning").toLowerCase(),
    };
    if (!best || diceMax(candidate.damageDice) > diceMax(best.damageDice)) {
      best = candidate;
    }
  }
  if (best) return best;
  // Fallback: monsters like Awakened Shrub have no actions.
  return {
    damageDice: raw.hit_dice || "1d4",
    attackBonus: 0,
    damageType: "bludgeoning",
  };
}

function parseAc(raw: RawMonsterAc): number {
  if (typeof raw === "number") return raw;
  if (Array.isArray(raw) && raw.length > 0) {
    const v = raw[0]?.value;
    if (typeof v === "number") return v;
  }
  return 10;
}

function lower(list: string[] | undefined): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((s) => s.toLowerCase());
}

export async function fetchMonster(index: string): Promise<Monster> {
  const url = `${API_BASE}/monsters/${index}`;
  const res = await fetch(url, {
    // 24h is fine — the monster sheets are static reference data.
    next: { revalidate: 86400 },
  });
  if (!res.ok) {
    throw new Error(`dnd5eapi monster ${index} failed: ${res.status}`);
  }
  const data = (await res.json()) as RawMonster;
  const action = pickPrimaryAction(data);

  return {
    index: data.index,
    name: data.name,
    avatar: data.image ? `${IMAGE_BASE}${data.image}` : null,
    maxHealth: data.hit_points,
    health: data.hit_points,
    xp: data.xp,
    damageDice: action.damageDice,
    challengeRating: typeof data.challenge_rating === "number"
      ? data.challenge_rating
      : 0,
    ac: parseAc(data.armor_class),
    attackBonus: action.attackBonus,
    damageType: action.damageType,
    damageResistances: lower(data.damage_resistances),
    damageVulnerabilities: lower(data.damage_vulnerabilities),
    damageImmunities: lower(data.damage_immunities),
    dexterity: typeof data.dexterity === "number" ? data.dexterity : 10,
  };
}
