// Build a randomized 5e-faithful encounter spec for a party.
//
// Inputs the party's levels; outputs a difficulty tier, a monster count,
// and a per-monster CR string the caller can hand to dnd5eapi. Combines:
//
//   - Per-character XP thresholds (DMG p.82) for Easy/Medium/Hard/Deadly
//   - Action-economy multiplier by monster count (DMG p.82)
//   - Party-size bump (DMG p.83): 1–2 PCs bump multiplier UP one step,
//     6+ PCs bump it DOWN one step
//   - CR ↔ XP table (DMG / dnd5eapi)
//
// The randomness keeps coop fights from always being "N monsters for N
// players." A duo can roll into a single boss at 1.5× their adjusted
// budget, or a small horde of weaker monsters — both are RAW-legal as
// long as the adjusted XP lands near the chosen difficulty's threshold.

// XP thresholds per character per level — Easy / Medium / Hard / Deadly.
// Source: D&D 5e DMG p.82 "Encounter Building".
const XP_THRESHOLDS: Record<number, [number, number, number, number]> = {
  1: [25, 50, 75, 100],
  2: [50, 100, 150, 200],
  3: [75, 150, 225, 400],
  4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100],
  6: [300, 600, 900, 1400],
  7: [350, 750, 1100, 1700],
  8: [450, 900, 1400, 2100],
  9: [550, 1100, 1600, 2400],
  10: [600, 1200, 1900, 2800],
  11: [800, 1600, 2400, 3600],
  12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100],
  14: [1250, 2500, 3800, 5700],
  15: [1400, 2800, 4300, 6400],
  16: [1600, 3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800],
  18: [2100, 4200, 6300, 9500],
  19: [2400, 4900, 7300, 10900],
  20: [2800, 5700, 8500, 12700],
};

// CR → XP — the official table the dnd5eapi returns on each monster row.
const CR_TO_XP: Array<[string, number]> = [
  ["0", 10],
  ["1/8", 25],
  ["1/4", 50],
  ["1/2", 100],
  ["1", 200],
  ["2", 450],
  ["3", 700],
  ["4", 1100],
  ["5", 1800],
  ["6", 2300],
  ["7", 2900],
  ["8", 3900],
  ["9", 5000],
  ["10", 5900],
  ["11", 7200],
  ["12", 8400],
  ["13", 10000],
  ["14", 11500],
  ["15", 13000],
  ["16", 15000],
  ["17", 18000],
  ["18", 20000],
  ["19", 22000],
  ["20", 25000],
];

// Multiplier steps in DMG order — the party-size bump moves the index up
// or down by one within this list.
const MULTIPLIER_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

export type Difficulty = "easy" | "medium" | "hard" | "deadly";

const DIFFICULTY_INDEX: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
  deadly: 3,
};

function thresholdFor(level: number, difficulty: Difficulty): number {
  const clamped = Math.max(1, Math.min(20, level));
  return XP_THRESHOLDS[clamped][DIFFICULTY_INDEX[difficulty]];
}

// Base multiplier for a given monster count (DMG p.82 table).
function baseMultiplier(monsterCount: number): number {
  if (monsterCount <= 1) return 1;
  if (monsterCount === 2) return 1.5;
  if (monsterCount <= 6) return 2;
  if (monsterCount <= 10) return 2.5;
  if (monsterCount <= 14) return 3;
  return 4;
}

// Adjusted multiplier including the small/large party bump.
export function encounterMultiplier(
  monsterCount: number,
  partySize: number,
): number {
  const base = baseMultiplier(monsterCount);
  const idx = MULTIPLIER_STEPS.indexOf(base);
  if (idx < 0) return base;
  if (partySize <= 2) {
    return MULTIPLIER_STEPS[Math.min(idx + 1, MULTIPLIER_STEPS.length - 1)];
  }
  if (partySize >= 6) {
    return MULTIPLIER_STEPS[Math.max(idx - 1, 0)];
  }
  return base;
}

// Sum the chosen tier's threshold across the party — this is the
// adjusted XP we want the encounter to land near.
export function partyXpBudget(
  playerLevels: number[],
  difficulty: Difficulty,
): number {
  return playerLevels.reduce(
    (sum, l) => sum + thresholdFor(l, difficulty),
    0,
  );
}

// Pick the highest CR whose XP fits the per-monster raw budget. Floors
// rather than rounds — overshooting deadly is worse than undershooting
// it, since a too-hard fight TPKs the party.
export function crStringForXp(perMonsterXp: number): string {
  let pick = CR_TO_XP[0][0];
  for (const [cr, xp] of CR_TO_XP) {
    if (xp <= perMonsterXp) pick = cr;
    else break;
  }
  return pick;
}

// Weighted random — easy/medium dominate, deadly is the rare punishing
// roll. Sums to 100 for readability.
function rollDifficulty(): Difficulty {
  const r = Math.random() * 100;
  if (r < 25) return "easy";
  if (r < 70) return "medium";
  if (r < 95) return "hard";
  return "deadly";
}

// Weighted random — bias toward 1–2 monsters since coop is most fun
// when each foe matters. Larger swarms still possible on bigger rolls.
function rollMonsterCount(): number {
  const r = Math.random() * 100;
  if (r < 40) return 1;
  if (r < 75) return 2;
  if (r < 92) return 3;
  return 4;
}

export interface EncounterSpec {
  difficulty: Difficulty;
  monsterCount: number;
  perMonsterCr: string;
  adjustedXpBudget: number;
}

// Build a random encounter spec for the party. Caller fetches monsters
// from the API at the returned CR (and may need to retry/fall back if
// the API has no rows at that CR).
export function buildEncounterSpec(playerLevels: number[]): EncounterSpec {
  const difficulty = rollDifficulty();
  const monsterCount = rollMonsterCount();
  const adjustedXpBudget = partyXpBudget(playerLevels, difficulty);
  const mult = encounterMultiplier(monsterCount, playerLevels.length);
  const rawBudget = adjustedXpBudget / mult;
  const perMonsterXp = rawBudget / monsterCount;
  return {
    difficulty,
    monsterCount,
    perMonsterCr: crStringForXp(perMonsterXp),
    adjustedXpBudget,
  };
}

// Adjacent CR strings in either direction — used by the caller to widen
// its search if the API has no monsters at the target CR.
export function nearbyCrStrings(cr: string, radius = 2): string[] {
  const idx = CR_TO_XP.findIndex(([c]) => c === cr);
  if (idx < 0) return [cr];
  const out: string[] = [cr];
  for (let r = 1; r <= radius; r++) {
    if (idx - r >= 0) out.push(CR_TO_XP[idx - r][0]);
    if (idx + r < CR_TO_XP.length) out.push(CR_TO_XP[idx + r][0]);
  }
  return out;
}
