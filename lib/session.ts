import type {
  AbilityScores,
  Armor,
  Consumable,
  Spell,
  Weapon,
} from "@/lib/game/types";

const SESSION_KEY = "dnd-session-id";
const ACTIVE_CHARACTER_KEY = "dnd-active-character-id";
const CHARACTER_CACHE_PREFIX = "dnd-character-cache-";

export type CachedPlayerState = {
  current_hp: number;
  xp: number;
  level: number;
  max_hp: number;
  proficiency_bonus: number;
  ability_scores: AbilityScores;
  weapons: Weapon[];
  inventory: Weapon[];
  known_spells: Spell[];
  equipped_spells: Spell[];
  spell_slots: Record<string, number>;
  consumables: Consumable[];
  equipped_armor: Armor | null;
  equipped_shield: Armor | null;
  armor_inventory: Armor[];
  wins: number;
  losses: number;
  runaways: number;
  // Client-clock timestamp the cache was written. Kept for debugging;
  // we don't use it for invalidation because client clocks drift.
  updatedAt: number;
  // Server-stamped DB updated_at as known at the moment of the cache
  // write. Bootstrap compares this to the freshly-fetched row's
  // updated_at — if they differ, an external writer (coop on another
  // device, admin tool, etc.) has touched the row and the local
  // cache is stale.
  dbUpdatedAt?: string;
};

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function getActiveCharacterId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_CHARACTER_KEY);
}

export function setActiveCharacterId(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_CHARACTER_KEY, id);
}

export function clearActiveCharacterId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACTIVE_CHARACTER_KEY);
}

export function fetchWithSession(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Session-Id", getSessionId());
  return fetch(input, { ...init, headers });
}

export function cachePlayerState(
  id: string,
  state: Omit<CachedPlayerState, "updatedAt">,
): void {
  if (typeof window === "undefined") return;
  const payload: CachedPlayerState = { ...state, updatedAt: Date.now() };
  window.localStorage.setItem(
    CHARACTER_CACHE_PREFIX + id,
    JSON.stringify(payload),
  );
}

export function readPlayerStateCache(id: string): CachedPlayerState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CHARACTER_CACHE_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedPlayerState;
  } catch {
    return null;
  }
}

export function clearPlayerStateCache(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CHARACTER_CACHE_PREFIX + id);
}
