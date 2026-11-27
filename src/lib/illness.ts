// Sickness from the readiness scan, and what it does to training.
//
// The neck check (a common sports-medicine rule of thumb): symptoms only above the neck (runny or stuffy nose,
// sneezing, a sore throat, a headache) mean light to moderate training is usually fine, so you choose: train as
// normal, lighten today, or rest. Anything below the neck or whole-body (fever, aches, a chest cough, stomach upset,
// unusual exhaustion) means rest. A fever needs a full day clear before lifting again (one day fever-free), and the
// first session back after resting is an easy one. A planned session skipped for sickness isn't "missed": the
// program waits, and it drops out of that week's count. Sessions while unwell, and the easy one back, are left
// out of progression and stall checks, like deloads. Planned cardio follows the same rule.
import type { Checkin } from "./readiness";
import type { Workout } from "./strength";

export interface Symptom { id: string; label: string; above: boolean }
export const SYMPTOMS: Symptom[] = [
  { id: "nose", label: "Runny or stuffy nose", above: true },
  { id: "sneezing", label: "Sneezing", above: true },
  { id: "throat", label: "Sore or scratchy throat", above: true },
  { id: "headache", label: "Headache", above: true },
  { id: "fever", label: "Fever or chills", above: false },
  { id: "aches", label: "Body aches", above: false },
  { id: "chest", label: "Chest cough or congestion", above: false },
  { id: "stomach", label: "Stomach upset", above: false },
  { id: "exhausted", label: "Unusual exhaustion", above: false },
];
const ABOVE = new Set(SYMPTOMS.filter((s) => s.above).map((s) => s.id));
/** Any symptom below the neck (or a fever): rest, no choice. */
export const belowNeck = (symptoms: string[]) => symptoms.some((s) => !ABOVE.has(s));
export type SickChoice = "normal" | "light" | "rest";
export const CHOICE_LABEL: Record<SickChoice, string> = { normal: "Train as normal", light: "Lighten today", rest: "Rest" };

export type Mode = { mode: SickChoice; reason: "sick" | "fever_clear" | "comeback" };

const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return ymdOf(d); };
const gap = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);

/** The choice a sick scan stands for (below the neck is always rest). */
export const choiceOf = (c: Checkin): SickChoice => (belowNeck(c.symptoms ?? []) ? "rest" : c.sick_choice ?? "normal");

let byDay = new Map<string, Checkin>(); // the latest scan each day
let sickDaysSorted: string[] = [];
let excluded = new Set<string>(); // workouts left out of progression
let key = "";
let lastWorkouts: Workout[] = [];

/** Called whenever check-ins or workouts change (cheap if nothing did). */
export function setIllnessData(checkins: Checkin[], workouts: Workout[]) {
  lastWorkouts = workouts;
  const k = `${checkins.length}:${checkins[0]?.id ?? ""}:${checkins.map((c) => (c.sick ? `${c.id}${c.sick_choice}${(c.symptoms ?? []).join()}` : "")).join("")}|${workouts.length}:${workouts[0]?.id ?? ""}`;
  if (k === key) return;
  key = k;
  byDay = new Map();
  for (const c of [...checkins].sort((a, b) => a.checked_at.localeCompare(b.checked_at))) byDay.set(ymdOf(new Date(c.checked_at)), c);
  sickDaysSorted = [...byDay.entries()].filter(([, c]) => c.sick).map(([d]) => d).sort();
  excluded = new Set();
  for (const w of workouts) {
    const d = ymdOf(new Date(w.started_at));
    if (byDay.get(d)?.sick) excluded.add(w.id);
  }
  // The first session back after an episode that included rest is an easy one: leave it out too
  for (const ep of episodes()) {
    if (!ep.rested) continue;
    const back = [...workouts].filter((w) => { const d = ymdOf(new Date(w.started_at)); return d > ep.end && gap(ep.end, d) <= 14 && !(dayMode(d, workouts)?.mode === "rest"); })
      .sort((a, b) => a.started_at.localeCompare(b.started_at))[0];
    if (back) excluded.add(back.id);
  }
}

interface Episode { start: string; end: string; fever: boolean; rested: boolean }
/** Runs of sick days (a gap of up to 2 days without a scan still counts as the same illness). */
function episodes(): Episode[] {
  const out: Episode[] = [];
  for (const d of sickDaysSorted) {
    const c = byDay.get(d)!;
    const fever = (c.symptoms ?? []).includes("fever");
    const rested = choiceOf(c) === "rest";
    const last = out[out.length - 1];
    // a well scan in between ends the episode
    const wellBetween = last ? [...byDay.entries()].some(([x, cc]) => x > last.end && x < d && !cc.sick) : false;
    if (last && !wellBetween && gap(last.end, d) <= 3) { last.end = d; last.fever ||= fever; last.rested ||= rested; }
    else out.push({ start: d, end: d, fever, rested });
  }
  return out;
}

/** Whether you're still unwell going by your last scan (it carries over until a scan says you're better). */
export function stillUnwell(checkins: Checkin[], excludeId?: string): Checkin | null {
  const last = checkins.find((c) => c.id !== excludeId);
  return last?.sick ? last : null;
}

/** What sickness does to training on a day: rest, lighten, or train as normal (null = nothing to do with sickness).
 *  With no scan that day, the last scan's sickness carries over (for up to 3 days). After a fever, the day of your
 *  first scan saying you're better is still a rest day (a full day fever-free), and the first session after an
 *  illness that included rest is an easy one. */
export function dayMode(day: string, workouts: Workout[] = lastWorkouts): Mode | null {
  const c = byDay.get(day);
  if (c?.sick) return { mode: choiceOf(c), reason: "sick" };
  // Carry-over covers today and earlier days without a scan, never the future: a planned day ahead isn't sick yet
  if (!c && day <= ymdOf(new Date())) {
    const before = [...byDay.keys()].filter((d) => d < day).sort().pop();
    const last = before ? byDay.get(before)! : null;
    if (last?.sick && gap(before!, day) <= 3) return { mode: choiceOf(last), reason: "sick" };
  }
  if (day > ymdOf(new Date())) return null; // future days: decided by that day's scan
  const prev = episodes().filter((e) => e.end < day).pop();
  if (!prev) return null;
  // the first well scan after the episode
  const firstWell = [...byDay.entries()].filter(([d, cc]) => d > prev.end && !cc.sick).map(([d]) => d).sort()[0];
  if (prev.fever && firstWell === day) return { mode: "rest", reason: "fever_clear" };
  if (prev.rested && firstWell && firstWell <= day && gap(prev.end, day) <= 14) {
    const from = prev.fever ? firstWell : prev.end; // after a fever, the clear day itself doesn't count
    const doneSince = workouts.some((w) => { const d = ymdOf(new Date(w.started_at)); return d > from && d < day; });
    if (!doneSince && !(prev.fever && day === firstWell)) return { mode: "light", reason: "comeback" };
  }
  return null;
}
export const todayMode = (workouts?: Workout[]) => dayMode(ymdOf(new Date()), workouts);
/** A planned session on this day is skipped for sickness. */
export const sickRestDay = (day: string) => dayMode(day)?.mode === "rest";
/** Today's session should be the easy version (lightened while mildly unwell, or the first one back). */
export const illnessLightToday = () => todayMode(lastWorkouts)?.mode === "light";
/** Workouts done while unwell, or the easy one back: not counted for progression or stalls. */
export const isIllWorkout = (w: Workout) => excluded.has(w.id);
export const isSickDay = (day: string) => Boolean(byDay.get(day)?.sick);
/** Sick periods as millisecond ranges, for charts. */
export const illnessSpans = () => episodes().map((e) => ({ from: new Date(`${e.start}T00:00:00`).getTime(), to: new Date(`${e.end}T23:59:59`).getTime() }));
export const weekHasIllness = (weekStart: Date) => { const d0 = ymdOf(weekStart); return Array.from({ length: 7 }, (_, i) => plus(d0, i)).some(isSickDay); };
export const MODE_TEXT: Record<Mode["reason"], Partial<Record<SickChoice, string>>> = {
  sick: { rest: "Sick day: rest", light: "Unwell: easy session", normal: "Unwell: training as normal" },
  fever_clear: { rest: "A day clear of fever before lifting" },
  comeback: { light: "First session back: easy" },
};
