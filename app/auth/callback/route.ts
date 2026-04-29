import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Magic-link callback. The OTP email points the user here with a `code`
// query param; we exchange it for a session cookie (set on the response
// via the SSR client's setAll), then redirect home. The optional `next`
// param lets future flows redirect somewhere other than `/`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No code or exchange failed — bounce back to sign-in with an error.
  return NextResponse.redirect(`${origin}/auth/sign-in?error=callback_failed`);
}
