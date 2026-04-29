"use client";

import { LogInIcon, LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUser } from "@/lib/auth/use-user";
import { createClient } from "@/lib/supabase/client";

// Top-right floating auth control. Anonymous users see "Sign In"; signed-in
// users see their email and a popover with Sign Out. Hidden during the
// initial loading flicker so the wrong state doesn't briefly render.
export function AuthButton() {
  const router = useRouter();
  const { user, loading } = useUser();

  if (loading) return null;

  if (!user) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push("/auth/sign-in")}
      >
        <LogInIcon className="size-3.5 shrink-0" />
        Sign In
      </Button>
    );
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Hard reload so the bootstrap re-runs cleanly — the lobby's character
    // list reverts to session-only and any auth-derived state clears.
    window.location.reload();
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="max-w-[180px] justify-start"
          >
            <span className="truncate">{user.email ?? "Account"}</span>
          </Button>
        }
      />
      <PopoverContent align="end" className="flex w-56 flex-col gap-2">
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        <Button
          variant="outline"
          size="sm"
          className="justify-start"
          onClick={handleSignOut}
        >
          <LogOutIcon className="size-3.5 shrink-0" />
          Sign Out
        </Button>
      </PopoverContent>
    </Popover>
  );
}
