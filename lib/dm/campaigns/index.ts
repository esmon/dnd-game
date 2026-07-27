import type { Campaign } from "../types";

import { GOBLIN_WARRENS } from "./goblin-warrens";
import { HAUNTED_MANOR } from "./haunted-manor";
import { WYRMS_HOLLOW } from "./wyrms-hollow";

// Bundled campaign library. Ordered by recommendedLevel so the
// campaign picker shows them in the natural progression a character
// would play through. Add new entries here (alongside the file
// import) and they appear in the picker automatically.
export const CAMPAIGNS: readonly Campaign[] = [
  GOBLIN_WARRENS,
  HAUNTED_MANOR,
  WYRMS_HOLLOW,
];

export const campaignsById: Record<string, Campaign> = CAMPAIGNS.reduce(
  (acc, c) => {
    acc[c.id] = c;
    return acc;
  },
  {} as Record<string, Campaign>,
);

export function findCampaign(id: string): Campaign | null {
  return campaignsById[id] ?? null;
}
