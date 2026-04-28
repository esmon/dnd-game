const SESSION_KEY = "dnd-session-id";
const ACTIVE_CHARACTER_KEY = "dnd-active-character-id";

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
