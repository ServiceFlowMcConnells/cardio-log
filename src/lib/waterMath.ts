// Pure hydration helpers (no imports, so tests/hydration.test.ts can run them directly under Node).
type Row = { local_date: string; ml: number };

/** The calendar day of `at` in a time zone (default: this device's), as YYYY-MM-DD. */
export function localDate(at: Date = new Date(), timeZone?: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
/** Total ml per local_date. */
export function dailyTotals(entries: Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.local_date, (m.get(e.local_date) ?? 0) + e.ml);
  return m;
}
export const totalOn = (entries: Row[], day: string) => entries.reduce((a, e) => (e.local_date === day ? a + e.ml : a), 0);
/** "1.75" style litres: two decimals, trailing zero kept off for whole tenths ("3.0" stays one decimal). */
export function litres(ml: number): string {
  const l = ml / 1000;
  const two = l.toFixed(2);
  return two.endsWith("0") ? l.toFixed(1) : two;
}
/** Days that reached the target, of the days with any drinks logged. */
export function hitRate(totals: Map<string, number>, target: number, days?: string[]): { hit: number; of: number } {
  const ds = days ?? [...totals.keys()];
  const of = ds.filter((d) => (totals.get(d) ?? 0) > 0).length;
  return { hit: ds.filter((d) => (totals.get(d) ?? 0) >= target).length, of };
}
export const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); });

