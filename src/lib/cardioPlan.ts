// Cardio planned in the week planner: a type and target minutes on a day. Shown against the weekly cardio target.
import { supabase } from "./supabase";
import type { Session } from "./types";

export type PlanMachine = "treadmill" | "bike" | "any";
export const PLAN_MACHINE_LABEL: Record<PlanMachine, string> = { treadmill: "Treadmill", bike: "Bike", any: "Any cardio" };
export interface PlannedCardio { id?: string; planned_on: string; machine: PlanMachine; minutes: number }

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function loadPlannedCardio(): Promise<PlannedCardio[]> {
  const since = ymdOf(new Date(Date.now() - 14 * 86400000));
  const { data, error } = await supabase.from("planned_cardio").select("id, planned_on, machine, minutes").gte("planned_on", since).order("planned_on").order("created_at");
  if (error) throw error;
  return (data ?? []) as PlannedCardio[];
}

/** Replaces the cardio plan for these dates with `rows`. */
export async function savePlannedCardio(dates: string[], rows: PlannedCardio[]): Promise<void> {
  if (!dates.length) return;
  const { error: d } = await supabase.from("planned_cardio").delete().in("planned_on", dates);
  if (d) throw d;
  const ins = rows.filter((r) => dates.includes(r.planned_on) && r.minutes >= 5).map(({ planned_on, machine, minutes }) => ({ planned_on, machine, minutes: Math.round(Math.min(300, minutes)) }));
  if (ins.length) {
    const { error } = await supabase.from("planned_cardio").insert(ins);
    if (error) throw error;
  }
}

/** Minutes of cardio logged on a local day. */
export const loggedOn = (sessions: Session[], day: string) =>
  sessions.filter((s) => ymdOf(new Date(s.performed_at)) === day).reduce((a, s) => a + s.blocks.reduce((b, x) => b + x.duration_min, 0), 0);

/**
 * Planned minutes still to come in a week: future days in full, and today's plan less what's already logged today.
 * Past days don't count (what you did is already in your logged minutes).
 */
export function plannedRemaining(plan: PlannedCardio[], sessions: Session[], weekDates: string[], today = ymdOf(new Date())): { total: number; byDay: number[] } {
  const byDay = weekDates.map((d) => {
    if (d < today) return 0;
    const p = plan.filter((x) => x.planned_on === d).reduce((a, x) => a + x.minutes, 0);
    return d === today ? Math.max(0, p - loggedOn(sessions, d)) : p;
  });
  return { total: byDay.reduce((a, b) => a + b, 0), byDay };
}
