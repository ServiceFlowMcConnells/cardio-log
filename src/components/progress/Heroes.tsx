// Progress tabs: a hero (the tab's main answer) and four tiles, in the dashboard's style.
import type { ReactNode } from "react";
import type { AppData } from "../../App";
import Chevrons from "../Chevrons";
import { rangeBounds, rangeLabel, useDeskRange } from "../../lib/deskRange";
import { emptyWeek, groupByWeek, sessionMinutes, zoneFor } from "../../lib/calc";
import { addDays as addDate, startOfWeek, weekKey, formatShort } from "../../lib/dates";
import { plannedRemaining } from "../../lib/cardioPlan";
import { ymd as ymdS } from "../../lib/schedule";
import { dayTotals, targetFor, todayYmd, trendWeights, weeklyRate, ymd } from "../../lib/nutrition";
import { BAND_LABEL, PHASE_RATE, bandFor, latestPhase } from "../../lib/readiness";
import { MOOD_LABELS, gadBand, gadScore } from "../../lib/mood";
import { dailyTotals, useWater } from "../../lib/hydration";
import { minutesByDay, streak, useMeditation } from "../../lib/meditation";

export function Hero({ kicker, name, facts, tone, children }: { kicker: string; name: string; facts: ReactNode[]; tone?: string; children?: ReactNode }) {
  return (
    <div className={`hero-card prog-hero${tone ? ` tone-${tone}` : ""}`} role="region" aria-label={kicker}>
      <Chevrons />
      <span className="hero-kicker">{kicker}</span>
      <span className="hero-name">{name}</span>
      <span className="hero-facts">{facts.filter(Boolean).map((f, i) => <span key={i}>{f}</span>)}</span>
      {children}
    </div>
  );
}
export function Tile({ h, v, s, onClick, tone }: { h: string; v: ReactNode; s?: ReactNode; onClick?: () => void; tone?: "ok" | "warn" }) {
  const body = <><span className="tile-h">{h}</span><span className="tile-v num">{v}</span>{s != null && <span className={`tile-s small${tone ? ` ${tone}` : ""}`}>{s}</span>}</>;
  return onClick ? <button className="tile" onClick={onClick}>{body}</button> : <div className="tile">{body}</div>;
}
/** Scroll a chart card into view (tiles jump to their chart). */
export const jump = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

const n0 = (v: number) => Math.round(v).toLocaleString("en-IE");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** Days in the current range, as YYYY-MM-DD, up to today (or from `first` for All). */
function useRangeDays(first: string) {
  const desk = useDeskRange();
  const b = desk ? rangeBounds(desk.range) : { from: new Date(Date.now() - 90 * 86400000), to: new Date() };
  const start = b.from ? ymd(b.from) : first;
  const end = ymd(b.to) > todayYmd() ? todayYmd() : ymd(b.to);
  return { start, end, label: desk ? rangeLabel(desk.range) : "Last 3 months" };
}

export function CardioHero({ data }: { data: AppData }) {
  const { sessions, settings } = data;
  const z = zoneFor(settings);
  const map = groupByWeek(sessions, z);
  const start = startOfWeek(new Date());
  const w = map.get(weekKey(start)) ?? emptyWeek(start);
  const weekDates = Array.from({ length: 7 }, (_, i) => ymdS(addDate(start, i)));
  const ahead = plannedRemaining(data.plannedCardio, sessions, weekDates).total;
  const target = settings.weekly_target_min;
  const r = useRangeDays(sessions.length ? ymd(new Date(sessions[sessions.length - 1].performed_at)) : todayYmd());
  const inR = sessions.filter((s) => { const d = ymd(new Date(s.performed_at)); return d >= r.start && d <= r.end; });
  const weeks = [...map.values()].filter((x) => ymd(x.start) >= r.start && x.start.getTime() < start.getTime());
  const hits = weeks.filter((x) => x.minutes >= target).length;
  let longest: { min: number; at: string } | null = null;
  for (const s of inR) { const m = sessionMinutes(s); if (!longest || m > longest.min) longest = { min: m, at: s.performed_at }; }
  const best = weeks.reduce<null | (typeof weeks)[number]>((a, x) => (!a || x.minutes > a.minutes ? x : a), null);
  const left = Math.max(0, target - w.minutes);
  return (
    <>
      <Hero kicker="Cardio · this week" name={`${Math.round(w.minutes)} / ${target} MIN`} tone={w.minutes >= target ? "good" : undefined}
        facts={[
          w.minutes >= target ? "Target hit. Anything more is a bonus." : ahead > 0 ? (w.minutes + ahead >= target ? `${Math.round(ahead)} min planned, so the plan covers the last ${Math.round(left)}` : `${Math.round(ahead)} min planned, ${Math.round(target - w.minutes - ahead)} short of the target`) : `${Math.round(left)} min to go`,
          weeks.length ? `Target hit in ${hits} of ${weeks.length} finished week${weeks.length === 1 ? "" : "s"} · ${r.label.toLowerCase()}` : null,
        ]} />
      <div className="tiles">
        <Tile h="Sessions" v={w.sessions.length} s="this week" onClick={jump("chart-cardio-weeks")} />
        <Tile h="Zone time" v={z ? `${Math.round(w.zoneMinutes)} min` : "–"} s={z ? `this week, ${z.low}–${z.high} bpm` : "set max HR in Settings"} onClick={jump("chart-cardio-weeks")} />
        <Tile h="Longest" v={longest ? `${Math.round(longest.min)} min` : "–"} s={longest ? formatShort(new Date(longest.at)) : "no sessions in range"} onClick={jump("chart-cardio-output")} />
        <Tile h="Biggest week" v={best ? `${Math.round(best.minutes)} min` : "–"} s={best ? `week of ${formatShort(best.start)}` : "in this range"} onClick={jump("chart-cardio-weeks")} />
      </div>
    </>
  );
}

export function NutritionHero({ data }: { data: AppData }) {
  const nutri = data.nutrition;
  const totals = dayTotals(nutri);
  const first = [...totals.keys()].sort()[0] ?? todayYmd();
  const r = useRangeDays(first);
  const days: string[] = [];
  for (const [d, t] of totals) if (d >= r.start && d <= r.end && t.entries > 0) days.push(d);
  const pick = (k: "kcal" | "protein" | "carbs" | "fat") => avg(days.map((d) => totals.get(d)![k]));
  const tgt = (k: "kcal" | "protein" | "carbs" | "fat") => avg(days.map((d) => targetFor(nutri.targets, d)?.[k] ?? null).filter((x): x is number => x != null));
  const kcal = pick("kcal"), kt = tgt("kcal"), p = pick("protein"), pt = tgt("protein");
  const pHit = days.filter((d) => { const t = targetFor(nutri.targets, d)?.protein; return t != null && totals.get(d)!.protein >= t * 0.9; }).length;
  const span = Math.max(1, Math.round((new Date(`${r.end}T12:00:00`).getTime() - new Date(`${r.start}T12:00:00`).getTime()) / 86400000) + 1);
  const macro = (k: "protein" | "carbs" | "fat") => { const a = pick(k), t = tgt(k); return { v: a != null ? `${Math.round(a)} g` : "–", s: t != null ? `target ${Math.round(t)} g` : "no target", tone: a != null && t != null ? (Math.abs(a - t) <= t * 0.1 ? "ok" as const : undefined) : undefined }; };
  const P = macro("protein"), C = macro("carbs"), F = macro("fat");
  return (
    <>
      <Hero kicker={`Nutrition · ${r.label.toLowerCase()} · daily average`} name={kcal != null ? `${n0(kcal)} KCAL` : "NOTHING LOGGED"}
        facts={[
          kcal != null && kt != null ? `${n0(Math.abs(kcal - kt))} ${kcal >= kt ? "over" : "under"} your ${n0(kt)} target` : null,
          p != null ? `Protein ${Math.round(p)} g${pt != null ? ` of ${Math.round(pt)} g · hit on ${pHit} of ${days.length} days` : ""}` : null,
        ]} />
      <div className="tiles">
        <Tile h="Protein" v={P.v} s={P.s} tone={P.tone} onClick={jump("chart-nutrition")} />
        <Tile h="Carbs" v={C.v} s={C.s} tone={C.tone} onClick={jump("chart-nutrition")} />
        <Tile h="Fat" v={F.v} s={F.s} tone={F.tone} onClick={jump("chart-nutrition")} />
        <Tile h="Logging" v={`${days.length}/${span}`} s="days logged" onClick={jump("chart-nutrition-habits")} />
      </div>
    </>
  );
}

export function WeightHero({ data, onLog }: { data: AppData; onLog: () => void }) {
  const nutri = data.nutrition;
  const pts = trendWeights(nutri.weights);
  const last = pts[pts.length - 1];
  const rate = weeklyRate(pts);
  const phase = latestPhase(data.checkins);
  const today = todayYmd();
  const scale = nutri.weights.find((w) => w.measured_on === today)?.weight_kg ?? null;
  const bf = [...nutri.bodyFats].sort((a, b) => a.measured_on.localeCompare(b.measured_on)).pop() ?? null;
  const kg = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  const lossPct = rate ? -rate.pct : null; // weeklyRate: + = gaining
  const onPlan = rate && phase ? (() => { const g = rate.pct; const R = PHASE_RATE[phase]; return g >= R.lo && g <= R.hi; })() : null;
  if (!last) return <Hero kicker="Weight" name="NO WEIGH-INS" facts={["Log your morning weight to see your trend."]} />;
  return (
    <>
      <Hero kicker="Trend weight" name={`${kg(last.trend)} KG`} tone={onPlan ? "good" : undefined}
        facts={[
          rate ? `${rate.kg >= 0 ? "+" : "−"}${kg(Math.abs(rate.kg))} kg a week${phase ? (onPlan ? ` · in your ${phase} range` : ` · ${phase} aims to ${PHASE_RATE[phase].text}`) : ""}` : "A few more weigh-ins for a weekly rate",
          rate ? `30-day projection ${kg(last.trend + (rate.kg * 30) / 7)} kg` : null,
        ]} />
      <div className="tiles">
        <Tile h="Scale today" v={scale != null ? kg(scale) : "Log"} s={scale != null ? "kg · tap to change" : "morning weight"} onClick={onLog} />
        <Tile h="Weekly rate" v={lossPct != null ? `${lossPct > 0 ? "−" : "+"}${Math.abs(lossPct).toFixed(1)}%` : "–"} s={phase ? `aim ${PHASE_RATE[phase].text.replace(/^(lose|gain|stay within) /, "")}` : "of bodyweight"} tone={onPlan == null ? undefined : onPlan ? "ok" : "warn"} onClick={jump("chart-weight")} />
        <Tile h="Body fat" v={bf ? `${bf.body_fat_pct}%` : "–"} s={bf ? formatShort(new Date(`${bf.measured_on}T12:00:00`)) : "no readings"} onClick={jump("chart-bodyfat")} />
        <Tile h="Lean mass" v={bf ? `${kg(last.trend * (1 - bf.body_fat_pct / 100))} kg` : "–"} s={bf ? "from trend weight" : "needs body fat"} onClick={jump("chart-bodyfat")} />
      </div>
    </>
  );
}

export function RecoveryHero({ data, onActivity }: { data: AppData; onActivity: () => void }) {
  const { checkins, activity } = data;
  const water = useWater();
  const med = useMeditation();
  const first = checkins.length ? ymd(new Date(checkins[checkins.length - 1].checked_at)) : todayYmd();
  const r = useRangeDays(first);
  const inR = checkins.filter((c) => { const d = ymd(new Date(c.checked_at)); return d >= r.start && d <= r.end; });
  const ready = avg(inR.map((c) => c.score));
  const sleepVals = new Map<string, number>();
  for (const a of activity) if (a.sleep_minutes && a.day >= r.start && a.day <= r.end) sleepVals.set(a.day, a.sleep_minutes / 60);
  for (const c of inR) if (c.sleep_hours != null) sleepVals.set(ymd(new Date(c.checked_at)), c.sleep_hours);
  const sleep = avg([...sleepVals.values()]);
  const mood = avg(inR.map((c) => c.mood).filter((x): x is number => x != null));
  const gad = checkins.find((c) => c.gad7 && c.gad7.length === 7);
  const steps = avg(activity.filter((a) => a.day >= r.start && a.day < todayYmd() && a.day <= r.end && a.steps != null).map((a) => a.steps!));
  const wt = water ? dailyTotals(water) : new Map<string, number>();
  const waterAvg = avg([...wt.entries()].filter(([d]) => d >= r.start && d < todayYmd() && d <= r.end).map(([, v]) => v));
  const mByDay = med ? minutesByDay(med) : new Map<string, number>();
  const medMin = [...mByDay.entries()].filter(([d]) => d >= r.start && d <= r.end).reduce((a, [, v]) => a + v, 0);
  return (
    <>
      <Hero kicker={`Recovery · ${r.label.toLowerCase()}`} name={ready != null ? `${BAND_LABEL[bandFor(ready)].toUpperCase()} · ${Math.round(ready)}` : "NO SCANS YET"}
        tone={ready != null && ready >= 70 ? "good" : undefined}
        facts={[
          [sleep != null ? `Sleep ${sleep.toFixed(1)} h a night` : null, mood != null ? `mood ${mood.toFixed(1)} (${MOOD_LABELS[Math.round(mood) - 1]})` : null].filter(Boolean).join(" · ") || null,
          gad?.gad7 ? `Headspace ${gadBand(gadScore(gad.gad7)).toLowerCase()} · ${gadScore(gad.gad7)} on ${formatShort(new Date(gad.checked_at))}` : null,
        ]} />
      <div className="tiles">
        <Tile h="Sleep" v={sleep != null ? `${sleep.toFixed(1)} h` : "–"} s="7–9 h recommended" tone={sleep != null ? (sleep >= 7 ? "ok" : "warn") : undefined} onClick={jump("chart-sleep")} />
        <Tile h="Steps" v={steps != null ? n0(steps) : "–"} s={`avg · target ${n0(data.settings.step_target || 15000)}`} onClick={onActivity} />
        <Tile h="Water" v={waterAvg != null ? `${(waterAvg / 1000).toFixed(1)} L` : "–"} s={`avg · target ${((data.settings.water_target_ml || 3000) / 1000).toFixed(1)}`} onClick={onActivity} />
        <Tile h="Meditation" v={`${medMin} min`} s={`${streak(mByDay)}-day streak`} onClick={onActivity} />
      </div>
    </>
  );
}
