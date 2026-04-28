import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY;

export const supabase = createClient(supabaseUrl, publishableKey);

export const supabaseAdmin = secretKey
  ? createClient(supabaseUrl, secretKey)
  : supabase;
