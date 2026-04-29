"use client";

import { useEffect } from "react";

import { fetchWithSession, setActiveCharacterId } from "@/lib/session";
import {
  clearLocalCharacter,
  getLocalCharacter,
} from "@/lib/storage/local-character";

import { useUser } from "./use-user";

const CLAIMED_FOR_KEY = "dnd-last-claimed-user-id";

type ClaimResult = {
  localClaimedId: string | null;
  localClaimSkipped: boolean;
  sessionRowsClaimedCount: number;
};

// On first sign-in for a given user_id (per browser), POST any local
// character + claim any session-id-only Supabase rows. Reloads the page
// after a successful claim so the bootstrap re-runs with the new state.
//
// Dedup is keyed by user_id so the same browser can claim again after
// switching accounts (sign out → sign in as someone else).
export function useAuthClaim() {
  const { user, loading } = useUser();

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(CLAIMED_FOR_KEY) === user.id) return;

    let cancelled = false;
    (async () => {
      const localCharacter = getLocalCharacter();
      try {
        const res = await fetchWithSession("/api/auth/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ localCharacter }),
        });
        if (!res.ok) {
          console.error("auth claim failed", res.status);
          return;
        }
        const result = (await res.json()) as ClaimResult;
        if (cancelled) return;

        // Mark this user as claimed before any reload so the next page
        // load doesn't re-trigger.
        window.localStorage.setItem(CLAIMED_FOR_KEY, user.id);

        // The local char (if any) is now in Supabase. Drop the local
        // copy so the bootstrap reads from Supabase next time. Point the
        // active-character pointer at the freshly claimed row so the
        // user lands back on the same character.
        if (localCharacter) {
          clearLocalCharacter();
          if (result.localClaimedId) {
            setActiveCharacterId(result.localClaimedId);
          }
        }

        // Reload only when something actually changed; otherwise the
        // existing render is already correct.
        const changed =
          !!localCharacter ||
          result.localClaimedId !== null ||
          result.sessionRowsClaimedCount > 0;
        if (changed) {
          window.location.reload();
        }
      } catch (err) {
        console.error("auth claim threw", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);
}
