import { supabase } from "./supabase";
import type { Block, Session, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

function normaliseBlock(r: Record<string, unknown>): Block {
  return {
    id: r.id as string,
    session_id: r.session_id as string,
    position: Number(r.position ?? 0),
    machine: r.machine as Block["machine"],
    duration_min: Number(r.duration_min),
    avg_hr: num(r.avg_hr),
    max_hr: num(r.max_hr),
    rpe: num(r.rpe),
    distance_km: num(r.distance_km),
    calories: num(r.calories),
    speed_kmh: num(r.speed_kmh),
    incline_pct: num(r.incline_pct),
    resistance: num(r.resistance),
    rpm: num(r.rpm),
    avg_watts: num(r.avg_watts),
    is_benchmark: Boolean(r.is_benchmark),
  };
}

export async function loadSessions(): Promise<Session[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, performed_at, notes, blocks(*)")
    .order("performed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    performed_at: s.performed_at as string,
    notes: (s.notes as string) ?? null,
    blocks: ((s.blocks as Record<string, unknown>[]) ?? []).map(normaliseBlock).sort((a, b) => a.position - b.position),
  }));
}

export async function loadSettings(): Promise<Settings> {
  const { data, error } = await supabase.from("user_settings").select("*").maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_SETTINGS };
  return {
    weekly_target_min: data.weekly_target_min,
    max_hr: data.max_hr,
    zone_low_pct: data.zone_low_pct,
    zone_high_pct: data.zone_high_pct,
    weight_increment: Number(data.weight_increment ?? DEFAULT_SETTINGS.weight_increment),
    default_rest_sec: data.default_rest_sec ?? DEFAULT_SETTINGS.default_rest_sec,
    e1rm_formula: data.e1rm_formula ?? DEFAULT_SETTINGS.e1rm_formula,
    deload_until: data.deload_until ?? null,
    week_start: data.week_start ?? DEFAULT_SETTINGS.week_start,
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("You're signed out. Sign in again.");
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: u.user.id, ...s, updated_at: new Date().toISOString() });
  if (error) throw error;
}

function blockRow(b: Block, sessionId: string, position: number) {
  return {
    session_id: sessionId,
    position,
    machine: b.machine,
    duration_min: b.duration_min,
    avg_hr: b.avg_hr == null ? null : Math.round(b.avg_hr),
    max_hr: b.max_hr == null ? null : Math.round(b.max_hr),
    rpe: b.rpe,
    distance_km: b.distance_km,
    calories: b.calories == null ? null : Math.round(b.calories),
    speed_kmh: b.machine === "treadmill" ? b.speed_kmh : null,
    incline_pct: b.machine === "treadmill" ? b.incline_pct : null,
    resistance: b.machine === "bike" ? b.resistance : null,
    rpm: b.machine === "bike" && b.rpm != null ? Math.round(b.rpm) : null,
    avg_watts: b.machine === "bike" && b.avg_watts != null ? Math.round(b.avg_watts) : null,
    is_benchmark: b.is_benchmark,
  };
}

/** Creates or updates a session. On edit, the new blocks are written before the old ones are removed. */
export async function saveSession(input: { id?: string; performed_at: string; notes: string; blocks: Block[] }): Promise<string> {
  const notes = input.notes.trim() || null;
  let id = input.id;
  if (id) {
    const { error } = await supabase.from("sessions").update({ performed_at: input.performed_at, notes }).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("sessions").insert({ performed_at: input.performed_at, notes }).select("id").single();
    if (error) throw error;
    id = data.id as string;
  }
  const sessionId = id as string;

  const { data: old, error: oldErr } = await supabase.from("blocks").select("id").eq("session_id", sessionId);
  if (oldErr) throw oldErr;

  const { error: insErr } = await supabase.from("blocks").insert(input.blocks.map((b, i) => blockRow(b, sessionId, i)));
  if (insErr) throw insErr;

  const oldIds = (old ?? []).map((r) => r.id as string);
  if (oldIds.length) {
    const { error: delErr } = await supabase.from("blocks").delete().in("id", oldIds);
    if (delErr) throw delErr;
  }
  return sessionId;
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) throw error;
}
