// Meditation: a quick log of minutes per session, shown as a small chart on the Recovery page.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { addDays, todayYmd } from "./nutrition";

export interface MeditationSession { id: string; day: string; minutes: number; created_at: string }

let cache: MeditationSession[] | null = null;
let loading: Promise<MeditationSession[]> | null = null;
const subs = new Set<(s: MeditationSession[]) => void>();
const emit = () => subs.forEach((f) => f(cache ?? []));

export async function loadMeditation(force = false): Promise<MeditationSession[]> {
  if (cache && !force) return cache;
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase.from("meditation_sessions").select("id, day, minutes, created_at").order("day", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    cache = [...((data ?? []) as MeditationSession[])];
    emit();
    return cache;
  })().finally(() => { loading = null; });
  return loading;
}

export function useMeditation(): MeditationSession[] | null {
  const [s, setS] = useState<MeditationSession[] | null>(cache);
  useEffect(() => {
    subs.add(setS);
    loadMeditation().catch(() => setS((x) => x ?? []));
    return () => { subs.delete(setS); };
  }, []);
  return s;
}

export async function addMeditation(day: string, minutes: number) {
  const { error } = await supabase.from("meditation_sessions").insert({ day, minutes });
  if (error) throw error;
  await loadMeditation(true);
}

export async function deleteMeditation(id: string) {
  const { error } = await supabase.from("meditation_sessions").delete().eq("id", id);
  if (error) throw error;
  await loadMeditation(true);
}

/** Total minutes per day. */
export function minutesByDay(s: MeditationSession[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of s) m.set(x.day, (m.get(x.day) ?? 0) + x.minutes);
  return m;
}

/** Days in a row with a session, ending today (or yesterday, so today isn't counted as broken until it's over). */
export function streak(byDay: Map<string, number>): number {
  const today = todayYmd();
  let d = byDay.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (byDay.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
