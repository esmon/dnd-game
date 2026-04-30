# DnD Game

A D&D-flavored arena combat game built on Next.js + Supabase + Tailwind. Roll a 5e character, solo through random encounters, or open a co-op campaign for 2–6 players to fight through a chain of scaling encounters together.

## What's in it

**Character creation**
- Race / class / background wizard (5e SRD content)
- Manual or rolled ability scores, level 1–20
- Magic-link auth (Supabase) with cross-device character access; anonymous play also supported via localStorage

**Solo arena**
- Random monster pulled from [dnd5eapi.co](https://www.dnd5eapi.co/) scaled to party level
- Turn-based combat with weapons, spells, scrolls, potions, smite, and self-heal
- Encounter difficulty rolls (Easy / Medium / Hard / Deadly) using DMG p.82 XP thresholds
- Loot drops and XP awards on kill, level-ups with ASI / spell learning

**Co-op multiplayer**
- 2–6 player campaigns via shareable invite link
- Initiative-rolled turn order (d20 + DEX) interleaving players and monsters
- Multi-encounter campaigns with rest screen between fights — full HP and spell-slot restore
- Server-authoritative combat; dice rolled server-side
- Smart monster targeting weighted by party HP
- AoE spells, Paladin Divine Smite
- 60s idle turn timer auto-skips disconnected teammates
- Realtime broadcast updates (Supabase Realtime); polling fallback
- Per-encounter recap + final outcome panel with party-wide loot/XP rollup

## Tech stack

- **Next.js 16** App Router
- **TypeScript** strict mode
- **Tailwind v4** + shadcn-style components
- **Supabase** Postgres + Auth + Realtime
- **dnd5eapi.co** for monster data

## Local development

Requires a Supabase project. Set up:

```bash
npm install
cp .env.example .env.local  # fill in NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / etc.
npm run dev
```

Apply migrations from `lib/db/migrations/` in order via the Supabase SQL editor or CLI.

Open [http://localhost:3000](http://localhost:3000).

## Project layout

```
app/                      # Next.js routes
  api/                    # API routes (campaign, character, auth)
  campaign/[id]/          # Co-op lobby + battle pages
  create/                 # Character creation wizard
components/
  coop/                   # Campaign battle, rest screen, outcome panel
  game/                   # Arena, command panel, victory/defeat panels
  create/                 # Wizard steps
lib/
  coop/                   # Server-side coop logic (auth, resolvers, monster chain,
                          #   initiative, encounter builder, realtime broadcast)
  dnd/                    # 5e domain logic (classes, races, spells, combat math)
  game/                   # Solo arena reducer, dice, types
  arena/                  # Arena hooks (bootstrap, persistence)
  db/migrations/          # Supabase migrations (timestamps in filename)
```

## Migrations

Schema changes live in `lib/db/migrations/` with `YYYYMMDDHHMMSS_name.sql` filenames. Apply in order — they're not idempotent re-runners by default.
