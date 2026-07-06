# Play modes

Every mode is combat-driven at some level, and every mode reuses the same battle UI. What changes is the framing — random monsters, a real party, a scripted adventure, or a scripted adventure *with* a real party.

- [Solo Combat (Arena)](#solo-combat-arena)
- [Coop Combat (Campaign)](#coop-combat-campaign)
- [Solo Story](#solo-story)
- [Coop Story](#coop-story)

## Solo Combat (Arena)

**Route:** state on `/` — solo combat is a *state* of the home component, not a separate route. Clicking **Fight** replaces the lobby layout in place with the battle layout.

### Flow

1. **Start** — from the home command panel, **Fight** opens the mode dialog (Solo / Co-op). Anonymous users bypass the dialog and drop straight into Solo. `startFight()` dispatches `START_FIGHT` and hydrates a random monster via `/api/monsters?level=X`.
2. **Combat** — party panel + monster card + four battle-command tiles (Attack, Spells, Inventory, Run). Each tile opens a popover of concrete options sorted by expected effective damage; casters see spells first.
3. **Player action** — `handleAttack` / `handleCastSpell` / `handleSmite` / `handleUseScroll` / `handleUsePotion` rolls a d20, applies damage, then queues a one-second monster counter-attack.
4. **Win** — `WIN` dispatch banks XP + loot, full-heals every third streak, queues an ASI if a level threshold was crossed. Loot lands in the *lobby outcome panel* with Keep / Discard.
5. **Lose** — `LOSE` returns to the lobby with a "Defeated by X" panel. HP restores on the next fight or long rest.
6. **Flee** — 40% success; failure grants the monster a free swing.
7. **Between fights** — the *Rest* button dispatches `LONG_REST` (full HP + spell slots). Level-ups auto-open `LevelUpDialog` once any loot is resolved.

### Key files

- `app/page.tsx` · `components/arena/arena.tsx`
- `components/arena/lobby-outcome-panel.tsx` · `components/arena/level-up-dialog.tsx`
- Persistence: `lib/arena/use-arena-persistence.ts` · `lib/arena/use-arena-bootstrap.ts`

> [!NOTE]
> The combat state **is** the home component. There is no route change; the lobby re-lays out as the battle. This keeps mid-fight cancels and errors trivially recoverable — the page never left home.

## Coop Combat (Campaign)

**Route:** `/campaign/[id]`. Sign-in required (redirects to `/auth/sign-in?next=…` for guests). Realtime through Supabase broadcast on `campaign:<id>`, plus a polling fallback.

### Flow

1. **Create** — home Fight → Co-op posts `/api/campaign`, routes to `/campaign/[id]`.
2. **Lobby** — the creator sees a copyable invite URL and a roster capped at **6**. Character can be swapped from the lobby via the shared character picker (`PATCH /api/campaign/[id]/player`), which resets the ready flag.
3. **Join** — a signed-in visitor who isn't a member sees `JoinPrompt`; joining POSTs `/api/campaign/[id]/join` with the active character. Ready is one-way (no unready). The creator doesn't need to ready.
4. **Start** — once **≥2** players are seated and every non-creator is ready, the creator's **Start Campaign** button enables. Server flips `status` to `active`.
5. **Encounter** — the party fights turn-by-turn through `CampaignBattle`, using the same battle-command tiles as solo. Turn order comes from `lib/coop/turn-order.ts`. Actions POST to `/api/campaign/[id]/action`.
6. **Between encounters (rest)** — `status = between_encounters` mounts `RestScreen`. Banked XP auto-runs level-up, party HP restores, per-fight XP + loot totals show. Two buttons: **Encounter N+1** (auto-scaled to party level) or **End Campaign**.
7. **Campaign finished** — `status = finished` mounts `CampaignOutcomePanel`. On win: victory recap. On defeat: a mutual **Play Again** ready-check (each player's `continue_ready` flips true) to reroll the encounter.

### Key files

- `app/campaign/[id]/page.tsx`
- `components/coop/campaign-battle.tsx` · `components/coop/rest-screen.tsx` · `components/coop/campaign-outcome-panel.tsx`
- API: `app/api/campaign/[id]/*` (action / join / start / next-encounter / level-up / end-campaign / forfeit / timeout / player)
- `lib/coop/turn-order.ts` · `lib/coop/realtime.ts` · `lib/coop/leveling.ts`

## Solo Story

**Route:** `/story/[id]` with `mode: "solo"`. Signed-in only (Story Mode requires an account). Scripted campaigns with authored scenes, player action buttons, and scripted encounters that fold into the same combat engine.

### Flow

1. **Create** — home **Story Mode** opens the campaign picker. Pick a template (Goblin Warrens / Haunted Manor / Wyrm's Hollow), pick **Solo** mode, tap **Begin Campaign**. `POST /api/story` creates the story with `status: "active"` and drops straight into play.
2. **Play** — `/story/[id]` renders the narrative log (scene read-aloud on top), the party panel with the solo character, and the authored action buttons for the current scene. **No free-text composer in solo** — the player drives entirely through the buttons.
3. **Take an action** — click a button; the route posts the authored response as a narrative message and applies the action's effect (narrate / advance / encounter).
4. **Encounter fires** — locks the page in the combat dialog until the fight resolves. Combat runs against the same coop machinery as standalone coop combat (currently single-player).
5. **Scene advance** — advancing pays out the leaving scene's scripted rewards to the character and posts the next scene's read-aloud. Fight-gate scenes with `advanceOnVictory` auto-advance on a won encounter.
6. **Conclusion** — advancing to `SUCCESS_END` or `FAILURE_END` flips the story to `completed_success` / `completed_failure` and posts the campaign's conclusion text.

See [Story mode](./story-mode.md) for the full scene mechanics.

### Key files

- `app/story/[id]/page.tsx`
- Campaign templates: `lib/dm/campaigns/*.ts`
- API: `app/api/story/[id]/*` (action / advance / messages / encounter / combat/start / combat/end)

## Coop Story

**Route:** `/story/[id]` with `mode: "coop"`. Signed-in only. Same campaign templates as Solo Story, but wrapped around a lobby, a human DM seat, and a turn-based narrative phase for the players.

### Flow

1. **Create** — home **Story Mode** → pick template → **Co-op** → pick seat (**I'll DM** or **I'll play**) → **Create Lobby**. `POST /api/story` creates the story with `status: "lobby"` and (for the DM seat) sets `dm_user_id`.
2. **Lobby** — copyable invite URL. DM seat + up to 6 player slots. Non-DM party members ready up; the DM's Start button enables when at least one player is ready.
3. **Join** — non-members opening the invite see the roster; they can join as a player (picking a character) or claim the DM seat if it's open.
4. **Start** — DM taps **Start the Story**. `POST /api/story/[id]/start` flips `status` to `active`, seats the first roster player's turn (`active_turn_user_id`), and seeds the first scene's read-aloud into the log.
5. **Narrative play** — one *move* per turn (action button OR free-text message), auto-advancing in roster position order. The DM narrates freely anytime and drives encounters + scene changes from the DM Notes panel.
6. **Encounter** — the DM taps **Trigger** on the DM Notes panel; combat opens for everyone via the coop combat engine. On resolve, the story page refetches and narrative turns resume.
7. **Conclusion** — the DM advances the scene to a conclusion, or the campaign concludes on a loss.

See [Story mode](./story-mode.md#solo-vs-coop-play-surface) for what each seat (solo player / coop player / coop DM) actually sees on screen.

### Key files

- `app/story/[id]/page.tsx` · `components/story/story-lobby.tsx` · `components/story/story-combat-dialog.tsx`
- API: `app/api/story/[id]/start/route.ts` · `app/api/story/[id]/join/route.ts` · `app/api/story/[id]/player/route.ts`
- `lib/dm/turns.ts` · `lib/dm/realtime.ts`

---

← Back to [README](./README.md)
