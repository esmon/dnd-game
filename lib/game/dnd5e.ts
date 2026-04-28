import type { Monster, MonsterIndex } from "./types";

// /api/2014/ is the current path; the bare /api/monsters route 301-redirects.
const API_BASE = "https://www.dnd5eapi.co/api/2014";
const IMAGE_BASE = "https://www.dnd5eapi.co";

const CR_QUERY = "challenge_rating=0&challenge_rating=0.125&challenge_rating=0.25";

type RawMonsterIndex = { index: string; name: string; url?: string };

type RawMonsterAction = {
  name?: string;
  damage?: Array<{
    damage_dice?: string;
    damage_type?: { name?: string };
  }>;
};

type RawMonster = {
  index: string;
  name: string;
  hit_points: number;
  hit_dice: string;
  xp: number;
  image?: string | null;
  actions?: RawMonsterAction[];
};

export async function fetchMonsterIndexList(): Promise<MonsterIndex[]> {
  const url = `${API_BASE}/monsters/?${CR_QUERY}`;
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

// Pull the first action's first damage die out of the statblock. Some monsters
// (e.g. Awakened Shrub) have no actions; fall back to hit_dice so combat can
// continue with something sensible rather than crashing.
function pickDamageDice(raw: RawMonster): string {
  const action = raw.actions?.find((a) => a.damage && a.damage.length > 0);
  const dice = action?.damage?.[0]?.damage_dice;
  if (dice && /\d+d\d+/.test(dice)) return dice;
  return raw.hit_dice || "1d4";
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

  return {
    index: data.index,
    name: data.name,
    avatar: data.image ? `${IMAGE_BASE}${data.image}` : null,
    maxHealth: data.hit_points,
    health: data.hit_points,
    xp: data.xp,
    damageDice: pickDamageDice(data),
  };
}
