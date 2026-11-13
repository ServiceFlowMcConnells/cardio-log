// Android emulator test support for the hydration widget, callable only from this repo's GitHub Actions on an
// e2e/* branch (GitHub OIDC). Works on one dedicated test account and nothing else:
//   {action:"reset"} -> clears the test account's water_log and returns a widget session for it
//   {action:"count"} -> the test account's water_log rows
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const REPO = "ServiceFlowMcConnells/cardio-log";
const EMAIL = "e2e-widget@kata-test.invalid";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: "https://token.actions.githubusercontent.com", audience: "kata-e2e" });
    if (payload.repository !== REPO || !String(payload.ref ?? "").startsWith("refs/heads/e2e/")) return json({ error: "Not allowed" }, 403);
  } catch {
    return json({ error: "Not allowed" }, 403);
  }
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // The test account (created on first use)
  let { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = list?.users.find((x: { email?: string }) => x.email === EMAIL);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true, password: crypto.randomUUID() + "Aa1!" });
    if (error) return json({ error: error.message }, 500);
    user = data.user;
  }
  const { action } = await req.json().catch(() => ({ action: "" }));
  if (action === "reset") {
    await admin.from("water_log").delete().eq("user_id", user!.id);
    // Two independent sessions, as in real use: one for the app's web view, one for the widget
    const mint = async () => {
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
      const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await anon.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type: "email" });
      if (error || !data.session) throw new Error(error?.message ?? "no session");
      return data.session;
    };
    try {
      const web = await mint(), widget = await mint();
      return json({ url, anon_key: Deno.env.get("SUPABASE_ANON_KEY"), refresh_token: widget.refresh_token, user_id: user!.id, web_session: web });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }
  if (action === "count") {
    const { data, error } = await admin.from("water_log").select("client_id, ml, source, local_date, logged_at").eq("user_id", user!.id);
    if (error) return json({ error: error.message }, 500);
    return json({ rows: data, count: data.length });
  }
  return json({ error: "Unknown action" }, 400);
});
