"use client";

import { LogInIcon, LogOutIcon, MenuIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { AuthButton } from "@/components/auth/auth-button";
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

// Top-right chrome: theme switcher + auth. On desktop they sit inline
// (there's room). On mobile the inline "Classic | Prism" pill + auth
// button overlapped the centered content (stats bar), so they collapse
// into a single menu button whose popover holds both.
export function TopChrome() {
  return (
    <>
      <div className="hidden items-center gap-2 md:flex">
        <ThemeSwitcher />
        <AuthButton />
      </div>
      <div className="md:hidden">
        <MobileMenu />
      </div>
    </>
  );
}

function MobileMenu() {
  const router = useRouter();
  const { user, loading } = useUser();
  // Mirror AuthButton: hide the auth section mid-battle so it doesn't
  // crowd the small-viewport combat UI. Theme still works.
  const authHidden = useAuthButtonHidden();

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
      <PopoverContent align="end" className="flex w-60 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Theme
          </span>
          <ThemeSwitcher />
        </div>

        {!loading && !authHidden ? (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            {user ? (
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
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
