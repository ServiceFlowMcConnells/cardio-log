// Daily mood (1–5, optional in the scan) and the fortnightly GAD-7. A personal record only: neither changes training.
import type { Checkin } from "./readiness";

export const MOOD_LABELS = ["Awful", "Bad", "Meh", "Good", "Great"];

/** GAD-7 (Spitzer et al., 2006): over the last 2 weeks, how often have you been bothered by... */
export const GAD_ITEMS = [
  "Feeling nervous, anxious or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless that it's hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid, as if something awful might happen",
];
export const GAD_OPTIONS = ["Not at all", "Several days", "More than half the days", "Nearly every day"];
export const gadScore = (a: number[]) => a.reduce((x, y) => x + y, 0);
/** Standard bands: 5, 10 and 15 are the cut-offs for mild, moderate and severe. */
export function gadBand(score: number): string {
  if (score >= 15) return "Severe";
  if (score >= 10) return "Moderate";
  if (score >= 5) return "Mild";
  return "Minimal";
}

const DAY = 86400000;
/** Every 14 days. Skipped once, it asks again next scan; skipped twice, it waits another fortnight. */
export function gadDue(checkins: Checkin[], now = Date.now(), excludeId?: string): boolean {
  const hist = checkins.filter((c) => c.id !== excludeId).sort((a, b) => b.checked_at.localeCompare(a.checked_at));
  const lastDone = hist.find((c) => c.gad7 && c.gad7.length === 7);
  let anchor = lastDone ? new Date(lastDone.checked_at).getTime() : 0;
  // two skips since it fell due restart the fortnight from the second skip
  const dueFrom = anchor + 14 * DAY;
  const skips = hist.filter((c) => c.gad7_skipped && new Date(c.checked_at).getTime() >= dueFrom).sort((a, b) => a.checked_at.localeCompare(b.checked_at));
  if (skips.length >= 2) anchor = new Date(skips[1].checked_at).getTime();
  return now - anchor >= 14 * DAY;
}

export interface MoodLink { id: string; label: string; yes: { label: string; avg: number; n: number }; no: { label: string; avg: number; n: number } }
const addDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** How mood lines up with sleep, training, steps and meditation. Only comparisons with 5+ days on each side.
 *  These are patterns in your own data, not causes. */
export function moodLinks(input: {
  mood: Map<string, number>; sleep: Map<string, number>; trainedDays: Set<string>; steps: Map<string, number>; stepTarget: number; meditated: Set<string>;
}): { links: MoodLink[]; pending: string[] } {
  const MIN = 5;
  const links: MoodLink[] = [];
  const pending: string[] = [];
  const split = (id: string, label: string, yesL: string, noL: string, test: (day: string) => boolean | null) => {
    const y: number[] = [], n: number[] = [];
    for (const [d, m] of input.mood) { const t = test(d); if (t === true) y.push(m); else if (t === false) n.push(m); }
    if (y.length >= MIN && n.length >= MIN) links.push({ id, label, yes: { label: yesL, avg: avg(y), n: y.length }, no: { label: noL, avg: avg(n), n: n.length } });
    else pending.push(label);
  };
  split("sleep", "Sleep", "After 7+ hours", "After under 7", (d) => { const h = input.sleep.get(d); return h == null ? null : h >= 7; });
  split("training", "Training", "The day after training", "The day after a rest day", (d) => input.trainedDays.has(addDay(d, -1)));
  split("steps", "Steps", "After hitting your step target", "After missing it", (d) => { const s = input.steps.get(addDay(d, -1)); return s == null ? null : s >= input.stepTarget; });
  split("meditation", "Meditation", "The day after meditating", "The day after not", (d) => input.meditated.has(addDay(d, -1)));
  return { links, pending };
}
