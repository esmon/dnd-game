import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client for App Router (RSC + route handlers).
// Reads the user's session from cookies; writes back any refreshed tokens
// when called from a context that allows it (route handlers / actions).
// Server Components can't set cookies — the catch swallows that error;
// the middleware (lib/supabase/middleware.ts) keeps cookies fresh.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component context — ignore; middleware refreshes.
          }
        },
      },
    },
  );
}
