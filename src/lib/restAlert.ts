// Rest timer alerts.
// In the app: a short beep + buzz when the rest hits zero (Web Audio, unlocked by tapping a set).
// Minimised: the app can't run, so when it's hidden mid-rest it asks the server to send a push
// notification at the rest's end time (pg_cron + the send-rest-alerts edge function). Back in the
// app, the scheduled push is cancelled and the in-app beep takes over again.
import { supabase } from "./supabase";

const VAPID_PUBLIC = "BMzjqTTDWQpOJ726wXSe6M93ji19NsYTGKieWlCrKaFosPCa6Ar4v_CajTH4nthH6R9sdYotGkYx2V0dYl-Piig";
const SOUND_KEY = "training-log:rest-sound";

// ---------- Sound ----------

let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}
export function setSoundOn(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* ignore */ }
}

/** Call from a tap (e.g. ticking a set) so the browser lets us play sound later. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch { /* no audio */ }
}

/** Three short rising beeps, then a buzz. */
export function playRestEnd(test = false) {
  try { navigator.vibrate?.([200, 100, 200, 100, 300]); } catch { /* not supported */ }
  if (!test && !soundOn()) return;
  try {
    unlockAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    [[880, 0], [880, 0.22], [1320, 0.44]].forEach(([f, at], i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const s = t0 + at, len = i === 2 ? 0.32 : 0.14;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.5, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + len);
      o.connect(g).connect(ctx!.destination);
      o.start(s);
      o.stop(s + len + 0.02);
    });
  } catch { /* no audio */ }
}

// ---------- Push ----------

export type PushState = "unsupported" | "denied" | "off" | "on";

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isInstalled = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && (await currentSub()) ? "on" : "off";
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) }));
  const j = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert({ endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth }, { onConflict: "endpoint" });
  if (error) throw error;
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const sub = await currentSub();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

export async function sendTestPush(): Promise<number> {
  const { data, error } = await supabase.functions.invoke("send-rest-alerts", { body: { test: true } });
  if (error) throw error;
  return (data as { sent?: number })?.sent ?? 0;
}

let pushOnCache: boolean | null = null;
/** Ask the server to notify at `endAt` (ms). Only when notifications are switched on. */
export async function scheduleRestAlert(endAt: number, body: string) {
  if (pushOnCache === null) pushOnCache = (await pushState()) === "on";
  if (!pushOnCache) return;
  await supabase.from("rest_alerts").upsert({ fire_at: new Date(endAt).toISOString(), title: "Rest over", body, sent_at: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

export async function cancelRestAlert() {
  if (pushOnCache === false) return;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (uid) await supabase.from("rest_alerts").delete().eq("user_id", uid);
}

export function resetPushCache() { pushOnCache = null; }
