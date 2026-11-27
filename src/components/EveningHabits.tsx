import type { AppData } from "../App";
import Note from "./Note";
import { fullStack, useEvenings, type EveningCheckin } from "../lib/evening";
import { minutesByDay, useMeditation } from "../lib/meditation";
import { addDays, todayYmd, ymd } from "../lib/nutrition";

const DAYS = 28;
interface Row { id: string; label: string; test: (day: string, e: EveningCheckin | undefined) => boolean }
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Recovery → More → Habits: a 4-week grid per habit with streaks (tap a day to open its evening check-in),
 *  and how evening habits line up with the next morning's readiness, sleep and mood. */
export default function EveningHabits({ data, onOpenDay }: { data: AppData; onOpenDay: (day: string) => void }) {
  const evenings = useEvenings();
  const med = useMeditation();
  if (!evenings || !med) return <p className="muted small">Loading…</p>;
  const byDay = new Map(evenings.map((e) => [e.day, e]));
  const medDays = minutesByDay(med);
  const today = todayYmd();
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i - DAYS + 1));
  const rows: Row[] = [
    { id: "done", label: "Check-in done", test: (_d, e) => Boolean(e) },
    { id: "stack", label: "Full supplement stack", test: (_d, e) => Boolean(e && fullStack(e)) },
    { id: "med", label: "Meditation", test: (d) => (medDays.get(d) ?? 0) > 0 },
    { id: "screens", label: "Screen-free last hour", test: (_d, e) => e?.screens_before_bed === false },
    { id: "good", label: "Three good things", test: (_d, e) => (e?.gratitude.filter(Boolean).length ?? 0) >= 3 },
  ];
  // A streak counts back from today, or from yesterday if today isn't done yet
  const streak = (r: Row) => {
    let d = r.test(today, byDay.get(today)) ? today : addDays(today, -1);
    let n = 0;
    while (r.test(d, byDay.get(d))) { n++; d = addDays(d, -1); }
    return n;
  };

  // Next morning: readiness, sleep and mood from the scan the day after
  const morning = new Map<string, { score: number; sleep: number | null; mood: number | null }>();
  for (const c of [...data.checkins].reverse()) morning.set(ymd(new Date(c.checked_at)), { score: c.score, sleep: c.sleep_hours, mood: c.mood ?? null });
  for (const a of data.activity) { const m = morning.get(a.day); if (m && m.sleep == null && a.sleep_minutes) m.sleep = a.sleep_minutes / 60; }
  type Split = { label: string; yes: string; no: string; test: (e: EveningCheckin, d: string) => boolean | null };
  const splits: Split[] = [
    { label: "Full supplement stack", yes: "Took it all", no: "Missed some", test: (e) => (e.stack.length ? fullStack(e) : null) },
    { label: "Meditation", yes: "Meditated", no: "Didn't", test: (_e, d) => (medDays.get(d) ?? 0) > 0 },
    { label: "Stress", yes: "High (4–5)", no: "Lower (1–3)", test: (e) => (e.stress == null ? null : e.stress >= 4) },
    { label: "Screens in the last hour", yes: "Screens", no: "Screen-free", test: (e) => e.screens_before_bed },
  ];
  // single supplements that appear often enough, tracked by item (names can change)
  const itemNames = new Map<string, string>();
  for (const e of evenings) for (const s of e.stack) itemNames.set(s.id, s.name);
  for (const [id, name] of itemNames) {
    splits.push({ label: name, yes: "Taken", no: "Not taken", test: (e) => { const s = e.stack.find((x) => x.id === id); return s ? s.taken : null; } });
  }
  const MIN = 5;
  const results = splits.map((sp) => {
    const yes: { score: number; sleep: number | null; mood: number | null }[] = [];
    const no: typeof yes = [];
    for (const e of evenings) {
      const m = morning.get(addDays(e.day, 1));
      if (!m) continue;
      const t = sp.test(e, e.day);
      if (t === true) yes.push(m); else if (t === false) no.push(m);
    }
    if (yes.length < MIN || no.length < MIN) return null;
    const metric = (k: "score" | "sleep" | "mood") => {
      const a = yes.map((x) => x[k]).filter((v): v is number => v != null), b = no.map((x) => x[k]).filter((v): v is number => v != null);
      return a.length >= MIN && b.length >= MIN ? { a: avg(a), b: avg(b) } : null;
    };
    return { sp, n: [yes.length, no.length], ready: metric("score"), sleep: metric("sleep"), mood: metric("mood") };
  }).filter(Boolean) as { sp: Split; n: number[]; ready: { a: number; b: number } | null; sleep: { a: number; b: number } | null; mood: { a: number; b: number } | null }[];
  const fmt = (k: "ready" | "sleep" | "mood", v: number) => (k === "ready" ? String(Math.round(v)) : k === "sleep" ? `${v.toFixed(1)} h` : v.toFixed(1));

  return (
    <>
      <section className="section panel prog-card">
        <h2>Last 4 weeks</h2>
        <div className="hab-grid" role="table" aria-label="Habits, last 4 weeks">
          {rows.map((r) => (
            <div key={r.id} className="hab-row" role="row">
              <div className="hab-label" role="rowheader"><strong>{r.label}</strong><span className="small muted">{streak(r)}-day streak</span></div>
              <div className="hab-cells">
                {days.map((d) => {
                  const on = r.test(d, byDay.get(d));
                  return <button key={d} role="cell" className={`hab-cell${on ? " on" : ""}${d === today ? " today" : ""}`} onClick={() => onOpenDay(d)} aria-label={`${d}: ${on ? "yes" : "no"}. Open that day's check-in`} title={d} />;
                })}
              </div>
            </div>
          ))}
        </div>
        <Note>Each square is a day, oldest on the left. Tap one to open or fill in that day's evening check-in, including its three good things and note.</Note>
      </section>

      <section className="section panel prog-card">
        <h2>Evening habits and your next morning</h2>
        {results.length === 0 ? <p className="small muted">Comparisons appear once there are at least 5 evenings on each side, each followed by a morning scan.</p> : (
          <div className="mlinks">
            {results.map((r) => (
              <div key={r.sp.label} className="mlink">
                <span className="mlink-h">{r.sp.label}</span>
                <div className="mlink-row small muted"><span /><span>{r.sp.yes}</span><span>{r.sp.no}</span></div>
                {(["ready", "sleep", "mood"] as const).map((k) => r[k] && (
                  <div key={k} className="mlink-row"><span>{k === "ready" ? "Readiness" : k === "sleep" ? "Sleep" : "Mood"}</span><strong className="num">{fmt(k, r[k]!.a)}</strong><strong className="num">{fmt(k, r[k]!.b)}</strong></div>
                ))}
                <span className="small muted">{r.n[0]} vs {r.n[1]} evenings</span>
              </div>
            ))}
          </div>
        )}
        <Note>Averages for the morning after each kind of evening. These are patterns in your own data, not causes: a stressful day and a poor night can share a reason.</Note>
      </section>
    </>
  );
}
