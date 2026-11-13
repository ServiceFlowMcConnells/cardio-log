// Android emulator test support for the hydration widget, callable only from this repo's GitHub Actions on an
// e2e/* branch (GitHub OIDC). The app allows a single account (sign-ups are closed by a trigger), so the test
// runs on that account and only ever touches what it creates itself:
//   {action:"start"}                    -> sessions for the web view and the widget (each its own), and a start time
//   {action:"count", since}             -> widget rows created since the start (the test's taps)
//   {action:"cleanup", since, tokens}   -> deletes those rows and signs the test's sessions out
// No real widget exists before this APK ships, so widget rows created during the run are the test's own.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const REPO = "ServiceFlowMcConnells/cardio-log";
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
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 2 });
  const user = list?.users[0];
  if (!user?.email) return json({ error: "No account" }, 500);
  const body = await req.json().catch(() => ({}));
  const since = typeof body.since === "string" ? body.since : null;

  if (body.action === "start") {
    const mint = async () => {
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email! });
      const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await anon.auth.verifyOtp({ token_hash: link!.properties.hashed_token, type: "email" });
      if (error || !data.session) throw new Error(error?.message ?? "no session");
      return data.session;
    };
    try {
      const startedAt = new Date().toISOString();
      const web = await mint(), widget = await mint();
      return json({ url, anon_key: Deno.env.get("SUPABASE_ANON_KEY"), refresh_token: widget.refresh_token, widget_access: widget.access_token, user_id: user.id, web_session: web, since: startedAt });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }
  if (!since) return json({ error: "since is required" }, 400);
  const mine = () => admin.from("water_log").select("client_id, ml, source, local_date, logged_at").eq("user_id", user.id).eq("source", "widget").gte("created_at", since);
  if (body.action === "count") {
    const { data, error } = await mine();
    if (error) return json({ error: error.message }, 500);
    return json({ rows: data, count: data.length });
  }
  if (body.action === "cleanup") {
    const { data } = await mine();
    const ids = (data ?? []).map((r) => r.client_id);
    if (ids.length) await admin.from("water_log").delete().in("client_id", ids);
    for (const t of Array.isArray(body.tokens) ? body.tokens : []) await admin.auth.admin.signOut(String(t), "local").catch(() => undefined);
    return json({ deleted: ids.length });
  }
  return json({ error: "Unknown action" }, 400);
});
