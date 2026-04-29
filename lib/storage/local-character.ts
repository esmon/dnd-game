import type { Character, CharacterUpdate } from "@/lib/db/schema";

// Anonymous users get a single-character localStorage slot. Signed-in
// users use Supabase (queries handled elsewhere). Creating a new
// character via /create overrides whatever was here, matching the
// "anonymous = one character only" product decision.
const KEY = "dnd-local-character";

export function getLocalCharacter(): Character | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Character;
  } catch {
    return null;
  }
}

export function setLocalCharacter(character: Character): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(character));
  } catch {
    // localStorage full or disabled — silently ignore.
  }
}

export function clearLocalCharacter(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// Merge mutable fields into the stored character. No-op if nothing's
// stored (signed-in path takes care of itself).
export function updateLocalCharacterMutable(updates: CharacterUpdate): void {
  const existing = getLocalCharacter();
  if (!existing) return;
  setLocalCharacter({
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  });
}
