# Reference

- [Data model](#data-model)
- [Auth & persistence](#auth--persistence)
- [Known gaps](#known-gaps)
- [File map](#file-map)

## Data model

Story mode adds three tables on top of the existing `characters` and coop `campaigns` / `campaign_players` tables. RLS is member-scoped; a non-member viewing a lobby is served via an explicit admin fallback in the snapshot route so the "my stories" list doesn't leak strangers' lobbies.

### `story_campaigns`

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key; also the invite token for coop lobbies. |
| `user_id` | uuid | Owner (creator). |
| `character_id` | uuid · nullable | Legacy: the owner's character. Null when a coop-DM created the story (they have no character). |
| `campaign_template_id` | text | Which campaign in `lib/dm/campaigns/`. |
| `current_scene_id` | text | Which scene of the template. |
| `mode` | text | `solo` or `coop`. |
| `dm_kind` | text | `self` (solo owner is DM) · `human` (coop DM seat) · `ai` (reserved). |
| `dm_user_id` | uuid · nullable | The user holding the DM seat in coop. |
| `status` | text | `lobby` · `active` · `completed_success` · `completed_failure` · `abandoned`. |
| `active_combat_campaign_id` | uuid · nullable | Points at the coop campaign spawned for the current encounter; cleared on resolve. |
| `active_turn_user_id` | uuid · nullable | Coop narrative-phase turn. Null for solo. |
| `world_state` | jsonb | Free-form scene state; also touched as a no-op to bump `updated_at`. |

### `story_players`

| Column | Type | Purpose |
|---|---|---|
| `campaign_id` | uuid | Story campaign the roster row belongs to. |
| `user_id` | uuid | The person seated. |
| `role` | text | `player` (brings a character) or `dm` (runs the world). |
| `character_id` | uuid · nullable | Null for a DM. |
| `character_snapshot` | jsonb · nullable | Frozen at join so mid-campaign level-ups don't retro-change a run. |
| `is_ready` | boolean | Lobby ready state. |
| `position` | int | Roster + turn order. |

### `story_messages`

| Column | Type | Purpose |
|---|---|---|
| `campaign_id` | uuid | Which story. |
| `role` | text | `narrative` (DM/system prose) · `player` · `system` · `tool`. |
| `content` | text | The rendered line. |
| `author_user_id` | uuid · nullable | Who posted; null for system-authored beats. |
| `metadata` | jsonb | `{scene_id, kind}`. Kinds: `scene_opening` · `player_action_response` · `encounter_resolved` · `scene_rewards` · `conclusion`. |

## Auth & persistence

Three tiers of persistence, picked at bootstrap by `dbUpdatedAt` comparison:

- **Signed-in Supabase** — `characters` and story tables scoped by `auth.uid()` via RLS.
- **Anonymous session-id** — a `dnd-session-id` UUID in localStorage; server ties anonymous character rows to it via the `X-Session-Id` header.
- **Local cache** — a most-recent-play snapshot for fast bootstrap.

Sign-in is Supabase magic-link OTP at `/auth/sign-in`, with a `next` param that survives the callback. On first sign-in per browser/user, `AuthClaimer` (mounted in the root layout) POSTs `/api/auth/claim` to attach the anonymous character + any session-id-only Supabase rows to the user, then hard-reloads.

The middleware refreshes Supabase auth cookies on every non-static request. Sign-out clears the session and reloads.

## Known gaps

### Open

| Gap | Impact | Notes |
|---|---|---|
| **`armor_inventory` schema-cache** | Character PATCHes 500 | Environmental, not code — migration `20260504182211` (idempotent) either isn't applied or PostgREST's cache is stale. Apply it or reload the schema cache. |
| **AI DM (`dm_kind = 'ai'`)** | Solo experience ceiling | Data model + briefings already shaped for it; deferred by cost decision. Scripted-only for now. |

### Closed

| Gap | Resolution |
|---|---|
| ~~Party combat in story mode~~ | Encounters now enroll the whole `story_players` roster via `lib/dm/combat.ts#spawnStoryEncounter`; fixed the DM-seat 404 too. |
| ~~Coop scene-reward distribution~~ | `grantSceneRewards` grants to every roster player; the log message notes level-ups per character. |
| ~~No home listing of active adventures~~ | "Continue Your Adventure" panel on the home dashboard lists in-progress stories (`components/arena/continue-adventures.tsx`). |
| ~~Flee outcome doesn't end the run~~ | A fled encounter now concludes the story to `completed_failure`, same as a defeat. |

## File map

Where to look when a mode misbehaves or you want to extend it.

### Home & solo combat

- `app/page.tsx` — entry
- `components/arena/arena.tsx` — the big lobby + combat component
- `components/arena/fight-mode-dialog.tsx`
- `components/arena/lobby-outcome-panel.tsx` · `components/arena/level-up-dialog.tsx` · `components/arena/inventory-dialog.tsx`
- `components/arena/continue-adventures.tsx` — home "resume in-progress stories" panel
- Persistence: `lib/arena/use-arena-persistence.ts` · `lib/arena/use-arena-bootstrap.ts`

### Coop combat

- `app/campaign/[id]/page.tsx` — the whole flow (lobby → battle → rest → outcome)
- `components/coop/campaign-battle.tsx` · `components/coop/rest-screen.tsx` · `components/coop/campaign-outcome-panel.tsx`
- API: `app/api/campaign/[id]/*` — action, join, start, next-encounter, level-up, end-campaign, forfeit, timeout, player
- `lib/coop/turn-order.ts` · `lib/coop/realtime.ts` · `lib/coop/leveling.ts` · `lib/coop/initiative.ts` · `lib/coop/monster-chain.ts`

### Story mode

- `app/story/[id]/page.tsx` — the play surface (lobby + play + combat dialog mount)
- `components/story/story-lobby.tsx` · `components/story/story-combat-dialog.tsx` · `components/story/campaign-picker-dialog.tsx`
- API: `app/api/story/route.ts` (list/create) · `app/api/story/[id]/*` — action, advance, messages, join, start, player, encounter, combat/start, combat/end
- `lib/dm/types.ts` — Scene / PlayerAction / Encounter / Reward / Transition types
- `lib/dm/db.ts` — StoryCampaign / StoryPlayer / StoryMessage row types
- `lib/dm/turns.ts` — turn order helpers
- `lib/dm/rewards.ts` — scripted reward application + per-party persistence
- `lib/dm/combat.ts` — `spawnStoryEncounter` (roster-aware encounter spawn)
- `lib/dm/realtime.ts` — broadcast helper
- Campaign templates: `lib/dm/campaigns/goblin-warrens.ts` · `haunted-manor.ts` · `wyrms-hollow.ts` · `index.ts`

### Shared combat UI

- `components/shared/battle-commands.tsx` · `command-button.tsx` · `command-panel.tsx`
- `components/shared/party-row.tsx` · `turn-line.tsx` · `health-bar.tsx` · `mobile-combat-log.tsx`
- `components/shared/character-picker-dialog.tsx` · `character-avatar.tsx` · `disabled-tip.tsx`

### Character creation

- `app/create/page.tsx` — 5-step wizard
- `components/create/*` — RaceStep, ClassStep, BackgroundStep, AbilitiesStep, ReviewStep

### Auth

- `app/auth/sign-in/page.tsx` — magic-link OTP form
- `app/auth/callback/route.ts` — code exchange
- `middleware.ts` — cookie refresh on every request
- `lib/session.ts` — anonymous session-id + `fetchWithSession`
- `components/auth/auth-button.tsx` · `components/auth/auth-claimer.tsx` · `lib/auth/use-auth-claim.ts`

### DB migrations

- `lib/db/migrations/*.sql` — timestamped SQL migrations, chronological order

---

← Back to [README](./README.md) · Previous: [Campaigns](./campaigns/README.md)
