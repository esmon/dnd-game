// Pull a user-safe error message from a non-OK fetch Response. Routes
// follow the convention { error: "..." } for 4xx; we treat those as
// intentional (the API author wrote them for end users) and pass
// them through. 5xx and unparseable bodies fall back to the caller's
// generic message — those typically leak internals (Postgres
// constraint names, RLS errors, stack frames) that nobody wants in
// the UI.
//
// `sanitize` is a final safety net: even on a 4xx, if the message
// looks like raw DB output, we use the fallback. The patterns are
// intentionally narrow — anything resembling a column / constraint
// reference, a Postgres error keyword, or a stack frame.
const LEAK_PATTERNS = [
  /violates? .*constraint/i,
  /duplicate key/i,
  /syntax error/i,
  /relation ".*" does not exist/i,
  /column ".*" does not exist/i,
  /\bpermission denied for\b/i,
  /at .*\.ts:\d+:\d+/, // stack frame
];

function sanitize(message: string, fallback: string): string {
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(message)) return fallback;
  }
  return message;
}

export async function readApiError(
  res: Response,
  fallback: string,
): Promise<string> {
  if (res.status >= 500) return fallback;
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data.error === "string" && data.error.length > 0) {
      return sanitize(data.error, fallback);
    }
  } catch {
    // Body wasn't JSON — fall through to fallback.
  }
  return fallback;
}
