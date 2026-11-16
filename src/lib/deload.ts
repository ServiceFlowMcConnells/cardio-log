// Deload weeks: flagged in the week planner (or started from the coach), one row per week in deload_weeks.
// While one is on, the coach prescribes lighter, shorter sessions (see coach.ts, DELOAD). Sessions logged inside a
// deload are left out of progression, stall detection and strength trends, so the week after picks up from your
// last normal session as if the deload hadn't happened. Charts shade deload periods.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** The deload prescription, from the evidence (see the note in coach.ts). */
export const DELOAD = {
  setsFactor: 0.5, // about half the working sets: volume is the main thing a deload cuts
  repsFactor: 0.75, // about three quarters of the usual reps per set
  loadFactor: 0.9, // about 10% lighter
  rpe: 6, // 4 or so reps in the tank: well away from failure
} as const;

export interface Period { start: string; end: string } // YYYY-MM-DD, inclusive

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return ymdOf(d); };

let weeks: string[] = [];
let legacyUntil: string | null = null; // the old single "deload until" setting, still honoured
let loaded = false;
let loading: Promise<string[]> | null = null;
const subs = new Set<(w: string[]) => void>();
const emit = () => subs.forEach((f) => f(weeks));

export function setLegacyDeloadUntil(until: string | null) { legacyUntil = until; }

export async function loadDeloads(force = false): Promise<string[]> {
  if (loaded && !force) return weeks;
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase.from("deload_weeks").select("week_start").order("week_start");
    if (error) throw error;
    weeks = (data ?? []).map((r: { week_start: string }) => r.week_start);
    loaded = true;
    emit();
    return weeks;
  })().finally(() => { loading = null; });
  return loading;
}

/** Deload week starts; re-renders when they change. */
export function useDeloads(): string[] {
  const [w, setW] = useState<string[]>(weeks);
  useEffect(() => {
    subs.add(setW);
    loadDeloads().catch(() => undefined);
    return () => { subs.delete(setW); };
  }, []);
  return w;
}

export async function setDeloadWeek(weekStart: string, on: boolean): Promise<void> {
  if (on === weeks.includes(weekStart)) return;
  if (on) {
    const { error } = await supabase.from("deload_weeks").insert({ week_start: weekStart });
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await supabase.from("deload_weeks").delete().eq("week_start", weekStart);
    if (error) throw error;
  }
  await loadDeloads(true);
}

export const isDeloadWeek = (weekStart: string) => weeks.includes(weekStart);

export function deloadPeriods(): Period[] {
  const out = weeks.map((w) => ({ start: w, end: plus(w, 6) }));
  if (legacyUntil) out.push({ start: plus(legacyUntil, -6), end: legacyUntil });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export const isDeloadDay = (day: string) => deloadPeriods().some((p) => day >= p.start && day <= p.end);
/** Whether a moment (an ISO timestamp, e.g. a workout's start) falls in a deload, by your local calendar day. */
export const isDeloadAt = (iso: string) => isDeloadDay(ymdOf(new Date(iso)));
export const deloadToday = () => isDeloadDay(ymdOf(new Date()));
/** The deload covering today, if any. */
export const currentDeload = (): Period | null => { const t = ymdOf(new Date()); return deloadPeriods().find((p) => t >= p.start && t <= p.end) ?? null; };
/** Deload periods as millisecond ranges (start of first day to end of last), for charts. */
export const deloadSpans = () => deloadPeriods().map((p) => ({ from: new Date(`${p.start}T00:00:00`).getTime(), to: new Date(`${p.end}T23:59:59`).getTime() }));
/** Whether any day of the 7 from `weekStart` is in a deload (for weekly charts). */
export const weekHasDeload = (weekStart: Date) => { const d0 = ymdOf(weekStart); return Array.from({ length: 7 }, (_, i) => plus(d0, i)).some(isDeloadDay); };
