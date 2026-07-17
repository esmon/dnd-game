"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const CALLBACK_ERRORS: Record<string, string> = {
  callback_failed:
    "We couldn't verify that sign-in link. It may have expired or already been used. Try sending a fresh one.",
};

type Status = "idle" | "sending" | "sent" | "error";

export default function SignInPage() {
  // Suspense boundary required because SignInForm reads URL search
  // params; Next streams the rest of the page while it resolves.
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");
  const callbackErrorMessage = callbackError
    ? CALLBACK_ERRORS[callbackError] ?? `Sign-in failed (${callbackError}).`
    : null;

  // Set by /campaign/[id] when an unauthenticated user opens a shared
  // invite. Drives both the copy ("Sign in to play co-op") and the
  // post-magic-link landing so the user ends up back at the campaign
  // they were trying to join, not at /.
  const next = searchParams.get("next");
  const isCoopInvite = !!next && next.startsWith("/campaign/");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || status === "sending") return;
    setStatus("sending");
    setError(null);
    const supabase = createClient();
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    if (next) callbackUrl.searchParams.set("next", next);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
      },
    });
    if (err) {
      setStatus("error");
      setError(err.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-md border-2 border-foreground bg-card p-6 font-mono">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl font-bold uppercase tracking-widest">
            {isCoopInvite ? "Sign In To Play Co-op" : "Sign In"}
          </h1>
          <p>
            {isCoopInvite
              ? "Co-op campaigns require an account so your party can find you. We'll send you back to the invite after."
              : "Save your characters and access them from any device."}
          </p>
        </div>
        {callbackErrorMessage && status === "idle" ? (
          <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-100">
            {callbackErrorMessage}
          </p>
        ) : null}
        {status === "sent" ? (
          <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-100">
            Check <span className="font-bold">{email}</span> for a sign-in
            link. You can close this tab once you click it.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={status === "sending"}
              />
            </div>
            <Button type="submit" disabled={status === "sending" || !email}>
              {status === "sending" ? "Sending..." : "Send magic link"}
            </Button>
            {error ? (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
