// Desktop: one date range in the top bar that charts and lists on the laptop follow.
import { createContext, useContext } from "react";

export type RangePreset = "1w" | "1m" | "3m" | "4w" | "12w" | "6m" | "1y" | "all" | "custom";
export interface DeskRange { preset: RangePreset; from?: string; to?: string } // custom: YYYY-MM-DD, inclusive

type Preset = { id: Exclude<RangePreset, "custom">; label: string; days: number | null };
const ALL_PRESETS: Preset[] = [
  { id: "1w", label: "1W", days: 7 },
  { id: "1m", label: "1M", days: 30 },
  { id: "3m", label: "3M", days: 91 },
  { id: "4w", label: "4W", days: 28 },
  { id: "12w", label: "12W", days: 84 },
  { id: "6m", label: "6M", days: 182 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "all", label: "All", days: null },
];
const pick = (ids: string[]) => ids.map((id) => ALL_PRESETS.find((p) => p.id === id)!);
/** Laptop top bar. */
export const RANGE_PRESETS = pick(["4w", "12w", "6m", "1y", "all"]);
/** Phone: the bar under the Progress tabs. */
export const PHONE_PRESETS = pick(["1w", "1m", "3m", "6m", "1y", "all"]);

const KEY = "rlntls:desk-range";
export function loadDeskRange(key = KEY, fallback: RangePreset = "12w"): DeskRange {
  try {
    const r = JSON.parse(localStorage.getItem(key) ?? "null") as DeskRange | null;
    if (r && (r.preset !== "custom" || (r.from && r.to))) return r;
  } catch { /* private mode or bad JSON */ }
  return { preset: fallback };
}
export function saveDeskRange(r: DeskRange, key = KEY) {
  try { localStorage.setItem(key, JSON.stringify(r)); } catch { /* private mode */ }
}
export const PHONE_RANGE_KEY = "rlntls:phone-range";

const at = (ymd: string, end = false) => { const [y, m, d] = ymd.split("-").map(Number); return end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d); };

/** The range as dates: from is null for "All". `to` is the end of the last day. */
export function rangeBounds(r: DeskRange, now = new Date()): { from: Date | null; to: Date } {
  if (r.preset === "custom" && r.from && r.to) return { from: at(r.from), to: at(r.to, true) };
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const p = ALL_PRESETS.find((x) => x.id === r.preset);
  if (!p || p.days == null) return { from: null, to: end };
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - p.days + 1);
  return { from, to: end };
}
/** Whole weeks covered by the range (for weekly charts); null for "All". */
export function rangeWeeks(r: DeskRange, now = new Date()): number | null {
  const { from, to } = rangeBounds(r, now);
  if (!from) return null;
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / (7 * 86400000)));
}
export function rangeLabel(r: DeskRange): string {
  if (r.preset === "custom" && r.from && r.to) {
    const f = (s: string) => at(s).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "2-digit" });
    return `${f(r.from)} – ${f(r.to)}`;
  }
  return ({ "1w": "Last 7 days", "1m": "Last month", "3m": "Last 3 months", "4w": "Last 4 weeks", "12w": "Last 12 weeks", "6m": "Last 6 months", "1y": "Last year", all: "All time" } as Record<string, string>)[r.preset] ?? "";
}

export const DeskRangeContext = createContext<{ range: DeskRange; setRange: (r: DeskRange) => void } | null>(null);
/** The top bar's range on a laptop; null on the phone (screens keep their own controls there). */
export const useDeskRange = () => useContext(DeskRangeContext);
/** True if an ISO date/time or YYYY-MM-DD falls inside the range. */
export function inRange(r: DeskRange, when: string | Date, now = new Date()): boolean {
  const { from, to } = rangeBounds(r, now);
  const t = typeof when === "string" ? (when.length === 10 ? at(when) : new Date(when)) : when;
  return (!from || t >= from) && t <= to;
}
