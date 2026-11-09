import type { AppData } from "../App";
import type { Checkin } from "../lib/readiness";
import { BAND_LABEL, PHASE_LABEL, bandFor } from "../lib/readiness";
import { formatShort } from "../lib/dates";
import { DayChartCard } from "./DayChart";
import { hm } from "../lib/health";
import { ymd } from "../lib/nutrition";
import { ActivitySections, MeditationChart } from "./Activity";

export default function BodyProgress({ data, onScan }: { data: AppData; onScan: (c: Checkin | null) => void }) {
  const { checkins } = data;
  if (!checkins.length) {
    return (
      <>
      <ActivitySections activity={data.activity} target={data.settings.step_target} />
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

  return (
    <>
      <DayChartCard
        title="Readiness" kind="line" color="var(--lift)" band={[70, 100]} floor={40} clamp={[0, 100]}
        sub={({ avg, label }) => (avg != null ? `${label} ${Math.round(avg)} (${BAND_LABEL[bandFor(avg)]})` : undefined)}
        values={scoreByDay} fmt={(v) => String(Math.round(v))} axis={(v) => String(Math.round(v))}
        extra={({ avg }) => BAND_LABEL[bandFor(avg)]}
        note='The shaded band is "Ready" or better. A run of low scores in a deficit is a sign to talk to your coach about a diet break or a deload.'
      />

      {sleepByDay.size > 0 && (
        <DayChartCard
          title="Sleep" kind="line" color="var(--bike)" band={[7, 9]}
          sub={({ avg, label }) => (avg != null ? `${label} ${avg.toFixed(1)} h` : undefined)}
          values={sleepByDay} fmt={(v) => hm(v * 60)} axis={(v) => `${Math.round(v * 10) / 10}h`}
          note="Hours from your readiness scans, or Health Connect on days without a scan. 7–9 hours is the recommended range for adults; under 6 cuts into strength and recovery."
        />
      )}

      <ActivitySections activity={data.activity} target={data.settings.step_target} />
      <MeditationChart />

      <section className="section">
        <h2>Recent scans</h2>
        <div className="panel list-panel" style={{ marginTop: 8 }}>
          {checkins.slice(0, 14).map((c) => (
            <button key={c.id} className="list-row" onClick={() => onScan(c)}>
              <span>
                <strong>{formatShort(new Date(c.checked_at))}</strong>
                <span className="muted small" style={{ display: "block" }}>
                  Sleep {c.sleep_quality}, energy {c.energy}, soreness {c.soreness}
                  {c.sleep_hours != null ? `, ${c.sleep_hours} h` : ""}{c.bodyweight_kg != null ? `, ${c.bodyweight_kg} kg` : ""}
                  {c.calorie_status ? `, ${PHASE_LABEL[c.calorie_status].toLowerCase()}${c.calories ? ` ${c.calories} kcal` : ""}` : ""}
                </span>
              </span>
              <span className={`ready-score sm band-${bandFor(c.score)}`}>{c.score}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
