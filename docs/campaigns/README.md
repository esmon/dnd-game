# Campaigns

Three hand-authored campaigns ship in `lib/dm/campaigns/*.ts`. Each has three scenes, a set of scripted encounters, DM briefing text, and both a success and a failure ending. They differ in tone, difficulty, and how much combat vs. social play they lean on.

## The three campaigns

| Campaign | Levels | Tone | Difficulty | Combat weight |
|---|---|---|---|---|
| [The Goblin Warrens](./goblin-warrens.md) | 1–3 | Pulp Action | Low | Heavy — three encounters, boss brawl |
| [The Haunted Manor](./haunted-manor.md) | 3–5 | Gothic Horror | Mid | Medium — one wraith fight, one optional ghost fight |
| [The Wyrm's Hollow](./wyrms-hollow.md) | 7–10 | High Fantasy | High | Boss-shaped — one big fight, negotiable |

Every campaign closes at `SUCCESS_END` or `FAILURE_END` (see `lib/dm/types.ts`). The templates set the conclusion prose for each ending.

## Shape shared by all three

- **Three scenes** each. Scenes carry `dmBackground` (context for the DM), `readAloud` (boxed text to publish verbatim as narrative), `scripted.encounters` (monster spawns), `scripted.rewards` (XP + loot on completion), and `transitions` (allowed next-scene targets).
- **Player actions** are authored per scene. Each action posts a canned narrative response and optionally fires an effect (`narrate` / `advance` / `encounter`). See the "Anatomy of a scene" section in [Story mode](../story-mode.md) for the shared mechanics.
- **Class-flavor beats** — most scenes have at least one class-gated action (rogue's "Pick a lock", wizard's "Speak the true name") that only appears for the matching class.
- **Multiple endings per campaign** — every one has both a peaceful/social win path and a combat win path, plus a way to fail.

## Authoring a new campaign

The templates are TypeScript modules exporting a `Campaign` object. Steps:

1. Create `lib/dm/campaigns/<slug>.ts` following the shape of an existing campaign (imports from `../types`, `SUCCESS_END`, `FAILURE_END`).
2. Register it in `lib/dm/campaigns/index.ts` (add to `CAMPAIGNS` array) so the picker picks it up.
3. Ensure every scene has at least one `advance` action (or set `advanceOnVictory`) so the run can progress solo.
4. Mark claim-the-kill beats with `requiresVictory: true` and social/pre-combat beats with `hideAfterVictory: true` where relevant — see the "Action visibility gates" section in [Story mode](../story-mode.md).

---

← [All docs](../README.md)
