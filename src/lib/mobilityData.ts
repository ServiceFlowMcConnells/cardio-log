import { supabase } from "./supabase";
import type { MobilitySession, MobilityTest, Niggle, TestResult } from "./mobility";

type Row = Record<string, unknown>;

export async function loadMobilityTests(): Promise<MobilityTest[]> {
  const { data, error } = await supabase.from("mobility_tests").select("id, tested_at, results, score, notes").order("tested_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({ ...(r as unknown as MobilityTest), score: Number(r.score) }));
}

export async function saveMobilityTest(results: Record<string, TestResult>, score: number, notes: string | null): Promise<MobilityTest> {
  const { data, error } = await supabase.from("mobility_tests").insert({ results, score, notes }).select("id, tested_at, results, score, notes").single();
  if (error) throw error;
  return data as unknown as MobilityTest;
}

export async function deleteMobilityTest(id: string): Promise<void> {
  const { error } = await supabase.from("mobility_tests").delete().eq("id", id);
  if (error) throw error;
}

const NIG_COLS = "id, area, side, level, kind, red_flag, notes, created_at, updated_at, resolved_at";

export async function loadNiggles(): Promise<Niggle[]> {
  const { data, error } = await supabase.from("niggles").select(NIG_COLS).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({ ...(r as unknown as Niggle), level: Number(r.level) }));
}

export async function saveNiggle(n: Partial<Niggle> & Pick<Niggle, "area" | "side" | "level" | "kind" | "red_flag">): Promise<void> {
  const row = { area: n.area, side: n.side, level: n.level, kind: n.kind, red_flag: n.red_flag, notes: n.notes?.trim() || null, updated_at: new Date().toISOString() };
  const q = n.id ? supabase.from("niggles").update(row).eq("id", n.id) : supabase.from("niggles").insert(row);
  const { error } = await q;
  if (error) throw error;
}

export async function resolveNiggle(id: string): Promise<void> {
  const { error } = await supabase.from("niggles").update({ resolved_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function loadMobilitySessions(): Promise<MobilitySession[]> {
  const { data, error } = await supabase.from("mobility_sessions").select("id, done_at, kind, template_id, duration_sec, drills, feedback").order("done_at", { ascending: false }).limit(120);
  if (error) throw error;
  return (data ?? []) as unknown as MobilitySession[];
}

export async function saveMobilitySession(s: Omit<MobilitySession, "id" | "done_at">): Promise<void> {
  const { error } = await supabase.from("mobility_sessions").insert(s);
  if (error) throw error;
}
