import type { AppData } from "../App";
import { AREA_LABEL, areaScores } from "../lib/mobility";
import { addDays, startOfWeek } from "../lib/dates";
import { TrendChart, WeeklyBars } from "./Charts";
import { AreaBar } from "./MobilityTest";

export default function MobilityProgress({ data, onOpen }: { data: AppData; onOpen: () => void }) {
  const tests = [...data.mobilityTests].sort((a, b) => a.tested_at.localeCompare(b.tested_at));
  const sessions = data.mobilitySessions;
  if (!tests.length && !sessions.length) {
    return (
      <section className="section panel">
        <h2>Mobility</h2>
        <p className="muted small" style={{ margin: "6px 0 10px" }}>Take the mobility screen to get a score per area, then track it here as you retest.</p>
        <button className="btn primary" onClick={onOpen}>Open mobility</button>
      </section>
    );
  }
  const first = tests[0];
  const last = tests[tests.length - 1];
  const now = areaScores(last?.results ?? {});
  const base = tests.length > 1 ? areaScores(first.results) : {};
  const start = startOfWeek(new Date());
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const s = addDays(start, -7 * (7 - i));
    const e = addDays(s, 7).getTime();
    const days = new Set(sessions.filter((x) => { const t = new Date(x.done_at).getTime(); return t >= s.getTime() && t < e; }).map((x) => new Date(x.done_at).toDateString())).size;
    return { start: s, value: days };
  });

  return (
    <>
      {tests.length > 0 && (
        <section className="section panel">
          <div className="page-head" style={{ marginBottom: 4 }}>
            <h2>Mobility score</h2>
            <button className="link small" onClick={onOpen}>Open ›</button>
          </div>
          {tests.length > 1 && <TrendChart points={tests.map((t) => ({ t: new Date(t.tested_at).getTime(), v: t.score }))} color="var(--mob)" unit="score" band={[80, 100]} />}
          {Object.entries(now).map(([a, v]) => (
            <AreaBar key={a} label={AREA_LABEL[a as keyof typeof AREA_LABEL]} v={v!} prev={base[a as keyof typeof base]} />
          ))}
          <p className="chart-note">{tests.length > 1 ? "The tick on each bar is your first screen." : "Retest in 4 weeks to see a trend."}</p>
        </section>
      )}
      <section className="section panel">
        <h2 style={{ marginBottom: 4 }}>Mobility days per week</h2>
        <WeeklyBars weeks={weeks} target={5} unit="days" />
        <p className="chart-note">Little and often works best for range of motion: 5 or more short sessions a week beats one long one.</p>
      </section>
    </>
  );
}
