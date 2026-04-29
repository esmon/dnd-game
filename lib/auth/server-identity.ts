import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Server-side identity for API routes. Reads the auth user (if any) from
// cookies via the SSR Supabase client, and the legacy session id from the
// X-Session-Id header. Routes use both to enforce ownership: signed-in
// users own rows by user_id; anonymous users still own rows by session_id
// for backwards compat with characters that haven't been claimed yet.
export type RequestIdentity = {
  userId: string | null;
  sessionId: string | null;
};

export async function getRequestIdentity(
  request: NextRequest,
): Promise<RequestIdentity> {
  const sessionId = request.headers.get("x-session-id");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { userId: user?.id ?? null, sessionId };
}

// True when the row's ownership matches the request identity:
//   - user_id match (preferred, takes precedence over session_id)
//   - or session_id match AND row is unclaimed (user_id IS NULL)
//
// Once a row is claimed (user_id set), session_id stops granting access —
// the character is bound to the account, and anonymous browsers can no
// longer see it without signing in.
export function isOwnedBy(
  row: { user_id: string | null; session_id: string },
  identity: RequestIdentity,
): boolean {
  if (identity.userId && row.user_id === identity.userId) return true;
  if (
    row.user_id === null &&
    identity.sessionId &&
    row.session_id === identity.sessionId
  ) {
    return true;
  }
  return false;
}
