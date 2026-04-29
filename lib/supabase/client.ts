import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client for Client Components. Manages auth via
// cookies (set by the middleware), so calls like signInWithOtp /
// onAuthStateChange work seamlessly across server and client.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
  );
}
