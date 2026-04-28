export const MAX_LEVEL = 20;

// XP_TABLE[level] = cumulative XP needed to BE at that level. Index 0 unused.
export const XP_TABLE: readonly number[] = [
  0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000,
  64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

export const ASI_LEVELS: readonly number[] = [4, 8, 12, 16, 19];

export function xpThresholdForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > MAX_LEVEL) return XP_TABLE[MAX_LEVEL];
  return XP_TABLE[level];
}

export function levelForXp(xp: number): number {
  let level = 1;
  for (let l = MAX_LEVEL; l >= 1; l--) {
    if (xp >= XP_TABLE[l]) {
      level = l;
      break;
    }
  }
  return Math.min(level, MAX_LEVEL);
}

export function xpProgressInLevel(
  xp: number,
  level: number,
): { inLevel: number; needed: number } {
  if (level >= MAX_LEVEL) {
    return { inLevel: 0, needed: 0 };
  }
  const floor = xpThresholdForLevel(level);
  const ceil = xpThresholdForLevel(level + 1);
  const inLevel = Math.max(0, xp - floor);
  const needed = Math.max(0, ceil - floor);
  return { inLevel, needed };
}

export function hpGainOnLevelUp(hitDie: number, conMod: number): number {
  return Math.floor(hitDie / 2) + 1 + conMod;
}

export function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor((level - 1) / 4);
}

export function isAsiLevel(level: number): boolean {
  return ASI_LEVELS.includes(level);
}
