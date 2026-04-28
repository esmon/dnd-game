export const ALL_CR_STRINGS: readonly string[] = [
  "0",
  "1/8",
  "1/4",
  "1/2",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
];

const CR_STRING_TO_NUMBER: Record<string, number> = {
  "0": 0,
  "1/8": 0.125,
  "1/4": 0.25,
  "1/2": 0.5,
};

function crStringToNumber(s: string): number {
  if (s in CR_STRING_TO_NUMBER) return CR_STRING_TO_NUMBER[s];
  return Number(s);
}

const LEVEL_TO_MAX_CR: Record<number, number> = {
  1: 0.25,
  2: 0.5,
  3: 1,
  4: 2,
  5: 3,
  6: 4,
  7: 5,
  8: 6,
  9: 7,
  10: 8,
  11: 10,
  12: 11,
  13: 12,
  14: 14,
  15: 15,
  16: 16,
  17: 17,
  18: 18,
  19: 19,
  20: 20,
};

export function maxCrForLevel(level: number): number {
  if (level < 1) return LEVEL_TO_MAX_CR[1];
  if (level > 20) return LEVEL_TO_MAX_CR[20];
  return LEVEL_TO_MAX_CR[level];
}

export function crsForLevel(level: number): string[] {
  const ceiling = maxCrForLevel(level);
  // Always keep low-CR variety so the pool isn't only deadly fights at high level.
  const baseline = new Set<string>(["0", "1/8", "1/4"]);
  const result: string[] = [];
  for (const s of ALL_CR_STRINGS) {
    if (baseline.has(s) || crStringToNumber(s) <= ceiling) {
      result.push(s);
    }
  }
  return result;
}
