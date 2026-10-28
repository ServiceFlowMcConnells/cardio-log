// Sends rest-timer push notifications.
// - Called by pg_cron (private.dispatch_rest_alerts) with x-cron-secret and the alerts it has claimed.
// - Called by the signed-in app with { test: true } to send a test notification to that user.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
let config: Record<string, string> | null = null;

async function getConfig() {
  if (config) return config;
  const { data, error } = await admin.rpc("rest_push_config");
  if (error) throw error;
  config = data as Record<string, string>;
  webpush.setVapidDetails("mailto:noreply@training-log-coach.vercel.app", config.vapid_public_key, config.vapid_private_key);
  return config;
}

async function sendTo(userId: string, title: string, body: string) {
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, tag: "rest-timer", url: "/" }),
        { TTL: 60, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id); // expired
      else console.error("push failed", code, (e as Error).message);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const cfg = await getConfig();
    const payload = await req.json().catch(() => ({}));
    if (req.headers.get("x-cron-secret") === cfg.rest_cron_secret) {
      const alerts = (payload.alerts ?? []) as { user_id: string; title: string; body: string }[];
      let sent = 0;
      for (const a of alerts) sent += await sendTo(a.user_id, a.title, a.body);
      return json({ ok: true, sent });
    }
    // Test from the app: must be a signed-in user
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!u?.user || !payload.test) return json({ error: "Unauthorised" }, 401);
    const sent = await sendTo(u.user.id, "Rest over", "Test alert: this is what you'll get when a rest ends.");
    return json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
