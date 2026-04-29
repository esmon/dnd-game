"use client";

import { useAuthClaim } from "@/lib/auth/use-auth-claim";

// Renders nothing; runs the one-shot sign-in claim effect on first
// detected auth state (per user, per browser). Mounted alongside the
// AuthButton in the root layout so the claim happens regardless of which
// page the magic-link callback drops the user on.
export function AuthClaimer() {
  useAuthClaim();
  return null;
}
