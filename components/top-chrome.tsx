"use client";

import {
  ChevronsUpIcon,
  LogInIcon,
  LogOutIcon,
  MenuIcon,
  UserPlusIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUser } from "@/lib/auth/use-user";
import { createClient } from "@/lib/supabase/client";
import { useAuthButtonHidden } from "@/lib/ui/auth-button-visibility";

// Top-left app menu (all viewports). Holds the theme switcher, "Create
// New Character", and auth (sign in / email + sign out) behind a single
// button so the chrome never overlaps the centered page content.
export function TopChrome() {
  const router = useRouter();
  const { user, loading } = useUser();
  // Mirror the old AuthButton: hide the nav/auth actions mid-battle so
  // they don't pull the player out of a fight. Theme stays available.
  const inBattle = useAuthButtonHidden();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Menu">
            <MenuIcon className="size-4 shrink-0" />
          </Button>
        }
      />
      <PopoverContent align="start" className="flex w-60 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Theme
          </span>
          <ThemeSwitcher />
        </div>

        {!inBattle ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={() => router.push("/create")}
            >
              <UserPlusIcon className="size-3.5 shrink-0" />
              Create New Character
            </Button>

            {process.env.NODE_ENV === "development" ? (
              <Button
                variant="outline"
                size="sm"
                className="justify-start opacity-70"
                // Dev-only. Signals the arena reducer via a window event
                // (this menu lives in the global layout, out of its tree).
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("dnd:dev-next-level"))
                }
              >
                <ChevronsUpIcon className="size-3.5 shrink-0" />
                [DEV] +1 Level
              </Button>
            ) : null}

            {!loading &&
              (user ? (
                <>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                  <Button
                    size="sm"
                    className="justify-start"
                    onClick={handleSignOut}
                  >
                    <LogOutIcon className="size-3.5 shrink-0" />
                    Sign Out
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => router.push("/auth/sign-in")}
                >
                  <LogInIcon className="size-3.5 shrink-0" />
                  Sign In
                </Button>
              ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
