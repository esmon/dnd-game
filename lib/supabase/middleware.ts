import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Run on every request to refresh the auth session cookie. Without this,
// expired tokens would force a fresh sign-in on the next page load even
// though Supabase's refresh token is still valid.
//
// Important: do not put logic between createServerClient() and getUser().
// getUser() is what triggers the token refresh; anything that reads
// session state in between can race with the refresh.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touches the session — refreshes the token if needed.
  await supabase.auth.getUser();

  return supabaseResponse;
}
