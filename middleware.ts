import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// Refresh Supabase auth cookies on every non-static request so signed-in
// sessions don't expire mid-game. The matcher excludes static assets and
// image optimizer paths because they don't carry the auth cookie anyway.
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
