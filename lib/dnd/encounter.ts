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

// Each level gets a CR floor + ceiling — a narrow band of "appropriate
// challenge" monsters. At L20 a player should not be fighting CR 0 shrubs.
const LEVEL_TO_CR_BAND: Record<number, [number, number]> = {
  1: [0, 0.25],
  2: [0, 0.5],
  3: [0.125, 1],
  4: [0.25, 2],
  5: [0.5, 3],
  6: [1, 4],
  7: [2, 5],
  8: [3, 6],
  9: [4, 7],
  10: [5, 8],
  11: [6, 10],
  12: [7, 11],
  13: [8, 12],
  14: [9, 14],
  15: [10, 15],
  16: [11, 16],
  17: [12, 17],
  18: [13, 18],
  19: [14, 19],
  20: [15, 20],
};

function bandForLevel(level: number): [number, number] {
  if (level < 1) return LEVEL_TO_CR_BAND[1];
  if (level > 20) return LEVEL_TO_CR_BAND[20];
  return LEVEL_TO_CR_BAND[level];
}

export function minCrForLevel(level: number): number {
  return bandForLevel(level)[0];
}

export function maxCrForLevel(level: number): number {
  return bandForLevel(level)[1];
}

export function crsForLevel(level: number): string[] {
  const [floor, ceiling] = bandForLevel(level);
  const result: string[] = [];
  for (const s of ALL_CR_STRINGS) {
    const n = crStringToNumber(s);
    if (n >= floor && n <= ceiling) {
      result.push(s);
    }
  }
  return result;
}
