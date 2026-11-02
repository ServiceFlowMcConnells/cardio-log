// Steps and sleep from Health Connect, through the Android app's Health plugin (@capgo/capacitor-health).
// Like the rest timer, the site is loaded live inside the app, so we call the plugin through the native
// bridge Capacitor injects (Capacitor.nativePromise) rather than bundling @capacitor/core.
//
// Each sync reads a window of days from Health Connect, boils it down to one row per day (steps, and the
// night's sleep that ended that morning) and saves it to daily_activity, so the laptop sees it too.
import { supabase } from "./supabase";
import { addDays, todayYmd, ymd } from "./nutrition";

export interface DayActivity {
  day: string;
  steps: number | null;
  sleep_minutes: number | null; // asleep (all stages but awake)
  in_bed_minutes: number | null;
  deep_minutes: number | null;
  rem_minutes: number | null;
  light_minutes: number | null;
  awake_minutes: number | null;
  sleep_start: string | null;
  sleep_end: string | null;
}

interface Bridge {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: <T>(plugin: string, method: string, options?: unknown) => Promise<T>;
}
type SleepStage = { startDate: string; endDate: string; stage: string; durationMinutes: number };
type StepRec = { startDate: string; endDate: string; value: number; sourceId?: string; sourceName?: string; deviceType?: string };
type Sample = { value: number; startDate: string; endDate: string; sleepState?: string; stages?: SleepStage[]; hasStageData?: boolean };

const bridge = (): Bridge | null => {
  const cap = (window as unknown as { Capacitor?: Bridge }).Capacitor;
  return cap?.isNativePlatform?.() && cap.nativePromise && cap.isPluginAvailable?.("Health") ? cap : null;
};
const call = <T,>(method: string, options: unknown = {}) => bridge()!.nativePromise!<T>("Health", method, options);

/** True inside an Android app build that has the Health plugin (1.0.6+). */
export const healthSupported = () => bridge() != null;

const LS = { connected: "hc-connected", last: "hc-last-sync", source: "hc-steps-source" };
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export const healthConnected = () => ls.get(LS.connected) === "1";
/** Which app's steps to use: null = Health Connect's combined total (it removes overlap by app priority). */
export const stepSource = () => ls.get(LS.source);
export const setStepSource = (k: string | null) => ls.set(LS.source, k);
const sourceKey = (r: StepRec) => `${r.sourceId ?? "?"}|${r.sourceName ?? r.sourceId ?? "?"}`;
export const sourceLabel = (k: string) => {
  const [pkg, name] = k.split("|");
  const app = KNOWN_APPS[pkg] ?? pkg;
  return name && name !== pkg ? `${name} (${app})` : app;
};
const KNOWN_APPS: Record<string, string> = {
  "com.sec.android.app.shealth": "Samsung Health", "com.google.android.apps.fitness": "Google Fit", "com.google.android.apps.healthdata": "Health Connect",
  "com.fitbit.FitbitMobile": "Fitbit", "com.garmin.android.apps.connectmobile": "Garmin Connect", "com.huawei.health": "Huawei Health",
  "com.xiaomi.wearable": "Mi Fitness", "com.mc.miband1": "Notify for Mi Band", "com.withings.wiscale2": "Withings", "com.ouraring.oura": "Oura",
  "com.google.android.apps.wear.companion": "Pixel Watch", "android": "This phone",
};
export const lastSync = () => { const v = ls.get(LS.last); return v ? Number(v) : null; };

export interface HealthStatus { available: boolean; reason?: string; steps: boolean; sleep: boolean; history?: boolean }

export async function healthStatus(): Promise<HealthStatus> {
  if (!healthSupported()) return { available: false, reason: "Only in the Android app", steps: false, sleep: false };
  const a = await call<{ available: boolean; reason?: string }>("isAvailable");
  if (!a.available) return { available: false, reason: a.reason, steps: false, sleep: false };
  const s = await call<{ readAuthorized: string[] }>("checkAuthorization", { read: ["steps", "sleep"] });
  return { available: true, steps: s.readAuthorized.includes("steps"), sleep: s.readAuthorized.includes("sleep") };
}

/** Opens Health Connect's permission screen for steps and sleep (and access to older data). */
export async function connectHealth(): Promise<HealthStatus> {
  const r = await call<{ readAuthorized: string[]; historyAccessAuthorized?: boolean }>("requestAuthorization", { read: ["steps", "sleep"], requestHistoryAccess: true });
  const st = { available: true, steps: r.readAuthorized.includes("steps"), sleep: r.readAuthorized.includes("sleep"), history: r.historyAccessAuthorized };
  ls.set(LS.connected, st.steps || st.sleep ? "1" : null);
  return st;
}
export const openHealthSettings = () => call<void>("openHealthConnectSettings");
export const disconnectHealth = () => { ls.set(LS.connected, null); ls.set(LS.last, null); };

const midnight = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd); };

/** Raw step records from one source, added up by local day (a record crossing midnight is split by time). */
export function stepsByDay(recs: StepRec[], key: string): { startDate: string; value: number }[] {
  const out: { startDate: string; value: number }[] = [];
  for (const r of recs) {
    if (sourceKey(r) !== key || !(r.value > 0)) continue;
    const a = new Date(r.startDate).getTime(), b = Math.max(a + 1, new Date(r.endDate).getTime());
    let t = a;
    while (t < b) {
      const d = new Date(t); const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const e = Math.min(b, next);
      out.push({ startDate: new Date(t).toISOString(), value: (r.value * (e - t)) / (b - a) });
      t = e;
    }
  }
  return out;
}

/** Today's steps from each app writing to Health Connect, and Health Connect's combined total. */
export interface StepSources {
  total: number;
  dayTotal: number | null;
  hours: { hour: number; steps: number }[];
  sources: { key: string; label: string; steps: number; records: number; first: string | null; last: string | null }[];
}
export async function stepSourcesToday(): Promise<StepSources> {
  const from = midnight(todayYmd()), to = new Date();
  const q = { dataType: "steps", startDate: from.toISOString(), endDate: to.toISOString() };
  const [agg, day, raw] = await Promise.all([
    call<{ samples: { startDate: string; value: number }[] }>("queryAggregated", { ...q, bucket: "hour", aggregation: "sum" }),
    call<{ samples: { value: number }[] }>("queryAggregated", { ...q, bucket: "day", aggregation: "sum" }).catch(() => null),
    call<{ samples: StepRec[] }>("readSamples", { ...q, limit: 0, ascending: true }),
  ]);
  const by = new Map<string, StepSources["sources"][number]>();
  const hhmm = (t: string) => new Date(t).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });
  for (const r of raw.samples) {
    // Only the part of a record after midnight counts for today
    const a = new Date(r.startDate).getTime(), b = Math.max(a + 1, new Date(r.endDate).getTime());
    const share = (Math.min(b, to.getTime()) - Math.max(a, from.getTime())) / (b - a);
    if (share <= 0) continue;
    const k = sourceKey(r);
    const x = by.get(k) ?? { key: k, label: sourceLabel(k), steps: 0, records: 0, first: null, last: null };
    x.steps += (r.value || 0) * share;
    x.records++;
    if (!x.first || r.startDate < x.first) x.first = r.startDate;
    if (!x.last || r.endDate > x.last) x.last = r.endDate;
    by.set(k, x);
  }
  return {
    total: Math.round(agg.samples.reduce((a, x) => a + (x.value || 0), 0)),
    dayTotal: day ? Math.round(day.samples.reduce((a, x) => a + (x.value || 0), 0)) : null,
    hours: agg.samples.filter((x) => x.value > 0).map((x) => ({ hour: new Date(x.startDate).getHours(), steps: Math.round(x.value) })),
    sources: [...by.values()].map((x) => ({ ...x, steps: Math.round(x.steps), first: x.first && hhmm(x.first), last: x.last && hhmm(x.last) })).sort((a, b) => b.steps - a.steps),
  };
}

/** One row per day: that day's steps (from hourly totals), and the main sleep (the longest session) that ended that day. */
export function summarise(steps: { startDate: string; value: number }[], sleep: Sample[]): Map<string, DayActivity> {
  const out = new Map<string, DayActivity>();
  const row = (day: string) => out.get(day) ?? (out.set(day, { day, steps: null, sleep_minutes: null, in_bed_minutes: null, deep_minutes: null, rem_minutes: null, light_minutes: null, awake_minutes: null, sleep_start: null, sleep_end: null }), out.get(day)!);
  // Steps come in hourly buckets: add them up by local day (24-hour buckets drift off midnight when the clocks change)
  for (const s of steps) if (s.value > 0) { const r = row(ymd(new Date(s.startDate))); r.steps = (r.steps ?? 0) + s.value; }
  for (const r of out.values()) if (r.steps != null) r.steps = Math.round(r.steps);
  const main = new Map<string, Sample>();
  for (const s of sleep) {
    const day = ymd(new Date(s.endDate));
    const len = (x: Sample) => new Date(x.endDate).getTime() - new Date(x.startDate).getTime();
    if (!main.has(day) || len(s) > len(main.get(day)!)) main.set(day, s);
  }
  for (const [day, s] of main) {
    const r = row(day);
    const inBed = Math.round((new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000);
    const by = (k: string) => Math.round((s.stages ?? []).filter((x) => x.stage === k).reduce((a, x) => a + x.durationMinutes, 0));
    if (s.stages?.length) {
      r.deep_minutes = by("deep"); r.rem_minutes = by("rem"); r.light_minutes = by("light"); r.awake_minutes = by("awake");
      const asleep = r.deep_minutes + r.rem_minutes + r.light_minutes + by("asleep");
      r.sleep_minutes = asleep > 0 ? asleep : Math.max(0, inBed - r.awake_minutes);
    } else r.sleep_minutes = Math.round(s.value || inBed);
    r.in_bed_minutes = inBed;
    r.sleep_start = s.startDate;
    r.sleep_end = s.endDate;
  }
  return out;
}

/** Steps for the window: Health Connect's combined hourly totals, or one chosen app's records (read a month at a time). */
async function readSteps(from: Date, to: Date): Promise<{ samples: { startDate: string; value: number }[] }> {
  const src = stepSource();
  if (!src) return call("queryAggregated", { dataType: "steps", startDate: from.toISOString(), endDate: to.toISOString(), bucket: "hour", aggregation: "sum" });
  const recs: StepRec[] = [];
  for (let a = from.getTime(); a < to.getTime(); a += 31 * 86400000) {
    const b = Math.min(to.getTime(), a + 31 * 86400000);
    const r = await call<{ samples: StepRec[] }>("readSamples", { dataType: "steps", startDate: new Date(a).toISOString(), endDate: new Date(b).toISOString(), limit: 0, ascending: true });
    // A record straddling a chunk edge comes back in both chunks: keep it once
    for (const x of r.samples) if (new Date(x.startDate).getTime() >= a || a === from.getTime()) recs.push(x);
  }
  return { samples: stepsByDay(recs, src) };
}

let syncing: Promise<number> | null = null;
/** Reads the last `days` days from Health Connect and saves them. Returns how many days were saved. */
export function syncHealth(days?: number): Promise<number> {
  if (syncing) return syncing;
  syncing = (async () => {
    const first = lastSync() == null;
    const n = days ?? (first ? 400 : 14);
    const from = midnight(addDays(todayYmd(), -(n - 1)));
    const to = new Date();
    const [st, sl] = await Promise.all([
      readSteps(from, to).catch(() => ({ samples: [] })),
      // Sleep that ended in the window started the evening before it
      call<{ samples: Sample[] }>("readSamples", { dataType: "sleep", startDate: new Date(from.getTime() - 86400000).toISOString(), endDate: to.toISOString(), limit: 1000, ascending: true }).catch(() => ({ samples: [] })),
    ]);
    const rows = [...summarise(st.samples, sl.samples).values()].filter((r) => r.day >= ymd(from));
    if (rows.length) {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("You're signed out. Sign in again.");
      const now = new Date().toISOString();
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from("daily_activity").upsert(rows.slice(i, i + 200).map((r) => ({ ...r, user_id: u.user!.id, source: "health_connect", synced_at: now })), { onConflict: "user_id,day" });
        if (error) throw error;
      }
    }
    ls.set(LS.last, String(Date.now()));
    return rows.length;
  })().finally(() => { syncing = null; });
  return syncing;
}

const n = (v: unknown) => (v == null ? null : Number(v));
export async function loadActivity(sinceDays = 400): Promise<DayActivity[]> {
  const { data, error } = await supabase.from("daily_activity").select("day, steps, sleep_minutes, in_bed_minutes, deep_minutes, rem_minutes, light_minutes, awake_minutes, sleep_start, sleep_end").gte("day", addDays(todayYmd(), -sinceDays)).order("day");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    day: r.day as string, steps: n(r.steps), sleep_minutes: n(r.sleep_minutes), in_bed_minutes: n(r.in_bed_minutes), deep_minutes: n(r.deep_minutes),
    rem_minutes: n(r.rem_minutes), light_minutes: n(r.light_minutes), awake_minutes: n(r.awake_minutes), sleep_start: (r.sleep_start as string) ?? null, sleep_end: (r.sleep_end as string) ?? null,
  }));
}

/** "7 h 12 m" */
export const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} m`;
