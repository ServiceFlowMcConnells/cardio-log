// Gives the Android home-screen widget its own Supabase session, separate from the app's.
// Supabase rotates refresh tokens and revokes the whole session if a used one comes back, so the widget's
// background sync can't share the app's refresh token. Instead the signed-in app calls this, and we mint a
// fresh, independent session for the same user (an admin magic-link token, verified server-side; no email
// is sent). The phone keeps that refresh token in encrypted storage and rotates it on its own.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  if (ue || !u.user?.email) return json({ error: "Sign in first" }, 401);
  const session = await mint(admin, url, u.user.email);
  if (!session) return json({ error: "Couldn't start the widget session" }, 500);
  return json({ refresh_token: session.refresh_token, user_id: u.user.id });
});

// deno-lint-ignore no-explicit-any
export async function mint(admin: any, url: string, email: string) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link?.properties?.hashed_token;
  if (error || !hashed) return null;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error: ve } = await anon.auth.verifyOtp({ token_hash: hashed, type: "email" });
  return ve || !data.session ? null : data.session;
}
