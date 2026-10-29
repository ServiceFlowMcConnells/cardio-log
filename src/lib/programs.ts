// Programs: an ordered rotation of workout templates (e.g. Hypertrophy A → Hypertrophy B → repeat).
// The active program decides "Next up". Finishing that workout advances the rotation; any single
// template can still be started on its own without moving it.
import { supabase } from "./supabase";
import type { Template, Workout } from "./strength";

export interface Program {
  id: string;
  name: string;
  notes: string | null;
  position: number;
  next_step: number;
  steps: string[]; // template ids, in order (a template can appear more than once)
}

type Row = Record<string, unknown>;

export async function loadPrograms(): Promise<{ programs: Program[]; activeId: string | null }> {
  const [{ data, error }, { data: st, error: e2 }] = await Promise.all([
    supabase.from("programs").select("id, name, notes, position, next_step, created_at, program_workouts(template_id, position)").order("position").order("created_at"),
    supabase.from("user_settings").select("active_program_id").maybeSingle(),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const programs = (data ?? []).map((p: Row) => ({
    id: p.id as string,
    name: p.name as string,
    notes: (p.notes as string) ?? null,
    position: Number(p.position ?? 0),
    next_step: Number(p.next_step ?? 0),
    steps: ((p.program_workouts as Row[]) ?? []).sort((a, b) => Number(a.position) - Number(b.position)).map((r) => r.template_id as string),
  }));
  const activeId = (st?.active_program_id as string | null) ?? null;
  return { programs, activeId: programs.some((p) => p.id === activeId) ? activeId : null };
}

export async function saveProgram(p: { id?: string; name: string; notes?: string | null; steps: string[]; next_step?: number }): Promise<string> {
  const head = { name: p.name.trim(), notes: p.notes?.trim() || null, updated_at: new Date().toISOString(), ...(p.next_step != null ? { next_step: p.next_step } : {}) };
  let id = p.id;
  if (id) {
    const { error } = await supabase.from("programs").update(head).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("programs").insert(head).select("id").single();
    if (error) throw error;
    id = data.id as string;
  }
  const pid = id as string;
  const { data: old, error: oldErr } = await supabase.from("program_workouts").select("id").eq("program_id", pid);
  if (oldErr) throw oldErr;
  if (p.steps.length) {
    const { error } = await supabase.from("program_workouts").insert(p.steps.map((template_id, position) => ({ program_id: pid, template_id, position })));
    if (error) throw error;
  }
  const oldIds = (old ?? []).map((r) => r.id as string);
  if (oldIds.length) {
    const { error } = await supabase.from("program_workouts").delete().in("id", oldIds);
    if (error) throw error;
  }
  return pid;
}

export async function deleteProgram(id: string): Promise<void> {
  const { error } = await supabase.from("programs").delete().eq("id", id);
  if (error) throw error;
}

export async function setActiveProgram(id: string | null): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("You're signed out. Sign in again.");
  const { error } = await supabase.from("user_settings").upsert({ user_id: u.user.id, active_program_id: id, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function setNextStep(programId: string, step: number): Promise<void> {
  const { error } = await supabase.from("programs").update({ next_step: step, updated_at: new Date().toISOString() }).eq("id", programId);
  if (error) throw error;
}

/** Steps whose template still exists, keeping their original index. */
export function liveSteps(p: Program, templates: Template[]): { index: number; template: Template }[] {
  return p.steps.map((id, index) => ({ index, template: templates.find((t) => t.id === id) })).filter((s): s is { index: number; template: Template } => Boolean(s.template));
}

/** The program's next workout (wrapping round), or null if it has none. */
export function nextInProgram(p: Program, templates: Template[]): { index: number; template: Template } | null {
  const steps = liveSteps(p, templates);
  if (!steps.length) return null;
  const at = p.next_step % p.steps.length;
  return steps.find((s) => s.index >= at) ?? steps[0];
}

export function advance(p: Program, from: number): number {
  return p.steps.length ? (from + 1) % p.steps.length : 0;
}

export interface NextUp {
  template: Template;
  program: Program | null;
  step: number | null; // index in the program
}

/** What to train next: the active program's next workout, else the template you've gone longest without. */
export function nextUp(d: { templates: Template[]; workouts: Workout[]; programs: Program[]; activeProgramId: string | null }): NextUp | null {
  const active = d.programs.find((p) => p.id === d.activeProgramId) ?? null;
  if (active) {
    const n = nextInProgram(active, d.templates);
    if (n) return { template: n.template, program: active, step: n.index };
  }
  if (!d.templates.length) return null;
  const lastDone = (t: Template) => d.workouts.find((w) => w.template_id === t.id)?.started_at ?? "";
  const t = [...d.templates].sort((a, b) => lastDone(a).localeCompare(lastDone(b)) || a.position - b.position)[0];
  return { template: t, program: null, step: null };
}

/** If starting `template` now is the active program's next step, which step it is. */
export function programStepFor(template: Template | null, d: { templates: Template[]; programs: Program[]; activeProgramId: string | null }): { programId: string; step: number } | null {
  if (!template) return null;
  const active = d.programs.find((p) => p.id === d.activeProgramId);
  if (!active) return null;
  const n = nextInProgram(active, d.templates);
  return n && n.template.id === template.id ? { programId: active.id, step: n.index } : null;
}
