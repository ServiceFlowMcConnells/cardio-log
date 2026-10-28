import { createClient } from "@supabase/supabase-js";

// Publishable key: safe to ship in the browser. Data is protected by row-level security.
export const SUPABASE_URL = "https://vrrlqxqdtuorluvenofs.supabase.co";
export const SUPABASE_KEY = "sb_publishable_TvG_cSzhAcYOw82M1JwmAA_SHCYjcMA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
