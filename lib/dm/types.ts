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
  // Fight-gate scenes: when set, winning this scene's encounter
  // auto-advances to this transition target (a scene id or a
  // conclusion marker) — the fight *is* the obstacle, so the story
  // moves on without a manual "press on" tap. Omit for scenes with
  // post-combat content (loot, a victory beat) that the player
  // should linger on; those advance manually. Must match one of
  // `transitions[].to`. Solo only (coop's DM drives the world).
  advanceOnVictory?: string;
  // Authored player choices for the scene. The story page renders
  // these as a command menu — the player taps one, the system posts
  // the response text as narrative, then applies the effect (move
  // to next scene, kick off a combat, just narrate, etc.). Optional
  // because earlier campaigns / older content didn't ship with
  // them; UI falls back to the free-text composer when missing.
  playerActions?: PlayerAction[];
};

// Curated set of action-flavor icon slugs. Picked so authors
// don't have to import a lucide name into each campaign file —
// the page resolves slug → icon via a lookup map. Add new slugs
// here and the map in app/story/[id]/page.tsx as needed.
export type PlayerActionIcon =
  | "sword"
  | "footprints"
  | "search"
  | "eye"
  | "talk"
  | "advance"
  | "retreat"
  | "wait"
  | "intimidate"
  | "trophy"
  | "give";

export type PlayerAction = {
  // Stable within the scene — what the POST /action route receives
  // to identify which authored beat fired. Slug-style.
  id: string;
  // Button text. Keep short and verb-led — "Approach the cave",
  // "Search the bodies", not full sentences.
  label: string;
  // Narrative text posted as a `narrative` message when the action
  // is taken. Reads as the DM responding to the player's choice.
  response: string;
  // Optional side effect. Without one, the action just narrates.
  // With one: advance the scene, start a combat encounter, or hand
  // out a reward. Effects layer on top of the response message.
  effect?: PlayerActionEffect;
  // Optional class restriction. If set, the action only appears in
  // the menu when the character's class id is in this list — used
  // for flavor beats like "Pick the chief's pocket" (rogue),
  // "Read the signs on the strongbox" (wizard), or "Intimidate
  // Grask" (barbarian / fighter). Class ids match the slugs from
  // lib/dnd/classes.ts ("rogue", "wizard", "barbarian", etc.).
  // Absent = available to every class.
  classes?: string[];
  // Optional leading icon slug. Resolved on the client into a
  // lucide icon — same pattern the combat log uses for per-action
  // verbs. Class-gated actions ignore this and use their class
  // icon instead. Absent = generic chevron.
  icon?: PlayerActionIcon;
  // By default an action is one-shot: once taken in a scene, it
  // disappears from the menu so the player can't replay the same
  // beat. Set true for ambient checks that genuinely should repeat
  // — "Wait and watch", "Look around again", etc. — or for class
  // beats meant as a recurring affordance (e.g. a Druid's "Listen
  // to the trees" being available every scene transition). Per-
  // scene, not per-campaign: taken state resets when the scene
  // advances since the metadata gate filters by scene_id.
  repeatable?: boolean;
  // When true, the action only appears after the current scene's
  // scripted encounter has been resolved with a win. Use for beats
  // that assert a victory ("Stand over the fallen dragon", "Claim
  // the ring and leave") so a player can't claim the kill without
  // actually fighting. Non-combat wins (intimidation, a truce) are
  // separate actions left ungated.
  requiresVictory?: boolean;
  // The inverse of requiresVictory: hide this action once the scene's
  // encounter is won. Use for pre-combat / "deal with the living
  // enemy" beats (sneak up, negotiate with the chief, flee) that stop
  // making sense after the fight is over, so a won scene's menu
  // collapses to its genuine post-combat options.
  hideAfterVictory?: boolean;
};

export type PlayerActionEffect =
  // Just post the response. Default behavior when `effect` is
  // absent; kept as an explicit value so the campaign can be
  // self-documenting.
  | { kind: "narrate" }
  // Post the response, then transition to the named scene (or one
  // of the conclusion markers). The target must match one of the
  // scene's `transitions[].to` so authoring stays consistent.
  | { kind: "advance"; to: string }
  // Post the response, then trigger a combat encounter. The
  // monsterIndex / count must match an encounter on the *current*
  // scene's scripted.encounters so a bad action can't spawn
  // arbitrary fights.
  | { kind: "encounter"; monsterIndex: string; count?: number };

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
