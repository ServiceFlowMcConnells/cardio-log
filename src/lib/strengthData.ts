import { supabase } from "./supabase";
import type { Exercise, Template, TemplateExercise, WSet, Workout } from "./strength";

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
type Row = Record<string, unknown>;

export async function loadExercises(): Promise<Exercise[]> {
  const { data, error } = await supabase.from("exercises").select("id, name, muscle, equipment, notes, archived").order("name");
  if (error) throw error;
  return (data ?? []) as Exercise[];
}

export async function saveExercise(e: Partial<Exercise> & { name: string }): Promise<Exercise> {
  const row = { name: e.name.trim(), muscle: e.muscle ?? "other", equipment: e.equipment ?? "barbell", notes: e.notes?.trim() || null, archived: e.archived ?? false };
  const q = e.id ? supabase.from("exercises").update(row).eq("id", e.id) : supabase.from("exercises").insert(row);
  const { data, error } = await q.select("id, name, muscle, equipment, notes, archived").single();
  if (error) {
    if (error.code === "23505") throw new Error(`You already have an exercise called "${row.name}".`);
    throw error;
  }
  return data as Exercise;
}

export async function addExercises(list: { name: string; muscle: string; equipment: string }[]): Promise<void> {
  if (!list.length) return;
  const { error } = await supabase.from("exercises").insert(list);
  if (error) throw error;
}

function teRow(r: Row): TemplateExercise {
  return {
    id: r.id as string,
    exercise_id: r.exercise_id as string,
    position: Number(r.position ?? 0),
    sets: Number(r.sets),
    rep_min: Number(r.rep_min),
    rep_max: Number(r.rep_max),
    target_rpe: num(r.target_rpe),
    rest_sec: num(r.rest_sec),
    notes: (r.notes as string) ?? null,
  };
}

export async function loadTemplates(): Promise<Template[]> {
  const { data, error } = await supabase
    .from("workout_templates")
    .select("id, name, notes, position, created_at, template_exercises(*)")
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((t: Row) => ({
    id: t.id as string,
    name: t.name as string,
    notes: (t.notes as string) ?? null,
    position: Number(t.position ?? 0),
    exercises: ((t.template_exercises as Row[]) ?? []).map(teRow).sort((a, b) => a.position - b.position),
  }));
}

export async function saveTemplate(t: { id?: string; name: string; notes: string; exercises: TemplateExercise[] }): Promise<string> {
  const head = { name: t.name.trim(), notes: t.notes.trim() || null, updated_at: new Date().toISOString() };
  let id = t.id;
  if (id) {
    const { error } = await supabase.from("workout_templates").update(head).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("workout_templates").insert(head).select("id").single();
    if (error) throw error;
    id = data.id as string;
  }
  const tid = id as string;
  const { data: old, error: oldErr } = await supabase.from("template_exercises").select("id").eq("template_id", tid);
  if (oldErr) throw oldErr;
  if (t.exercises.length) {
    const rows = t.exercises.map((e, i) => ({
      template_id: tid, exercise_id: e.exercise_id, position: i, sets: e.sets, rep_min: e.rep_min, rep_max: e.rep_max,
      target_rpe: e.target_rpe, rest_sec: e.rest_sec, notes: e.notes?.trim() || null,
    }));
    const { error } = await supabase.from("template_exercises").insert(rows);
    if (error) throw error;
  }
  const oldIds = (old ?? []).map((r) => r.id as string);
  if (oldIds.length) {
    const { error } = await supabase.from("template_exercises").delete().in("id", oldIds);
    if (error) throw error;
  }
  return tid;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("workout_templates").delete().eq("id", id);
  if (error) throw error;
}

function setRow(r: Row): WSet {
  return {
    id: r.id as string,
    exercise_id: r.exercise_id as string,
    exercise_position: Number(r.exercise_position ?? 0),
    set_number: Number(r.set_number ?? 1),
    set_type: (r.set_type as WSet["set_type"]) ?? "working",
    weight_kg: Number(r.weight_kg ?? 0),
    reps: Number(r.reps ?? 0),
    rpe: num(r.rpe),
  };
}

export async function loadWorkouts(): Promise<Workout[]> {
  const { data, error } = await supabase
    .from("workouts")
    .select("id, template_id, name, started_at, duration_min, notes, workout_sets(*)")
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((w: Row) => ({
    id: w.id as string,
    template_id: (w.template_id as string) ?? null,
    name: w.name as string,
    started_at: w.started_at as string,
    duration_min: num(w.duration_min),
    notes: (w.notes as string) ?? null,
    sets: ((w.workout_sets as Row[]) ?? []).map(setRow).sort((a, b) => a.exercise_position - b.exercise_position || a.set_number - b.set_number),
  }));
}

export async function saveWorkout(w: { id?: string; template_id: string | null; name: string; started_at: string; duration_min: number | null; notes: string; sets: WSet[] }): Promise<string> {
  const head = { template_id: w.template_id, name: w.name.trim() || "Workout", started_at: w.started_at, duration_min: w.duration_min, notes: w.notes.trim() || null };
  let id = w.id;
  if (id) {
    const { error } = await supabase.from("workouts").update(head).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("workouts").insert(head).select("id").single();
    if (error) throw error;
    id = data.id as string;
  }
  const wid = id as string;
  const { data: old, error: oldErr } = await supabase.from("workout_sets").select("id").eq("workout_id", wid);
  if (oldErr) throw oldErr;
  const rows = w.sets.map((s) => ({
    workout_id: wid, exercise_id: s.exercise_id, exercise_position: s.exercise_position, set_number: s.set_number,
    set_type: s.set_type, weight_kg: s.weight_kg, reps: s.reps, rpe: s.rpe,
  }));
  if (rows.length) {
    const { error } = await supabase.from("workout_sets").insert(rows);
    if (error) throw error;
  }
  const oldIds = (old ?? []).map((r) => r.id as string);
  if (oldIds.length) {
    const { error } = await supabase.from("workout_sets").delete().in("id", oldIds);
    if (error) throw error;
  }
  return wid;
}

export async function deleteWorkout(id: string): Promise<void> {
  const { error } = await supabase.from("workouts").delete().eq("id", id);
  if (error) throw error;
}
