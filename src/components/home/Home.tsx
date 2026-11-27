import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppData } from "../../App";
import type { Template, Workout } from "../../lib/strength";
import { MUSCLE_LABEL } from "../../lib/strength";
import type { Checkin } from "../../lib/readiness";
import { BAND_LABEL, LOW_RUN, adjustmentFor, latestPhase, lowReadinessCount, todaysCheckin } from "../../lib/readiness";
import { addDays, startOfWeek } from "../../lib/dates";
import { addDaysYmd, nextDays, planAdvice, plannedTemplate, ymd } from "../../lib/schedule";
import { nextUp } from "../../lib/programs";
import { deloadToday } from "../../lib/deload";
import { plannedRemaining } from "../../lib/cardioPlan";
import { emptyWeek, groupByWeek, zoneFor } from "../../lib/calc";
import { weekKey } from "../../lib/dates";
import { dailyQuote } from "../../lib/quotes";
import { applyTweaks, estimateMinutes, hasTweaks, loadTweaks } from "../../lib/tweaks";
import { WATER_AMOUNTS, addWater, deleteWater, litres, localDate, totalOn, useWater } from "../../lib/hydration";
import type { WaterEntry } from "../../lib/hydration";
import { writeWaterToHealth } from "../../lib/health";
import { inAndroidApp } from "../../lib/nativeTimer";
import { todayYmd, addDays as addYmd } from "../../lib/nutrition";
import { useDesktop } from "../../lib/desktop";
import Chevrons from "../Chevrons";
import { MODE_TEXT, isSickDay, sickRestDay, todayMode } from "../../lib/illness";
import { fullStack, showEveningCard, useEvenings } from "../../lib/evening";

export interface HeroSession { template: Template; date: string; label: string; sub: string | null }

interface Props {
  data: AppData;
  onPreview: (s: HeroSession) => void;
  onPlan: () => void;
  goSettings: () => void;
  onScan: (c: Checkin | null) => void;
  onSteps: () => void;
  onCardio: () => void;
  onEvening: () => void;
  onOpenWorkout: (w: Workout) => void;
  /** Laptop: the preview shows beside the hero rather than as its own screen. */
  side?: React.ReactNode;
}

const sameDay = (w: Workout, d: string) => ymd(new Date(w.started_at)) === d;
const dayWord = (d: string, today: string) => {
  if (d === today) return "Today";
  if (d === addDaysYmd(today, 1)) return "Tomorrow";
  return new Date(d + "T12:00:00").toLocaleDateString("en-IE", { weekday: "long" });
};

/** Today's or the next session: planned first, else the program's next step. */
export function heroSession(data: AppData, today = ymd(new Date())): HeroSession | null {
  const { planned, templates, workouts } = data;
  const doneToday = workouts.some((w) => sameDay(w, today));
  const tpl = (id: string) => templates.find((t) => t.id === id);
  const programSub = (t: Template) => {
    const up = nextUp(data);
    return up && up.template.id === t.id && up.program && up.step != null ? `${up.program.name} · workout ${String.fromCharCode(65 + up.step)} of ${up.program.steps.length}` : null;
  };
  const todayPlan = planned.find((p) => p.planned_on === today && tpl(p.template_id));
  const restToday = sickRestDay(today);
  if (todayPlan && !doneToday && !restToday) {
    const t = tpl(todayPlan.template_id)!;
    return { template: t, date: today, label: "Today", sub: programSub(t) };
  }
  const next = planned.filter((p) => p.planned_on > today && tpl(p.template_id)).sort((a, b) => a.planned_on.localeCompare(b.planned_on))[0];
  if (next) {
    const t = tpl(next.template_id)!;
    return { template: t, date: next.planned_on, label: dayWord(next.planned_on, today), sub: programSub(t) };
  }
  if (!doneToday) {
    const up = nextUp(data);
    if (up) return { template: up.template, date: restToday ? addDaysYmd(today, 1) : today, label: "Next up", sub: up.program && up.step != null ? `${up.program.name} · workout ${String.fromCharCode(65 + up.step)} of ${up.program.steps.length}` : null };
  }
  return null;
}

/** Shrinks a display title until its longest word fits on one line, so names never break mid-word. */
function FitName({ text, className = "hero-name" }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth + 1 && size > 22) { size -= 2; el.style.fontSize = `${size}px`; }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);
  return <span ref={ref} className={className}>{text}</span>;
}

export default function Home({ data, onPreview, onPlan, goSettings, onScan, onSteps, onCardio, onEvening, onOpenWorkout, side }: Props) {
  const evenings = useEvenings();
  const desktop = useDesktop();
  const today = ymd(new Date());
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const start = startOfWeek(now);
  const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(start, i)));
  const { planned, templates, workouts, exercises } = data;
  const tpl = (id: string) => templates.find((t) => t.id === id);

  // Ticker: one segment per planned strength session; any session this week fills the next one
  const doneWeek = workouts.filter((w) => days.includes(ymd(new Date(w.started_at))));
  // A session skipped for sickness drops out of the week's count
  const plannedWeek = planned.filter((p) => days.includes(p.planned_on) && tpl(p.template_id) && !(sickRestDay(p.planned_on) && !doneWeek.some((w) => sameDay(w, p.planned_on))));
  const P = plannedWeek.length;
  const D = doneWeek.length;
  const left = Math.max(0, P - D);
  const stillToCome = plannedWeek.filter((p) => p.planned_on > today || (p.planned_on === today && !doneWeek.some((w) => sameDay(w, today)))).length;
  const perfectPossible = left <= stillToCome;
  const deload = deloadToday();
  const label = P === 0 ? (D ? `${D} session${D === 1 ? "" : "s"} this week` : "No sessions planned yet")
    : left === 0 ? "Perfect week ✓"
    : perfectPossible ? `Perfect week · ${left} session${left === 1 ? "" : "s"} left`
    : `${D} of ${P} done · ${Math.min(left, stillToCome)} left`;
  const subLabel = deload ? "Deload week" : P === 0 ? null : `${P} planned this week`;

  // Coach spacing check, as one line
  const upcoming = nextDays(7).map((d) => ({ date: d, template: tpl(planned.find((p) => p.planned_on === d)?.template_id ?? "") ?? null }));
  const advice = planned.some((p) => p.planned_on >= today) ? planAdvice(upcoming, exercises, latestPhase(data.checkins)) : null;
  const flag = advice?.items.find((i) => i.tone === "bad" || i.tone === "warn");

  const hero = heroSession(data, today);
  const doneToday = workouts.filter((w) => sameDay(w, today));
  const restToday = !planned.some((p) => p.planned_on === today && tpl(p.template_id)) && !doneToday.length;
  const sick = todayMode(workouts);
  const kicker = sick?.mode === "rest" ? "Sick day" : doneToday.length ? "Done today" : hero && hero.date === today ? "Today" : restToday ? "Rest day" : hero ? hero.label : "Today";

  return (
    <div className={`home${deload ? " deload" : ""}`}>
      <div className="home-top">
        <div className="home-greet">
          <span className="home-hello">{greet}</span>
          <span className="small muted">{now.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>
        <div className="home-icons">
          <button className="icon-btn" onClick={onPlan} aria-label="Edit plan" title="Edit plan">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4M9.5 15.5l1.8 1.8 3.4-3.6" /></svg>
          </button>
          {!desktop && (
            <button className="icon-btn" onClick={goSettings} aria-label="Settings" title="Settings">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
            </button>
          )}
        </div>
      </div>

      <section className="home-week" aria-label="This week">
        <div className="ticker" role="img" aria-label={`${label}. ${D} of ${P} planned sessions done.`}>
          {P === 0 ? <span className="tick empty" /> : Array.from({ length: P }, (_, i) => <span key={i} className={`tick${i < D ? " on" : ""}`} />)}
        </div>
        <div className="ticker-label">
          <strong>{label}</strong>
          {subLabel && <span className="small muted">{subLabel}</span>}
        </div>
        <div className="wk-row">
          {days.map((d) => {
            const did = workouts.some((w) => sameDay(w, d));
            const plan = planned.some((p) => p.planned_on === d && tpl(p.template_id));
            const isToday = d === today;
            const dt = new Date(d + "T12:00:00");
            const ill = isSickDay(d) && !did;
            const st = did ? "done" : ill ? "sick" : plan ? (d < today ? "missed" : "planned") : "rest";
            return (
              <div key={d} className={`wk-day ${st}${isToday ? " today" : ""}`} aria-label={`${dt.toLocaleDateString("en-IE", { weekday: "long" })}: ${did ? "trained" : ill ? "unwell" : plan ? (d < today ? "planned, missed" : "planned") : "rest"}`}>
                <span className="wk-mark" aria-hidden="true">
                  {did ? <svg viewBox="0 0 16 16" width="16" height="16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> : ill ? <svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 2.5v7.2M8 9.7a2.4 2.4 0 1 0 .01 0M10.5 4.5h2M10.5 7h2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg> : plan ? <i className="wk-circle" /> : <i className="wk-dot" />}
                </span>
                <span className="wk-lbl">{isToday ? `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}` : dt.toLocaleDateString("en-IE", { weekday: "short" }).toUpperCase()}</span>
              </div>
            );
          })}
        </div>
        {flag && <p className="small home-flag"><span className={`coach-chip tone-${flag.tone}`}>Spacing</span> {flag.title}. <button className="link small" onClick={onPlan}>See why</button></p>}
      </section>

      <div className="home-grid">
        <div className="home-main">
          <section className="quote-card">
            <span className="kicker">{kicker}</span>
            <p className="quote">{dailyQuote(now)}</p>
          </section>

          {sick && MODE_TEXT[sick.reason][sick.mode] && (
            <div className={`sick-strip ${sick.mode}`} role="status">
              <strong>{MODE_TEXT[sick.reason][sick.mode]}</strong>
              <span className="small">
                {sick.mode === "rest" && (sick.reason === "fever_clear" ? "You had a fever, so today stays a rest day: a full day clear before lifting. Tomorrow's session starts easy." : "Today's session is skipped and planned cardio cleared. The program waits for you.")}
                {!todaysCheckin(data.checkins) && sick.reason === "sick" && " Carried over from your last scan: do today's scan to update it."}
                {sick.mode === "light" && (sick.reason === "comeback" ? "Your first session back is an easy one: about half the sets, a little lighter, RPE 7 max." : "Today's session is the easy version: about half the sets, a little lighter, RPE 7 max. Keep cardio easy and short.")}
                {sick.mode === "normal" && "Full session as planned. Keep cardio easy, and a dip won't count against your progress."}
              </span>
            </div>
          )}

          {doneToday.length > 0 && (
            <div className="done-strip">
              {doneToday.map((w) => (
                <button key={w.id} className="done-row" onClick={() => onOpenWorkout(w)}>
                  <span className="done-tick" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                  <span style={{ flex: 1, minWidth: 0 }}><strong>{w.name}</strong> <span className="small muted">{w.duration_min != null ? `${Math.round(w.duration_min)} min` : "done"}</span></span>
                  <span aria-hidden="true" className="muted">›</span>
                </button>
              ))}
            </div>
          )}

          {hero ? <HeroCard data={data} hero={hero} onOpen={() => onPreview(hero)} /> : (
            <button className="hero-card quiet" onClick={onPlan}>
              <Chevrons />
              <span className="hero-kicker">Nothing planned</span>
              <span className="hero-name">PLAN YOUR WEEK</span>
              <span className="small muted">Pick your training days and the coach fills them in.</span>
            </button>
          )}
          {showEveningCard(now) && <EveningCard done={evenings?.find((e) => e.day === today) ?? null} onOpen={onEvening} />}
          {desktop && side}
        </div>

        <div className="home-side">
          <div className="tiles">
            <ReadinessTile checkins={data.checkins} onScan={onScan} />
            <StepsTile data={data} onOpen={onSteps} />
            <WaterTile data={data} onOpen={onSteps} />
            <CardioTile data={data} onOpen={onCardio} />
          </div>
          <LowReadiness checkins={data.checkins} />
        </div>
      </div>
    </div>
  );
}


function HeroCard({ data, hero, onOpen }: { data: AppData; hero: HeroSession; onOpen: () => void }) {
  const base = plannedTemplate(hero.template, data.planned, hero.date);
  const tw = loadTweaks(hero.date, hero.template.id);
  const t = applyTweaks(base, tw);
  const exMap = new Map(data.exercises.map((e) => [e.id, e]));
  const muscles = [...new Set(t.exercises.map((te) => exMap.get(te.exercise_id)?.muscle).filter(Boolean))].map((m) => MUSCLE_LABEL[m!]);
  const mins = estimateMinutes(t, data.settings.default_rest_sec);
  const sets = t.exercises.reduce((a, te) => a + te.sets, 0);
  return (
    <button className="hero-card" onClick={onOpen} aria-label={`${t.name}, ${hero.label}. Open the session`}>
      <Chevrons />
      <span className="hero-kicker">{hero.label === "Today" || hero.label === "Next up" ? (hero.sub ?? "Strength session") : `${hero.label}${hero.sub ? ` · ${hero.sub}` : ""}`}</span>
      <FitName text={t.name.toUpperCase()} />
      <span className="hero-facts">
        <span><Ico d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />≈ {mins} min</span>
        <span><Ico d="M4 12h2M18 12h2M6 8v8M18 8v8M8 10v4M16 10v4M8 12h8" />{t.exercises.length} exercise{t.exercises.length === 1 ? "" : "s"} · {sets} sets</span>
        {muscles.length > 0 && <span className="hero-muscles"><Ico d="M12 4a2 2 0 1 0 0 .01M8 21l1-7-3-2 2-5h8l2 5-3 2 1 7" />{muscles.join(", ")}</span>}
      </span>
      {hasTweaks(tw) && <span className="hero-tweaked small">Tweaked for {hero.date === ymd(new Date()) ? "today" : "that day"}</span>}
      <span className="hero-go" aria-hidden="true">›</span>
    </button>
  );
}

function Ico({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function Ring({ pct, children }: { pct: number; children?: React.ReactNode }) {
  const R = 19, C = 2 * Math.PI * R;
  return (
    <span className="steps-ring tile-ring" aria-hidden="true">
      <svg viewBox="0 0 46 46" width="46" height="46">
        <circle cx="23" cy="23" r={R} className="steps-ring-bg" />
        <circle cx="23" cy="23" r={R} className="steps-ring-fill" strokeDasharray={`${C * Math.min(1, pct)} ${C}`} transform="rotate(-90 23 23)" />
      </svg>
      <span>{children}</span>
    </span>
  );
}

function ReadinessTile({ checkins, onScan }: { checkins: Checkin[]; onScan: (c: Checkin | null) => void }) {
  const today = todaysCheckin(checkins);
  if (!today) {
    return (
      <button className="tile tile-ready none" onClick={() => onScan(null)}>
        <span className="tile-h">Readiness</span>
        <span className="tile-v">Scan</span>
        <span className="tile-s small">Tunes today's loads</span>
      </button>
    );
  }
  const a = adjustmentFor(today);
  return (
    <button className={`tile tile-ready band-${a.band}`} onClick={() => onScan(today)}>
      <span className="tile-h">Readiness</span>
      <span className="tile-v num">{today.score}</span>
      <span className="tile-s small">{BAND_LABEL[a.band]}</span>
    </button>
  );
}

function StepsTile({ data, onOpen }: { data: AppData; onOpen: () => void }) {
  const today = todayYmd();
  const has = data.activity.some((d) => d.steps != null);
  const target = data.settings.step_target || 15000;
  const steps = data.activity.find((d) => d.day === today)?.steps ?? 0;
  const past = data.activity.filter((d) => d.day <= today && d.day > addYmd(today, -7) && d.steps != null).map((d) => d.steps!);
  const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
  const f = (n: number) => Math.round(n).toLocaleString("en-IE");
  return (
    <button className={`tile tile-steps${steps >= target ? " hit" : ""}`} onClick={onOpen}>
      <span className="tile-h">Steps</span>
      <span className="tile-row">
        <Ring pct={steps / target}>{Math.round(Math.min(1, steps / target) * 100)}%</Ring>
        <span className="tile-v num">{has ? f(steps) : "–"}</span>
      </span>
      <span className="tile-s small">{has ? (avg != null ? `7-day avg ${f(avg)}` : `of ${f(target)}`) : "Connect Health in Settings"}</span>
    </button>
  );
}

function WaterTile({ data, onOpen }: { data: AppData; onOpen: () => void }) {
  const entries = useWater();
  const day = localDate();
  const total = entries ? totalOn(entries, day) : 0;
  const target = data.settings.water_target_ml || 3000;
  const inc = data.settings.water_increment_ml || WATER_AMOUNTS[0] || 250;
  const [undo, setUndo] = useState<WaterEntry | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const add = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const x = await addWater(inc, inAndroidApp() ? "app" : "web");
    void writeWaterToHealth(x.ml, x.logged_at);
    setUndo(x);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setUndo(null), 8000);
  };
  const doUndo = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!undo) return;
    const id = undo.client_id;
    setUndo(null);
    try { await deleteWater(id); } catch { /* shown on the next refresh */ }
  };
  return (
    <div className={`tile tile-water${total >= target ? " hit" : ""}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(); }} aria-label={`Water ${litres(total)} of ${litres(target)} litres. Open history`}>
      <span className="tile-h">Water</span>
      <span className="tile-row">
        <Ring pct={total / target}>{Math.round(Math.min(1, total / target) * 100)}%</Ring>
        <span className="tile-v num">{litres(total)}<small> L</small></span>
      </span>
      <span className="tile-foot">
        {undo ? <button className="link small" onClick={doUndo}>Undo {undo.ml} ml</button> : <span className="tile-s small">of {litres(target)} L</span>}
        <button className="tile-add" onClick={add} aria-label={`Add ${inc} ml`}>+{inc}</button>
      </span>
    </div>
  );
}

function CardioTile({ data, onOpen }: { data: AppData; onOpen: () => void }) {
  const { sessions, settings } = data;
  const start = startOfWeek(new Date());
  const w = groupByWeek(sessions, zoneFor(settings)).get(weekKey(start)) ?? emptyWeek(start);
  const weekDates = Array.from({ length: 7 }, (_, i) => ymd(addDays(start, i)));
  const ahead = plannedRemaining(data.plannedCardio, sessions, weekDates);
  const target = settings.weekly_target_min;
  const scale = Math.max(target, w.minutes + ahead.total, 30);
  const done = w.minutes >= target;
  return (
    <button className={`tile tile-cardio${done ? " hit" : ""}`} onClick={onOpen}>
      <span className="tile-h">Cardio</span>
      <span className="tile-v num">{Math.round(w.minutes)}<small> / {target} min</small></span>
      <span className="tile-bar" aria-hidden="true">
        <span className="tile-bar-done" style={{ width: `${(Math.min(w.minutes, scale) / scale) * 100}%` }} />
        {ahead.total > 0 && <span className="tile-bar-plan" style={{ width: `${(ahead.total / scale) * 100}%` }} />}
      </span>
      <span className="tile-s small">{todayMode()?.mode === "light" || todayMode()?.mode === "normal" && todayMode()?.reason === "sick" ? "Easy only today" : done ? "Target hit" : ahead.total > 0 ? `${Math.round(ahead.total)} min planned` : `${Math.round(target - w.minutes)} min to go`}</span>
    </button>
  );
}

function LowReadiness({ checkins }: { checkins: Checkin[] }) {
  const low = lowReadinessCount(checkins);
  if (low < LOW_RUN) return null;
  return (
    <div className="coach-alert tone-warn" style={{ marginTop: 10 }}>
      <p><strong>Readiness under 60 on {low} of the last 7 days.</strong> Fatigue is building, so loads are trimmed day to day. Prioritise sleep, and if it carries on, think about a deload.</p>
    </div>
  );
}

function EveningCard({ done, onOpen }: { done: import("../../lib/evening").EveningCheckin | null; onOpen: () => void }) {
  const good = done?.gratitude.filter(Boolean).length ?? 0;
  const taken = done?.stack.filter((s) => s.taken).length ?? 0;
  return (
    <button className={`evening-card${done ? " done" : ""}`} onClick={onOpen}>
      <span className="kicker">Evening check-in</span>
      {done ? (
        <>
          <span className="evening-title">Done ✓</span>
          <span className="small muted">{done.stack.length ? (fullStack(done) ? "Full stack" : `${taken} of ${done.stack.length} supplements`) : "No supplements listed"}{good ? ` · ${good} good thing${good === 1 ? "" : "s"}` : ""} · tap to edit</span>
        </>
      ) : (
        <>
          <span className="evening-title">How was today?</span>
          <span className="small muted">Supplements, meditation, stress and three good things. About a minute.</span>
        </>
      )}
      <span className="hero-go" aria-hidden="true">›</span>
    </button>
  );
}
