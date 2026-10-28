// Hands the Android signing key to this repo's GitHub Actions build, and nobody else.
// The caller must present a GitHub Actions OIDC token for ServiceFlowMcConnells/cardio-log on main.
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
    const { payload } = await jwtVerify(token, JWKS, { issuer: "https://token.actions.githubusercontent.com", audience: "training-log-signing" });
    if (payload.repository !== REPO || payload.ref !== "refs/heads/main" || payload.repository_owner !== "ServiceFlowMcConnells") {
      return json({ error: "Not allowed" }, 403);
    }
  } catch {
    return json({ error: "Not allowed" }, 403);
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("android_signing_config");
  if (error || !data?.keystore) return json({ error: "Key unavailable" }, 500);
  return json(data);
});
