import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import type { Character } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase";

// Sign-in claim: lift any anonymous state up to the now-signed-in user.
//
// Two sources of "anonymous state" flow in here:
//   1. A local character the client has been playing with in localStorage
//      (the post-Phase-4 default for anonymous users). We INSERT it into
//      characters with user_id set, preserving the client-side UUID so
//      the bootstrap can transition cleanly.
//   2. Pre-Phase-4 Supabase rows that were created via session_id and
//      never claimed. We UPDATE them all to user_id = auth.uid() in one
//      shot, scoped to the caller's session_id and user_id IS NULL.
//
// Idempotency: the client guards against repeat calls via
// `dnd-last-claimed-user-id`. The server keeps it loose: if the local
// character already exists (PK collision on retry), report that and
// continue with the session UPDATE. The session UPDATE's `IS NULL` filter
// makes it idempotent on its own.
export async function POST(request: NextRequest) {
  const { userId, sessionId } = await getRequestIdentity(request);
  if (!userId) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    localCharacter?: Character;
  };

  let localClaimedId: string | null = null;
  let localClaimSkipped = false;

  if (body.localCharacter) {
    const insert = {
      ...body.localCharacter,
      user_id: userId,
      session_id: sessionId ?? body.localCharacter.session_id ?? "",
    };
    const { data, error } = await supabaseAdmin
      .from("characters")
      .insert(insert)
      .select()
      .maybeSingle();

    if (error) {
      // 23505 = unique_violation — someone (probably a previous claim
      // attempt) already inserted this row. Treat as a no-op and
      // continue with the session-id sweep.
      if (error.code === "23505") {
        localClaimSkipped = true;
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else if (data) {
      localClaimedId = (data as Character).id;
    }
  }

  let sessionRowsClaimedCount = 0;
  if (sessionId) {
    const { data, error } = await supabaseAdmin
      .from("characters")
      .update({ user_id: userId })
      .eq("session_id", sessionId)
      .is("user_id", null)
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    sessionRowsClaimedCount = data?.length ?? 0;
  }

  return NextResponse.json({
    localClaimedId,
    localClaimSkipped,
    sessionRowsClaimedCount,
  });
}
