// Roll dice notation like "2d6", "1d4", "1d8+2", "2d6 + 1".
// Unparseable input returns 1 so combat keeps flowing rather than crashing
// on a weird statblock.

export function rollDice(notation: string): number {
  if (!notation) return 1;

  // Strip whitespace, normalize.
  const cleaned = notation.replace(/\s+/g, "").toLowerCase();

  // Match NdM with an optional +K or -K modifier.
  const match = cleaned.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) return 1;

  const numberOfDice = Math.max(1, parseInt(match[1], 10));
  const sides = Math.max(1, parseInt(match[2], 10));
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  let total = 0;
  for (let i = 0; i < numberOfDice; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  total += modifier;

  return Math.max(0, total);
}

// Random integer in [min, max] inclusive.
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
