// Story Mode campaign schema. A campaign is the data a DM (human or
// AI) follows to run a short adventure. The same shape serves both
// modes — human DMs see this as a cheat sheet with quick-action
// buttons, the AI DM gets it injected as system context.
//
// Authoring convention: keep scenes tight (~20–30 minutes of play
// each), use plain language in `readAloud` blocks the DM can publish
// verbatim, and reference monsters / loot by their existing catalog
// ids so the engine can hand off to the arena reducer for combat.

import type { DamageType } from "@/lib/game/types";

export type CampaignTone =
  | "gothic-horror"
  | "pulp-action"
  | "high-fantasy"
  | "grim-survival";

export type CampaignDifficulty = "low" | "mid" | "high";

export type Campaign = {
  id: string;
  title: string;
  // Single-sentence pitch shown in the campaign picker. Player-facing.
  premise: string;
  // The "what's actually going on" the DM understands but the
  // players don't — antagonist motivation, hidden lore, twist.
  // Surfaced in the DM's notes panel only.
  dmBriefing: string;
  recommendedLevel: [number, number];
  difficulty: CampaignDifficulty;
  tone: CampaignTone;
  // Recurring NPCs the scenes reference. Keyed by id so a scene can
  // point at one ("npc:elara") without duplicating the sheet.
  npcs: NpcSheet[];
  // Ordered list. Transitions reference scene ids, so branching is
  // possible (scene A can lead to B or C); a linear campaign just
  // has one `to` per scene.
  scenes: Scene[];
  // Read-aloud beats for the two terminal outcomes. The DM (or AI)
  // narrates one of these when a scene's transition resolves to a
  // `conclusion:*` target.
  conclusion: {
    success: string;
    failure: string;
  };
};

export type NpcSheet = {
  id: string;
  name: string;
  role: "ally" | "enemy" | "neutral" | "patron";
  appearance: string;
  personality: string;
  motivation: string;
  // Optional voice notes for AI DM — first-person speech cues.
  voice?: string;
};

export type Scene = {
  id: string;
  title: string;
  // DM-only context for *this* scene. Differs from dmBriefing
  // (campaign-wide) by being scene-local: what's in the room, why
  // it's there, what the NPCs are doing right now.
  dmBackground: string;
  // Each entry is a separate boxed-text passage the DM can publish
  // verbatim. Splitting into multiple lets the DM pace the reveal
  // ("first they see X, then if they look closer Y").
  readAloud: string[];
  // Encounters + rewards + free-form notes. All optional — pure
  // narrative scenes have none.
  scripted: {
    encounters?: Encounter[];
    rewards?: Reward[];
    notes?: string[];
  };
  // How the scene ends. Branching scenes have multiple. Conditions
  // are human-readable ("if players defeat the wight"); the DM
  // judges when one fires. AI DM evaluates with LLM judgment.
  transitions: Transition[];
};

export type Encounter = {
  // dnd5eapi index slug — must match an entry the monster API
  // returns so the arena can fetch the full sheet at trigger time.
  monsterIndex: string;
  // Optional override of the displayed count (e.g. "4 goblins"
  // instead of one). Combat itself is 1v1 in arena today; in coop
  // this maps to the per-encounter monster array.
  count?: number;
  // When this encounter triggers. Human-readable: "if the players
  // enter the cave", "ambush as they descend the stairs".
  trigger: string;
  // Bias the encounter intent for the DM ("ambush from cover",
  // "boss confrontation", "skill challenge with combat fallback").
  intent?: string;
};

export type Reward =
  | { kind: "weapon"; baseId: string; bonus?: 0 | 1 | 2 | 3; note?: string }
  | { kind: "armor"; baseId: string; bonus?: 0 | 1 | 2 | 3; note?: string }
  | { kind: "potion"; baseId: string; note?: string }
  | {
      kind: "scroll";
      spellBaseId: string;
      damageType?: DamageType | string;
      note?: string;
    }
  | { kind: "xp"; amount: number; note?: string }
  | { kind: "story"; description: string };

export type Transition = {
  // Either a scene id from the same campaign, or one of the two
  // terminal markers `conclusion:success` / `conclusion:failure`.
  to: string;
  // Human-readable trigger condition the DM (or AI) judges against.
  when: string;
};

// Helper for the campaign registry — narrows `to` strings to the
// allowed terminal markers without leaking them as magic strings
// through the rest of the codebase.
export const SUCCESS_END = "conclusion:success" as const;
export const FAILURE_END = "conclusion:failure" as const;
