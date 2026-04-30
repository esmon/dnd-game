import type { CampaignPlayer } from "./types";

// Monster targeting policy. Pre-M9b monsters picked uniformly at
// random from alive players, which felt flat — wounded teammates
// rarely got finished off, so coop fights had no save-the-other-PC
// drama. M9b weights pick probability inversely to current HP ratio:
// a full-HP player has weight 1, a 0%-HP (downed) player would have
// weight 4, half-HP is ~2.5. Still random, but aggressive attention
// on the most-bloodied target.

export function pickMonsterTarget(
  alivePlayers: CampaignPlayer[],
): CampaignPlayer | null {
  if (alivePlayers.length === 0) return null;
  if (alivePlayers.length === 1) return alivePlayers[0];

  const weights = alivePlayers.map((p) => {
    const max = Math.max(1, p.character_snapshot.max_hp);
    const ratio = Math.max(0, Math.min(1, p.current_hp / max));
    // Linear from 1.0 at full HP to 4.0 at 0 HP. Tweakable; the
    // 1× base keeps full-HP players still gettable.
    return 1 + (1 - ratio) * 3;
  });

  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < alivePlayers.length; i++) {
    r -= weights[i];
    if (r <= 0) return alivePlayers[i];
  }
  return alivePlayers[alivePlayers.length - 1];
}
