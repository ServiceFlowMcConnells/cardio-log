// The evening check-in: what you did today (supplements, meditation), how the day went (stress, day rating,
// screens before bed) and three good things. One per day. Supplements are saved as a snapshot of that day's
// list, so later edits to the list never change past days. Never changes training.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { SupplementItem } from "./supplements";

export interface StackEntry { id: string; name: string; dose: string; slot: string; taken: boolean }
export interface EveningCheckin {
  id: string; day: string; stack: StackEntry[];
  stress: number | null; day_rating: number | null; screens_before_bed: boolean | null;
  gratitude: string[]; note: string | null;
}

let cache: EveningCheckin[] | null = null;
let loading: Promise<EveningCheckin[]> | null = null;
const subs = new Set<(s: EveningCheckin[]) => void>();
const emit = () => subs.forEach((f) => f(cache ?? []));

export async function loadEvenings(force = false): Promise<EveningCheckin[]> {
  if (cache && !force) return cache;
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase.from("evening_checkins").select("id, day, stack, stress, day_rating, screens_before_bed, gratitude, note").order("day", { ascending: false });
    if (error) throw error;
    cache = ((data ?? []) as EveningCheckin[]).map((e) => ({ ...e, stack: Array.isArray(e.stack) ? e.stack : [], gratitude: e.gratitude ?? [] }));
    emit();
    return cache;
  })().finally(() => { loading = null; });
  return loading;
}
export function useEvenings(): EveningCheckin[] | null {
  const [s, setS] = useState<EveningCheckin[] | null>(cache);
  useEffect(() => {
    subs.add(setS);
    loadEvenings().catch(() => setS((x) => x ?? []));
    return () => { subs.delete(setS); };
  }, []);
  return s;
}

export async function saveEvening(e: Omit<EveningCheckin, "id">) {
  const row = { ...e, gratitude: e.gratitude.map((g) => g.trim()).filter(Boolean).slice(0, 3), note: e.note?.trim() || null, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("evening_checkins").upsert(row, { onConflict: "user_id,day" });
  if (error) throw error;
  await loadEvenings(true);
}

/** The list as it stands now, as a snapshot to tick against (a saved day keeps its own snapshot). */
export const snapshotOf = (items: SupplementItem[]): StackEntry[] => items.filter((i) => !i.retired_at).map((i) => ({ id: i.id, name: i.name, dose: i.dose, slot: i.slot, taken: false }));
/** Full stack that day, judged against that day's own list. */
export const fullStack = (e: EveningCheckin) => e.stack.length > 0 && e.stack.every((s) => s.taken);
export const showEveningCard = (now = new Date()) => now.getHours() >= 20;
