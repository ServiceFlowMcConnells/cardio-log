// Tweaks for one session on one day: add or drop sets, or swap an exercise. Never touches the template or the week plan.
import type { Template } from "./strength";

export interface Tweaks { sets: Record<string, number>; swaps: Record<string, string> } // keyed by the template's exercise id
const PREFIX = "rlntls:tweaks:";
const key = (date: string, templateId: string) => `${PREFIX}${date}:${templateId}`;
export const NO_TWEAKS: Tweaks = { sets: {}, swaps: {} };

export function loadTweaks(date: string, templateId: string): Tweaks {
  try {
    const raw = localStorage.getItem(key(date, templateId));
    if (raw) { const t = JSON.parse(raw) as Tweaks; return { sets: t.sets ?? {}, swaps: t.swaps ?? {} }; }
  } catch { /* private mode or bad JSON */ }
  return NO_TWEAKS;
}
export function saveTweaks(date: string, templateId: string, t: Tweaks) {
  try {
    // Tweaks only last the day: clear any from other days while we're here
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${date}:`)) localStorage.removeItem(k);
    }
    const empty = !Object.keys(t.sets).length && !Object.keys(t.swaps).length;
    if (empty) localStorage.removeItem(key(date, templateId));
    else localStorage.setItem(key(date, templateId), JSON.stringify(t));
  } catch { /* private mode */ }
}
export const hasTweaks = (t: Tweaks) => Object.values(t.sets).some((v) => v !== 0) || Object.keys(t.swaps).length > 0;

/** The session as you'll do it today. Keeps the template's id, so programs and the plan still count it. */
export function applyTweaks(t: Template, tw: Tweaks): Template {
  if (!hasTweaks(tw)) return t;
  return {
    ...t,
    exercises: t.exercises.map((te) => ({
      ...te,
      exercise_id: tw.swaps[te.exercise_id] ?? te.exercise_id,
      sets: Math.max(1, Math.min(10, te.sets + (tw.sets[te.exercise_id] ?? 0))),
    })),
  };
}

/** Rough session length: ~40 s a set plus the rest between sets, and a couple of minutes to set up each exercise. */
export function estimateMinutes(t: Template, defaultRest: number): number {
  let sec = 0;
  for (const te of t.exercises) {
    const rest = te.rest_sec ?? defaultRest;
    sec += te.sets * 40 + Math.max(0, te.sets - 1) * rest + 120;
  }
  return Math.max(5, Math.round(sec / 60 / 5) * 5);
}
