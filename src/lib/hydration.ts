// Hydration: drinks logged in ml, one row each in water_log. Every row carries a client_id made on the device
// that logged it, so an insert can be retried (offline queue, the Android widget's queue, a flaky network)
// without ever counting twice. Each row also stores local_date: the calendar day where it was drunk, fixed at
// logging time, so travelling across time zones or DST never moves a drink to another day.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type WaterSource = "app" | "widget" | "web";
export interface WaterEntry { id?: string; client_id: string; logged_at: string; local_date: string; ml: number; source: WaterSource; pending?: boolean }

export const WATER_AMOUNTS = [150, 250, 330, 500, 750];
export { dailyTotals, hitRate, litres, localDate, newClientId, totalOn } from "./waterMath";
import { localDate, newClientId, totalOn } from "./waterMath";

// ---------- store ----------
const OUTBOX = "kata-water-outbox";
const readOutbox = (): WaterEntry[] => { try { return JSON.parse(localStorage.getItem(OUTBOX) ?? "[]"); } catch { return []; } };
const writeOutbox = (x: WaterEntry[]) => { try { localStorage.setItem(OUTBOX, JSON.stringify(x)); } catch { /* private mode: in memory only */ } };

let cache: WaterEntry[] | null = null;
let loading: Promise<WaterEntry[]> | null = null;
const subs = new Set<(s: WaterEntry[]) => void>();
const merged = () => {
  const out = readOutbox().filter((o) => !(cache ?? []).some((c) => c.client_id === o.client_id)).map((o) => ({ ...o, pending: true }));
  return [...out, ...(cache ?? [])].sort((a, b) => b.logged_at.localeCompare(a.logged_at));
};
const emit = () => { const all = merged(); subs.forEach((f) => f(all)); changeHooks.forEach((f) => f(all)); };
const changeHooks = new Set<(s: WaterEntry[]) => void>();
/** Called after every change (the Android widget listens to stay in step). */
export const onWaterChange = (f: (s: WaterEntry[]) => void) => { changeHooks.add(f); return () => changeHooks.delete(f); };
export const waterEntries = () => merged();

/** Loads the last ~400 days (plenty for the charts). */
export async function loadWater(force = false): Promise<WaterEntry[]> {
  if (cache && !force) return merged();
  if (loading && !force) return loading;
  loading = (async () => {
    await flushOutbox();
    const since = localDate(new Date(Date.now() - 400 * 86400000));
    const { data, error } = await supabase.from("water_log").select("id, client_id, logged_at, local_date, ml, source")
      .gte("local_date", since).order("logged_at", { ascending: false }).limit(10000);
    if (error) throw error;
    cache = (data ?? []) as WaterEntry[];
    emit();
    return merged();
  })().finally(() => { loading = null; });
  return loading;
}

export function useWater(): WaterEntry[] | null {
  const [s, setS] = useState<WaterEntry[] | null>(cache ? merged() : null);
  useEffect(() => {
    subs.add(setS);
    loadWater().catch(() => setS(merged()));
    return () => { subs.delete(setS); };
  }, []);
  return s;
}

/** Inserts rows, ignoring any whose client_id is already stored (so retries and double flushes are harmless). */
export async function insertWater(rows: Omit<WaterEntry, "id" | "pending">[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from("water_log")
    .upsert(rows.map(({ client_id, logged_at, local_date, ml, source }) => ({ client_id, logged_at, local_date, ml, source })), { onConflict: "client_id", ignoreDuplicates: true });
  if (error) throw error;
}

async function flushOutbox() {
  const box = readOutbox();
  if (!box.length) return;
  try {
    await insertWater(box);
    const sent = new Set(box.map((b) => b.client_id));
    writeOutbox(readOutbox().filter((b) => !sent.has(b.client_id)));
  } catch { /* still offline: try again next time */ }
}

/** Logs a drink straight away (shown at once; saved in the background, kept in an outbox if offline). */
export async function addWater(ml: number, source: WaterSource, at = new Date()): Promise<WaterEntry> {
  const e: WaterEntry = { client_id: newClientId(), logged_at: at.toISOString(), local_date: localDate(at), ml: Math.round(ml), source };
  writeOutbox([...readOutbox(), e]);
  emit();
  try {
    await insertWater([e]);
    writeOutbox(readOutbox().filter((b) => b.client_id !== e.client_id));
    cache = [e, ...(cache ?? []).filter((c) => c.client_id !== e.client_id)];
  } catch { /* stays in the outbox; flushed on the next load */ }
  emit();
  return e;
}

export async function deleteWater(clientId: string): Promise<void> {
  writeOutbox(readOutbox().filter((b) => b.client_id !== clientId));
  const before = cache;
  cache = (cache ?? []).filter((c) => c.client_id !== clientId);
  emit();
  const { error } = await supabase.from("water_log").delete().eq("client_id", clientId);
  if (error) { cache = before; emit(); throw error; }
}

/** Adds rows logged elsewhere (the widget's queue) to the local list after they've been inserted. */
export function mergeWater(rows: WaterEntry[]) {
  const have = new Set((cache ?? []).map((c) => c.client_id));
  cache = [...rows.filter((r) => !have.has(r.client_id)), ...(cache ?? [])];
  emit();
}

if (typeof window !== "undefined") window.addEventListener("online", () => { void flushOutbox().then(() => loadWater(true)).catch(() => undefined); });
