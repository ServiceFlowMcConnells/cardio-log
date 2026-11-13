// Bridge to the Android app's Hydration plugin (native/overlay/java/HydrationPlugin.java): keeps the home-screen
// widget in step with the app, and brings the widget's offline taps into the app. Does nothing on the web or in
// older APKs without the plugin.
import { SUPABASE_KEY, SUPABASE_URL, supabase } from "./supabase";
import type { Settings } from "./types";
import type { WaterEntry } from "./hydration";
import { insertWater, loadWater, localDate, mergeWater, onWaterChange, totalOn, waterEntries } from "./hydration";

interface Bridge { isNativePlatform?: () => boolean; isPluginAvailable?: (n: string) => boolean; nativePromise?: <T>(p: string, m: string, o?: unknown) => Promise<T> }
const bridge = (): Bridge | null => {
  const cap = (window as unknown as { Capacitor?: Bridge }).Capacitor;
  return cap?.isNativePlatform?.() && cap.nativePromise && cap.isPluginAvailable?.("Hydration") ? cap : null;
};
const call = <T,>(m: string, o: unknown = {}) => bridge()!.nativePromise!<T>("Hydration", m, o);
export const widgetSupported = () => bridge() != null;

type QueueItem = { client_id: string; ml: number; logged_at: string; local_date: string };

let settings: Pick<Settings, "water_target_ml" | "water_increment_ml"> | null = null;

/** Today's total, target and the + amount to the widget. */
export async function pushWidget(entries: WaterEntry[] = waterEntries()) {
  if (!bridge() || !settings) return;
  const day = localDate();
  await call("setState", { total: totalOn(entries, day), target: settings.water_target_ml, increment: settings.water_increment_ml, localDate: day }).catch(() => undefined);
}

/** Inserts the widget's queued taps (same client_id dedupe as the widget's own sync), then clears them. */
export async function flushWidgetQueue() {
  if (!bridge()) return;
  const { items } = await call<{ items: QueueItem[] }>("drainQueue").catch(() => ({ items: [] as QueueItem[] }));
  if (!items?.length) return;
  const rows: WaterEntry[] = items.map((i) => ({ ...i, ml: Number(i.ml), source: "widget" }));
  await insertWater(rows);
  await call("ackQueue", { ids: rows.map((r) => r.client_id) }).catch(() => undefined);
  mergeWater(rows);
}

/** Gives the widget its own session (see supabase/functions/widget-session) when it doesn't have one for this user. */
async function ensureWidgetSession(userId: string) {
  const s = await call<{ signedIn: boolean; userId?: string }>("getSession").catch(() => null);
  if (s?.signedIn && s.userId === userId) return;
  // Through Capacitor's native HTTP (no browser CORS in the way), with the app's own access token
  const { data: auth } = await supabase.auth.getSession();
  const token = auth.session?.access_token;
  if (!token) return;
  let data: { refresh_token?: string; user_id?: string } | null = null;
  try {
    const res = await bridge()!.nativePromise!<{ status: number; data: unknown }>("CapacitorHttp", "request", {
      url: `${SUPABASE_URL}/functions/v1/widget-session`, method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, data: {},
    });
    if (res.status === 200) data = (typeof res.data === "string" ? JSON.parse(res.data) : res.data) as typeof data;
  } catch {
    const r = await supabase.functions.invoke<{ refresh_token: string; user_id: string }>("widget-session", { body: {} });
    data = r.data ?? null;
  }
  if (!data?.refresh_token) return;
  await call("setSession", { url: SUPABASE_URL, anonKey: SUPABASE_KEY, refreshToken: data.refresh_token, userId: data.user_id });
}

/** Widget taps waiting to go to Health Connect (written there by the app, which holds the permission). */
export async function takeWidgetHealthPending(): Promise<QueueItem[]> {
  if (!bridge()) return [];
  const r = await call<{ items: QueueItem[] }>("takeHealthPending").catch(() => ({ items: [] as QueueItem[] }));
  return r.items ?? [];
}

/** "hydration" once, if the app was opened from the widget. */
export async function takeLaunchTarget(): Promise<string | null> {
  if (!bridge()) return null;
  const r = await call<{ target?: string }>("takeLaunchTarget").catch(() => null);
  return r?.target || null;
}

export async function pinWidget(): Promise<boolean> {
  if (!bridge()) return false;
  const r = await call<{ ok: boolean }>("pinWidget").catch(() => ({ ok: false }));
  return r.ok;
}

let started = false;
/** Wires the widget up: session, queue flush and state pushes on start, resume and every change. */
export function startWidgetSync(getSettings: () => Settings | null, onOpenHydration: () => void, onHealth?: (items: QueueItem[]) => void) {
  if (started || !bridge()) return;
  started = true;
  const sync = async () => {
    const s = getSettings();
    if (s) settings = s;
    const { data } = await supabase.auth.getSession();
    if (!data.session) { await call("clearSession").catch(() => undefined); return; }
    await ensureWidgetSession(data.session.user.id).catch(() => undefined);
    await flushWidgetQueue().catch(() => undefined);
    await loadWater(true).catch(() => undefined);
    await pushWidget();
    const hp = await takeWidgetHealthPending();
    if (hp.length) onHealth?.(hp);
    if ((await takeLaunchTarget()) === "hydration") onOpenHydration();
  };
  onWaterChange((all) => { void pushWidget(all); });
  supabase.auth.onAuthStateChange((ev) => {
    if (ev === "SIGNED_OUT") void call("clearSession").catch(() => undefined);
    if (ev === "SIGNED_IN") void sync();
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void sync(); });
  window.addEventListener("resume", () => void sync());
  void sync();
}

/** After a settings change: new target / + amount straight to the widget. */
export function widgetSettingsChanged(s: Settings) {
  settings = s;
  void pushWidget();
}
