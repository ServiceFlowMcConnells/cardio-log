import { minutesByDay, streak, useMeditation } from "../lib/meditation";
import { dailyTotals, hitRate, litres, useWater } from "../lib/hydration";
import type { DayActivity } from "../lib/health";
import { hm } from "../lib/health";
import { addDays, fromYmd, todayYmd } from "../lib/nutrition";
import { DayChartCard } from "./DayChart";

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (n: number) => Math.round(n).toLocaleString("en-IE");

/** Week page: today's steps against the target, the 7-day average, and last night's sleep. */
export function ActivityCard({ activity, target }: { activity: DayActivity[]; target: number }) {
  const today = todayYmd();
  const week = activity.filter((d) => d.day > addDays(today, -7));
  if (!week.length) return null;
  const t = activity.find((d) => d.day === today);
  const steps = t?.steps ?? 0;
  const past = week.filter((d) => d.steps != null).map((d) => d.steps!); // last 7 days including today
  const a7 = avg(past);
  const night = t?.sleep_minutes != null ? t : null;
  return (
    <section className="panel act-card">
      <div className="act-row">
        <span className="act-label">Steps today</span>
        <span className="num"><strong>{fmt(steps)}</strong><span className="muted"> / {fmt(target)}</span></span>
      </div>
      <span className="fs2-track" style={{ marginTop: 6 }}><span className={`fs2-fill steps${steps >= target ? " hit" : ""}`} style={{ width: `${Math.min(100, (steps / target) * 100)}%` }} /></span>
      <p className="small muted" style={{ marginTop: 6 }}>
        {a7 != null && <>7-day average <strong className={a7 >= target ? "ok" : ""}>{fmt(a7)}</strong></>}
        {a7 != null && night && " · "}
        {night && <>Slept <strong>{hm(night.sleep_minutes!)}</strong>{night.deep_minutes != null && night.rem_minutes != null ? ` (deep ${hm(night.deep_minutes)}, REM ${hm(night.rem_minutes)})` : ""}</>}
      </p>
    </section>
  );
}

/** Daily bars for the last 30 days with the target as a dashed line. */
export function StepsChart({ activity, target }: { activity: DayActivity[]; target: number }) {
  const today = todayYmd();
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const by = new Map(activity.map((d) => [d.day, d.steps]));
  const vals = days.map((d) => by.get(d) ?? null);
  const max = Math.max(target * 1.15, ...vals.map((v) => v ?? 0));
  const W = 340, H = 150, padL = 4, padR = 34, padT = 8, padB = 18;
  const slot = (W - padL - padR) / days.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily steps, last 30 days">
      <line className="axis" x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} strokeDasharray="4 3" />
      <text x={W - padR + 4} y={y(target) + 4}>{target >= 1000 ? `${Math.round(target / 100) / 10}k` : target}</text>
      {vals.map((v, i) => v != null && (
        <rect key={days[i]} x={padL + i * slot + slot * 0.15} width={slot * 0.7} y={y(v)} height={Math.max(1, H - padB - y(v))} rx={1.5} className={`steps-bar${v >= target ? " hit" : ""}${days[i] === today ? " today" : ""}`}>
          <title>{`${fromYmd(days[i]).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}: ${fmt(v)} steps`}</title>
        </rect>
      ))}
      {[0, 14, 29].map((i) => <text key={i} x={padL + i * slot + slot / 2} y={H - 4} textAnchor={i === 0 ? "start" : i === 29 ? "end" : "middle"}>{fromYmd(days[i]).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}</text>)}
    </svg>
  );
}

/** Recovery page: water per day against the target, with the hit rate. */
export function HydrationChart({ target }: { target: number }) {
  const entries = useWater();
  if (!entries?.length) return null;
  const totals = dailyTotals(entries);
  const today = todayYmd();
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(today, -i - 1));
  const r30 = hitRate(totals, target, last30);
  const L = (v: number) => `${litres(v)} L`;
  return (
    <DayChartCard
      title="Hydration" kind="bar" target={target} initial={7}
      sub={({ avg, label }) => (avg != null ? `${label} ${L(avg)}` : undefined)}
      values={totals} fmt={L} axis={(v) => `${Math.round(v / 100) / 10} L`}
      barClass={(v) => `water-bar${v >= target ? " hit" : ""}`}
      extra={({ vals }) => (vals.length > 1 ? `target hit ${vals.filter((v) => v >= target).length} of ${vals.length}` : null)}
      note={`${r30.of ? `Target hit on ${r30.hit} of the ${r30.of} days you logged in the last 30. ` : ""}Daily target ${L(target)} (change it in Settings → Hydration).`}
    />
  );
}

/** Recovery page: minutes meditated per day, this week's total and the current streak. */
export function MeditationChart() {
  const sessions = useMeditation();
  if (!sessions?.length) return null;
  const byDay = minutesByDay(sessions);
  const today = todayYmd();
  const days7 = [...byDay.keys()].filter((d) => d > addDays(today, -7)).length;
  const run = streak(byDay);
  return (
    <DayChartCard
      title="Meditation" kind="bar" color="var(--lift)" initial={7}
      sub={({ total, days, end }) => `${Math.round(total)} min in ${days} days${run > 1 && end >= today ? ` · ${run}-day streak` : ""}`}
      values={byDay} fmt={(v) => `${Math.round(v)} min`} axis={(v) => `${Math.round(v)}`}
      extra={({ vals }) => (vals.length > 1 ? `${vals.length} days meditated` : null)}
      note={`${days7} of the last 7 days. Log a session from the + menu → Meditation.`}
    />
  );
}

/** Recovery page: steps and Health Connect sleep. */
export function ActivitySections({ activity, target }: { activity: DayActivity[]; target: number }) {
  const today = todayYmd();
  const recent = (n: number) => activity.filter((d) => d.day > addDays(today, -n));
  const steps30 = avg(recent(31).filter((d) => d.day < today && d.steps != null).map((d) => d.steps!));
  const hit = recent(31).filter((d) => d.day < today && d.steps != null);
  const sleeps = recent(8).filter((d) => d.sleep_minutes != null);
  const s = (k: keyof DayActivity) => avg(sleeps.map((d) => d[k] as number | null).filter((v): v is number => v != null));
  if (!activity.some((d) => d.steps != null || d.sleep_minutes != null)) return null;
  return (
    <>
      {activity.some((d) => d.steps != null) && (
        <DayChartCard
          title="Steps" kind="bar" target={target}
          sub={({ avg: a, label }) => (a != null ? `${label} ${fmt(a)}` : undefined)}
          values={new Map(activity.filter((d) => d.steps != null).map((d) => [d.day, d.steps!]))}
          fmt={fmt} axis={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))}
          barClass={(v) => `steps-bar${v >= target ? " hit" : ""}`}
          extra={({ vals }) => (vals.length > 1 ? `target hit ${vals.filter((v) => v >= target).length} of ${vals.length}` : null)}
          note={`${steps30 != null ? `30-day average ${fmt(steps30)}. ` : ""}${hit.length > 0 ? `Target hit on ${hit.filter((d) => d.steps! >= target).length} of the last ${hit.length} days. ` : ""}From Health Connect.`}
        />
      )}
      {sleeps.length > 0 && (
        <section className="section panel">
          <div className="page-head" style={{ marginBottom: 4 }}>
            <h2>Sleep stages</h2>
            <span className="muted small">7-night average</span>
          </div>
          <div className="act-sleep">
            {([["Asleep", "sleep_minutes"], ["Deep", "deep_minutes"], ["REM", "rem_minutes"], ["Light", "light_minutes"], ["Awake", "awake_minutes"]] as const).map(([l, k]) => s(k) != null && (
              <div key={k}><span className="small muted">{l}</span><strong className="num">{hm(s(k)!)}</strong></div>
            ))}
          </div>
          <p className="chart-note">From Health Connect: the longest sleep that ended each morning. Your readiness scan fills in last night's hours from this.</p>
        </section>
      )}
    </>
  );
}
