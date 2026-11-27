import type { AppData } from "../App";
import type { Checkin } from "../lib/readiness";
import { BAND_LABEL, bandFor } from "../lib/readiness";
import { formatShort } from "../lib/dates";
import { DayChartCard } from "./DayChart";
import { hm } from "../lib/health";
import { ymd } from "../lib/nutrition";
import { ActivitySections, HydrationChart, MeditationChart } from "./Activity";
import MoodSection, { shadeDays } from "./MoodSection";
import { useBackHandler } from "../lib/backNav";
import { gadBand, gadScore } from "../lib/mood";
import EveningHabits from "./EveningHabits";

export type BodyMore = null | "activity" | "headspace" | "habits" | "routine" | "scans";
const MORE_TITLE: Record<Exclude<BodyMore, null>, string> = { activity: "Steps, sleep stages, water and meditation", headspace: "Headspace", habits: "Mood and your habits", routine: "Habits and evening check-ins", scans: "Recent scans" };

export default function BodyProgress({ data, onScan, more = null, setMore, onOpenEvening }: { data: AppData; onScan: (c: Checkin | null) => void; more?: string | null; setMore?: (m: BodyMore) => void; onOpenEvening?: (day: string) => void }) {
  const { checkins } = data;
  useBackHandler(more != null, () => setMore?.(null));
  if (!checkins.length) {
    return (
      <>
      <ActivitySections activity={data.activity} target={data.settings.step_target} />
      <HydrationChart target={data.settings.water_target_ml} />
      <MeditationChart />
      <div className="empty">
        <p>Readiness, sleep and bodyweight trends appear here after your first readiness scan.</p>
        <button className="btn primary" onClick={() => onScan(null)}>Take a readiness scan</button>
      </div>
      </>
    );
  }
  const asc = [...checkins].sort((a, b) => a.checked_at.localeCompare(b.checked_at));
  // One value per day: the day's last scan; sleep falls back to Health Connect
  const scoreByDay = new Map<string, number>();
  const sleepByDay = new Map<string, number>();
  for (const a of data.activity) if (a.sleep_minutes != null && a.sleep_minutes > 0) sleepByDay.set(a.day, a.sleep_minutes / 60);
  for (const c of asc) {
    const d = ymd(new Date(c.checked_at));
    scoreByDay.set(d, c.score);
    if (c.sleep_hours != null) sleepByDay.set(d, c.sleep_hours);
  }

  const gad = checkins.find((c) => c.gad7 && c.gad7.length === 7);
  const scansList = (
      <section className="section">
        <div className="panel list-panel" style={{ marginTop: 8 }}>
          {checkins.slice(0, more === "scans" ? 60 : 14).map((c) => (
            <button key={c.id} className="list-row" onClick={() => onScan(c)}>
              <span>
                <strong>{formatShort(new Date(c.checked_at))}</strong>
                <span className="muted small" style={{ display: "block" }}>
                  Sleep {c.sleep_quality}, energy {c.energy}, soreness {c.soreness}
                  {c.sleep_hours != null ? `, ${c.sleep_hours} h` : ""}{c.bodyweight_kg != null ? `, ${c.bodyweight_kg} kg` : ""}
                  {c.sick ? ", unwell" : ""}{c.mood != null ? `, mood ${c.mood}` : ""}
                </span>
              </span>
              <span className={`ready-score sm band-${bandFor(c.score)}`}>{c.score}</span>
            </button>
          ))}
        </div>
      </section>
  );
  if (more && setMore) {
    const m = more as Exclude<BodyMore, null>;
    return (
      <div className="more-view">
        <div className="more-head">
          <button className="icon-btn" onClick={() => setMore(null)} aria-label="Back to Recovery">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h2>{MORE_TITLE[m]}</h2>
        </div>
        {m === "activity" && (<><ActivitySections activity={data.activity} target={data.settings.step_target} /><HydrationChart target={data.settings.water_target_ml} /><MeditationChart /></>)}
        {m === "headspace" && <MoodSection data={data} part="headspace" />}
        {m === "habits" && <MoodSection data={data} part="habits" />}
        {m === "scans" && scansList}
        {m === "routine" && <EveningHabits data={data} onOpenDay={(d) => onOpenEvening?.(d)} />}
      </div>
    );
  }
  const row = (k: Exclude<BodyMore, null>, label: string, value: string) => (
    <button key={k} className="list-row" onClick={() => { setMore?.(k); window.scrollTo({ top: 0 }); }}>
      <span><strong>{label}</strong></span>
      <span className="row-v small muted">{value} ›</span>
    </button>
  );
  return (
    <>
      <DayChartCard
        id="chart-readiness"
        title="Readiness" kind="line" color="var(--lift)" band={[70, 100]} floor={40} clamp={[0, 100]}
        sub={({ avg, label }) => (avg != null ? `${label} ${Math.round(avg)} (${BAND_LABEL[bandFor(avg)]})` : undefined)}
        values={scoreByDay} fmt={(v) => String(Math.round(v))} axis={(v) => String(Math.round(v))}
        extra={({ avg }) => BAND_LABEL[bandFor(avg)]}
        shade={shadeDays}
        note='The green band is "Ready" or better; sick days are shaded S and deload days D. A run of low scores in a deficit is a sign to talk to your coach about a diet break or a deload.'
      />

      {sleepByDay.size > 0 && (
        <DayChartCard
          id="chart-sleep"
          title="Sleep" kind="line" color="var(--bike)" band={[7, 9]}
          sub={({ avg, label }) => (avg != null ? `${label} ${avg.toFixed(1)} h` : undefined)}
          values={sleepByDay} fmt={(v) => hm(v * 60)} axis={(v) => `${Math.round(v * 10) / 10}h`}
          note="Hours from your readiness scans, or Health Connect on days without a scan. 7–9 hours is the recommended range for adults; under 6 cuts into strength and recovery."
        />
      )}

      <MoodSection data={data} part="chart" />

      <section className="section panel prog-card">
        <h2>More</h2>
        <div className="list-panel more-list">
          {gad?.gad7 && row("headspace", "Headspace", `${gadScore(gad.gad7)} · ${gadBand(gadScore(gad.gad7))}`)}
          {checkins.some((c) => c.mood != null) && row("habits", "Mood and your habits", "patterns")}
          {row("routine", "Habits and evening check-ins", "streaks")}
          {row("activity", "Steps, sleep stages, water, meditation", "")}
          {row("scans", "Recent scans", String(checkins.length))}
        </div>
      </section>
    </>
  );
}
