import type { AppData } from "../App";
import type { Checkin } from "../lib/readiness";
import { BAND_LABEL, PHASE_LABEL, PHASE_RATE, bandFor, latestPhase, weeklyLossPct } from "../lib/readiness";
import { formatShort } from "../lib/dates";
import { TrendChart, type Point } from "./Charts";

const DAY = 86400000;

function rolling(points: Point[], days = 7): Point[] {
  return points.map((p) => {
    const win = points.filter((q) => q.t <= p.t && p.t - q.t < days * DAY);
    return { t: p.t, v: win.reduce((a, q) => a + q.v, 0) / win.length };
  });
}

export default function BodyProgress({ data, onScan }: { data: AppData; onScan: (c: Checkin | null) => void }) {
  const { checkins } = data;
  if (!checkins.length) {
    return (
      <div className="empty">
        <p>Readiness, sleep and bodyweight trends appear here after your first readiness scan.</p>
        <button className="btn primary" onClick={() => onScan(null)}>Take a readiness scan</button>
      </div>
    );
  }
  const asc = [...checkins].sort((a, b) => a.checked_at.localeCompare(b.checked_at));
  const pts = (f: (c: Checkin) => number | null) =>
    asc.filter((c) => f(c) != null).map((c) => ({ t: new Date(c.checked_at).getTime(), v: f(c) as number }));
  const score = pts((c) => c.score);
  const sleep = pts((c) => c.sleep_hours);
  const weight = pts((c) => c.bodyweight_kg);
  const recent = (p: Point[], days: number) => p.filter((q) => Date.now() - q.t < days * DAY);
  const avg = (p: Point[]) => (p.length ? p.reduce((a, q) => a + q.v, 0) / p.length : null);
  const score7 = avg(recent(score, 7));
  const sleep7 = avg(recent(sleep, 7));
  const rate = weeklyLossPct(checkins);
  const wAvg = rolling(weight);
  const firstW = weight[0]?.v;
  const lastAvg = wAvg[wAvg.length - 1]?.v;

  return (
    <>
      <section className="panel">
        <div className="page-head" style={{ marginBottom: 4 }}>
          <h2>Readiness</h2>
          {score7 != null && <span className="muted small">7-day average {Math.round(score7)} ({BAND_LABEL[bandFor(score7)]})</span>}
        </div>
        <TrendChart points={score} color="var(--lift)" unit="readiness" band={[70, 100]} />
        <p className="chart-note">The shaded band is "Ready" or better. A run of low scores in a deficit is a sign to talk to your coach about a diet break or a deload.</p>
      </section>

      {sleep.length > 0 && (
        <section className="section panel">
          <div className="page-head" style={{ marginBottom: 4 }}>
            <h2>Sleep</h2>
            {sleep7 != null && <span className="muted small">7-day average {sleep7.toFixed(1)} h</span>}
          </div>
          <TrendChart points={sleep} color="var(--bike)" unit="hours" band={[7, 9]} />
          <p className="chart-note">7–9 hours is the recommended range for adults. Under 6 hours cuts into strength and recovery.</p>
        </section>
      )}

      {weight.length > 0 && (
        <section className="section panel">
          <div className="page-head" style={{ marginBottom: 4 }}>
            <h2>Bodyweight</h2>
            {lastAvg != null && <span className="muted small">7-day average {lastAvg.toFixed(1)} kg</span>}
          </div>
          <TrendChart points={weight} avg={wAvg} color="var(--ink)" unit="kg" />
          <p className="chart-note">
            Dots are daily weigh-ins; the line is the 7-day average, which smooths out water swings.
            {rate != null && (() => {
              const phase = latestPhase(checkins);
              const change = -rate; // + = gaining
              const band = phase ? PHASE_RATE[phase] : null;
              const verdict = !band ? "" : change < band.lo ? `, ${phase === "surplus" ? "slower" : "faster"} than the ${PHASE_LABEL[phase!].toLowerCase()} target (${band.text})`
                : change > band.hi ? `, ${phase === "deficit" ? "slower" : "faster"} than the ${PHASE_LABEL[phase!].toLowerCase()} target (${band.text})` : `, on target for ${PHASE_LABEL[phase!].toLowerCase()} (${band.text})`;
              return ` You're ${rate >= 0 ? "losing" : "gaining"} about ${Math.abs(rate).toFixed(1)}% a week${verdict}.`;
            })()}
            {firstW != null && lastAvg != null && weight.length > 3 && ` ${(lastAvg - firstW > 0 ? "+" : "")}${(lastAvg - firstW).toFixed(1)} kg since your first weigh-in on ${formatShort(new Date(weight[0].t))}.`}
          </p>
        </section>
      )}

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
