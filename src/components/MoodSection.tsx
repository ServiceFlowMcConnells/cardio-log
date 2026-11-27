import type { AppData } from "../App";
import { DayChartCard } from "./DayChart";
import { TrendChart, type Point } from "./Charts";
import { ymd } from "../lib/nutrition";
import { MOOD_LABELS, gadBand, gadScore, moodLinks } from "../lib/mood";
import { illnessSpans, isSickDay } from "../lib/illness";
import { deloadSpans, isDeloadDay } from "../lib/deload";
import { useMeditation } from "../lib/meditation";
import { formatShort } from "../lib/dates";

/** Shade a chart bucket: sick days first, then deload days. */
export const shadeDays = (start: string, end: string): "ill" | "deload" | null => {
  let deload = false;
  for (let d = start; d <= end; d = ymd(new Date(new Date(`${d}T12:00:00`).getTime() + 86400000))) {
    if (isSickDay(d)) return "ill";
    if (isDeloadDay(d)) deload = true;
  }
  return deload ? "deload" : null;
};

/** Recovery page: daily mood, the fortnightly GAD-7, and how mood lines up with your habits. */
export default function MoodSection({ data }: { data: AppData }) {
  const med = useMeditation();
  const asc = [...data.checkins].sort((a, b) => a.checked_at.localeCompare(b.checked_at));
  const mood = new Map<string, number>();
  const sleep = new Map<string, number>();
  for (const a of data.activity) if (a.sleep_minutes) sleep.set(a.day, a.sleep_minutes / 60);
  const gadPts: Point[] = [];
  const gadList: { at: string; score: number }[] = [];
  for (const c of asc) {
    const d = ymd(new Date(c.checked_at));
    if (c.mood != null) mood.set(d, c.mood);
    if (c.sleep_hours != null) sleep.set(d, c.sleep_hours);
    if (c.gad7 && c.gad7.length === 7) { const s = gadScore(c.gad7); gadPts.push({ t: new Date(c.checked_at).getTime(), v: s }); gadList.push({ at: c.checked_at, score: s }); }
  }
  if (!mood.size && !gadList.length) return null;

  const trained = new Set<string>([...data.workouts.map((w) => ymd(new Date(w.started_at))), ...data.sessions.map((s) => ymd(new Date(s.performed_at)))]);
  const steps = new Map<string, number>();
  for (const a of data.activity) if (a.steps != null) steps.set(a.day, a.steps);
  const meditated = new Set((med ?? []).map((m) => m.day));
  const { links, pending } = moodLinks({ mood, sleep, trainedDays: trained, steps, stepTarget: data.settings.step_target || 15000, meditated });
  const latest = gadList[gadList.length - 1];
  const f1 = (v: number) => v.toFixed(1);

  return (
    <>
      {mood.size > 0 && (
        <DayChartCard
          title="Mood" kind="line" color="var(--m-p)" floor={1} clamp={[1, 5]}
          sub={({ avg, label }) => (avg != null ? `${label} ${avg.toFixed(1)} (${MOOD_LABELS[Math.round(avg) - 1]})` : undefined)}
          values={mood} fmt={(v) => `${v.toFixed(1)} · ${MOOD_LABELS[Math.max(0, Math.min(4, Math.round(v) - 1))]}`} axis={(v) => MOOD_LABELS[Math.max(0, Math.min(4, Math.round(v) - 1))]}
          shade={shadeDays}
          note="From the mood row in your readiness scan, 1 Awful to 5 Great. Sick days are shaded S and deload days D, so a dip can be read in context."
        />
      )}

      {gadList.length > 0 && (
        <section className="section panel">
          <div className="page-head" style={{ marginBottom: 4 }}>
            <h2>Anxiety check-ins</h2>
            <span className="muted small">GAD-7, every 2 weeks</span>
          </div>
          <div className="gad-latest">
            <span className="tile-v num">{latest.score}</span>
            <span><strong>{gadBand(latest.score)}</strong><span className="small muted" style={{ display: "block" }}>{formatShort(new Date(latest.at))} · out of 21</span></span>
          </div>
          {gadPts.length >= 2 && <TrendChart points={gadPts} color="var(--m-k)" unit="points" band={[0, 4]} deloads={deloadSpans()} ill={illnessSpans()} />}
          <p className="chart-note">Over the previous 2 weeks. 0–4 minimal, 5–9 mild, 10–14 moderate, 15–21 severe. The shaded band is minimal.</p>
        </section>
      )}

      {mood.size > 0 && (
        <section className="section panel">
          <h2>Mood and your habits</h2>
          {links.length > 0 ? (
            <div className="mlinks">
              {links.map((l) => {
                const diff = l.yes.avg - l.no.avg;
                return (
                  <div key={l.id} className="mlink">
                    <span className="mlink-h">{l.label}</span>
                    <div className="mlink-row"><span>{l.yes.label}</span><strong className="num">{f1(l.yes.avg)}</strong><span className="small muted">{l.yes.n} days</span></div>
                    <div className="mlink-row"><span>{l.no.label}</span><strong className="num">{f1(l.no.avg)}</strong><span className="small muted">{l.no.n} days</span></div>
                    <span className={`small ${Math.abs(diff) < 0.2 ? "muted" : diff > 0 ? "ok" : "warn"}`}>{Math.abs(diff) < 0.2 ? "About the same" : `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} on average`}</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="small muted">Patterns appear once there are at least 5 days on each side of a comparison.</p>}
          {pending.length > 0 && links.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Not enough days yet for: {pending.join(", ").toLowerCase()}.</p>}
          <p className="chart-note">Average mood (1–5) on each kind of day. These are patterns in your own data, not causes: a good night's sleep and a good mood can share a reason.</p>
        </section>
      )}
    </>
  );
}
