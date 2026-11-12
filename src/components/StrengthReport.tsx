import { useMemo, useState } from "react";
import type { AppData } from "../App";
import type { LiftStatus, LiftTrend, Stat } from "../lib/strengthReport";
import { STATUS_LABEL, strengthReport } from "../lib/strengthReport";
import type { Muscle } from "../lib/strength";
import { fmtKg } from "../lib/strength";

type Group = "shoulders" | "chest" | "back" | "legs" | "arms" | "other";
const GROUPS: Group[] = ["shoulders", "chest", "back", "legs", "arms", "other"];
const GROUP_LABEL: Record<Group, string> = { shoulders: "Shoulders", chest: "Chest", back: "Back", legs: "Legs", arms: "Arms", other: "Core & other" };
const GROUP_OF: Record<Muscle, Group> = {
  shoulders: "shoulders", chest: "chest", back: "back",
  quads: "legs", hamstrings: "legs", glutes: "legs", calves: "legs",
  biceps: "arms", triceps: "arms", core: "other", full_body: "other", other: "other",
};
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const ICON: Record<LiftStatus, string> = { up: "▲", hold: "●", stalled: "⏸", down: "▼", few: "·" };
const sign = (n: number, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;

/** Strength report: the last 4 (or 8 / 12) weeks against the period before, in one standard layout. */
export default function StrengthReport({ data, onOpenExercise }: { data: AppData; onOpenExercise: (id: string) => void }) {
  const [weeks, setWeeks] = useState(4);
  const r = useMemo(() => strengthReport({ workouts: data.workouts, exercises: data.exercises, templates: data.templates, checkins: data.checkins, nutrition: data.nutrition, activity: data.activity, formula: data.settings.e1rm_formula }, weeks),
    [data.workouts, data.exercises, data.templates, data.checkins, data.nutrition, data.activity, data.settings.e1rm_formula, weeks]);
  const [open, setOpen] = useState<Set<Group>>(new Set());
  const c = r.context;
  // Lifts grouped by primary muscle area; a group's status is its typical (median) lift trend
  const groups = useMemo(() => {
    const muscle = new Map(data.exercises.map((e) => [e.id, e.muscle as Muscle]));
    const up = r.phase === "deficit" ? 0.25 : 0.5, down = r.phase === "deficit" ? -0.75 : -0.5;
    return GROUPS.map((g) => {
      const lifts = r.lifts.filter((l) => GROUP_OF[muscle.get(l.id) ?? "other"] === g);
      const rates = lifts.filter((l) => l.status !== "few").map((l) => l.slope ?? (l.change != null ? l.change / r.weeks : null)).filter((x): x is number => x != null);
      const rate = rates.length ? median(rates) : null;
      const n = (s: LiftStatus) => lifts.filter((l) => l.status === s).length;
      let status: LiftStatus = rate == null ? "few" : rate >= up ? "up" : rate <= down ? "down" : "hold";
      if (status === "hold" && n("stalled") * 2 > rates.length) status = "stalled";
      const tally = [n("up") && `${n("up")} up`, (n("hold") + n("stalled")) && `${n("hold") + n("stalled")} level`, n("down") && `${n("down")} down`, n("few") && `${n("few")} new`].filter(Boolean).join(" · ");
      return { g, lifts, rate, status, tally };
    }).filter((x) => x.lifts.length);
  }, [r, data.exercises]);
  const toggle = (g: Group) => setOpen((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  return (
    <section className="panel sr">
      <div className="page-head" style={{ marginBottom: 6 }}>
        <h2>Strength report</h2>
        <div className="seg sr-weeks" role="group" aria-label="Period">
          {[4, 8, 12].map((w) => <button key={w} className={weeks === w ? "on" : ""} aria-pressed={weeks === w} onClick={() => setWeeks(w)}>{w}W</button>)}
        </div>
      </div>
      <p className="small muted" style={{ margin: "0 0 10px" }}>
        Last {r.weeks} weeks vs the {r.weeks} before{r.phase ? ` · ${r.phase} phase` : ""}
      </p>

      {/* 1. Headline */}
      <div className={`sr-headline ${r.tone}`}>
        <span className="sr-chip">{r.tone === "good" ? "On track" : r.tone === "watch" ? "Watch" : "Needs attention"}</span>
        <p>{r.headline}</p>
      </div>

      {/* 2. Key numbers */}
      <div className="sr-stats">
        <Tile label="Sessions / week" s={r.sessionsPerWeek} d={1} />
        <Tile label="Working sets / week" s={r.setsPerWeek} d={0} />
        <div className="sr-tile">
          <span className="small muted">Lift change</span>
          <strong className="num">{r.medianChange != null ? `${sign(r.medianChange)}%` : "–"}</strong>
          <span className="small muted">median best e1RM</span>
        </div>
        <Tile label="Average RPE" s={r.avgRpe} d={1} lowerBetter />
      </div>

      {/* 3. Lift by lift */}
      {r.lifts.length > 0 && (
        <>
          <h3 className="sr-h">Lifts</h3>
          <div className="sr-lifts">
            {groups.map(({ g, lifts, rate, status, tally }) => (
              <div key={g} className={`sr-group${open.has(g) ? " open" : ""}`}>
                <button className={`sr-lift sr-group-head ${status}`} aria-expanded={open.has(g)} onClick={() => toggle(g)}>
                  <span className="sr-lift-main">
                    <span className="sr-lift-name">{GROUP_LABEL[g]} <span className="muted small">({lifts.length})</span></span>
                    <span className="small muted">{tally}</span>
                  </span>
                  <span className="sr-lift-val">
                    <strong className="num">{rate != null ? `${sign(rate)}%` : "–"}<small> /wk</small></strong>
                    <span className={`sr-status ${status}`}>{ICON[status]} {STATUS_LABEL[status]}</span>
                  </span>
                  <svg className="sr-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {open.has(g) && (
                  <div className="sr-group-body">
                    {lifts.map((l) => <LiftRow key={l.id} l={l} from={r.from} onOpen={() => onOpenExercise(l.id)} />)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* 4. Context */}
      <h3 className="sr-h">Context</h3>
      <div className="sr-context">
        <Ctx label="Bodyweight" now={c.weight.now != null ? `${fmtKg(Math.round(c.weight.now * 10) / 10)} kg` : null}
          sub={c.weight.now != null && c.weight.before != null ? `${sign(c.weight.now - c.weight.before)} kg${c.weightRate != null ? ` · ${sign(c.weightRate, 2)}% a week` : ""}` : c.weightRate != null ? `${sign(c.weightRate, 2)}% a week` : null} />
        <Ctx label="Relative strength" now={c.relative != null ? `${sign(c.relative)}%` : null} sub={c.relative != null ? "lift change minus weight change" : "needs weigh-ins in both periods"} tone={c.relative != null ? (c.relative > 0.5 ? "good" : c.relative < -2 ? "bad" : undefined) : undefined} />
        <Ctx label="Readiness" now={c.readiness.now != null ? String(Math.round(c.readiness.now)) : null} sub={c.readiness.now != null && c.readiness.before != null ? `${sign(c.readiness.now - c.readiness.before, 0)} vs before` : null} tone={c.readiness.now != null && c.readiness.now < 60 ? "bad" : undefined} />
        <Ctx label="Sleep" now={c.sleep.now != null ? `${c.sleep.now.toFixed(1)} h` : null} sub={c.sleep.now != null && c.sleep.before != null ? `${sign(c.sleep.now - c.sleep.before)} h vs before` : null} tone={c.sleep.now != null && c.sleep.now < 6.5 ? "bad" : undefined} />
        <Ctx label="Calories" now={c.kcal.avg != null ? Math.round(c.kcal.avg).toLocaleString("en-IE") : null} sub={c.kcal.target != null ? `target ${Math.round(c.kcal.target).toLocaleString("en-IE")}` : null} />
        <Ctx label="Protein" now={c.protein.avg != null ? `${Math.round(c.protein.avg)} g` : null} sub={c.protein.target != null ? `target ${Math.round(c.protein.target)} g` : null}
          tone={c.protein.avg != null && c.protein.target != null && c.protein.avg < c.protein.target * 0.9 ? "bad" : undefined} />
      </div>

      {/* 5. Flags and next steps */}
      <h3 className="sr-h">Flags and next steps</h3>
      <ul className="sr-flags">
        {r.flags.map((f, i) => <li key={i} className={f.tone}>{f.text}</li>)}
      </ul>
      <p className="chart-note" style={{ marginBottom: 0 }}>
        Groups show the median trend of their lifts; tap one to see each exercise. Trends are a straight-line fit through each lift's estimated 1RM per session, as % per week. {r.phase === "deficit" ? "In a deficit, +0.25% a week counts as progressing and only below −0.75% as slipping." : "Above +0.5% a week is progressing; below −0.5% is slipping."}
      </p>
    </section>
  );
}

function Tile({ label, s, d, lowerBetter }: { label: string; s: Stat; d: number; lowerBetter?: boolean }) {
  const diff = s.now != null && s.before != null ? s.now - s.before : null;
  const good = diff != null && Math.abs(diff) >= 10 ** -d / 2 ? (lowerBetter ? diff < 0 : diff > 0) : null;
  return (
    <div className="sr-tile">
      <span className="small muted">{label}</span>
      <strong className="num">{s.now != null ? s.now.toFixed(d) : "–"}</strong>
      <span className={`small ${good == null ? "muted" : good ? "ok" : "warn"}`}>{diff != null ? `${sign(diff, d)} vs ${s.before!.toFixed(d)}` : "no earlier data"}</span>
    </div>
  );
}

function Ctx({ label, now, sub, tone }: { label: string; now: string | null; sub: string | null; tone?: "good" | "bad" }) {
  return (
    <div className="sr-ctx">
      <span className="small muted">{label}</span>
      <strong className={`num${tone === "good" ? " ok" : tone === "bad" ? " warn" : ""}`}>{now ?? "–"}</strong>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

function LiftRow({ l, from, onOpen }: { l: LiftTrend; from: number; onOpen: () => void }) {
  return (
    <button className={`sr-lift ${l.status}`} onClick={onOpen}>
      <span className="sr-lift-main">
        <span className="sr-lift-name">{l.name}</span>
        <span className="small muted">{l.reason}</span>
      </span>
      <Spark pts={l.points} from={from} />
      <span className="sr-lift-val">
        <strong className="num">{l.now != null ? `${fmtKg(Math.round(l.now * 2) / 2)}` : "–"}<small> kg</small></strong>
        <span className={`sr-status ${l.status}`}>{ICON[l.status]} {STATUS_LABEL[l.status]}</span>
      </span>
    </button>
  );
}

/** Per-session e1RM; the earlier period faint, this period solid. */
function Spark({ pts, from }: { pts: { t: number; e: number }[]; from: number }) {
  if (pts.length < 2) return <span className="sr-spark" />;
  const W = 64, H = 22;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const lo = Math.min(...pts.map((p) => p.e)), hi = Math.max(...pts.map((p) => p.e));
  const x = (t: number) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * (W - 4) + 2 : W / 2);
  const y = (e: number) => (hi > lo ? H - 3 - ((e - lo) / (hi - lo)) * (H - 6) : H / 2);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.e).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="sr-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      {from > t0 && from < t1 && <rect x={0} y={0} width={x(from)} height={H} fill="var(--ground)" />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.t)} cy={y(last.e)} r={2.2} fill="currentColor" />
    </svg>
  );
}
