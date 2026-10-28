import { useState } from "react";
import type { AppData } from "../App";
import type { Session } from "../lib/types";
import type { Workout } from "../lib/strength";
import { fmtTonnage, volume } from "../lib/strength";
import { startOfWeek, weekKey, weekLabel } from "../lib/dates";
import { sessionMinutes } from "../lib/calc";
import SessionCard from "./SessionCard";
import WorkoutCard from "./WorkoutCard";

type Item = { kind: "cardio"; at: string; s: Session } | { kind: "lift"; at: string; w: Workout };
type Filter = "all" | "cardio" | "lift";

interface Props {
  data: AppData;
  onOpenSession: (s: Session) => void;
  onOpenWorkout: (w: Workout) => void;
  onTrain: () => void;
}

export default function History({ data, onOpenSession, onOpenWorkout, onTrain }: Props) {
  const { sessions, workouts, settings, exercises } = data;
  const [filter, setFilter] = useState<Filter>("all");
  const items: Item[] = [
    ...(filter !== "lift" ? sessions.map((s) => ({ kind: "cardio" as const, at: s.performed_at, s })) : []),
    ...(filter !== "cardio" ? workouts.map((w) => ({ kind: "lift" as const, at: w.started_at, w })) : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const weeks = new Map<string, { start: Date; items: Item[]; minutes: number; workouts: number; volume: number }>();
  for (const it of items) {
    const d = new Date(it.at);
    const k = weekKey(d);
    if (!weeks.has(k)) weeks.set(k, { start: startOfWeek(d), items: [], minutes: 0, workouts: 0, volume: 0 });
    const w = weeks.get(k)!;
    w.items.push(it);
    if (it.kind === "cardio") w.minutes += sessionMinutes(it.s);
    else { w.workouts++; w.volume += volume(it.w.sets); }
  }
  const target = settings.weekly_target_min;

  return (
    <>
      <div className="page-head">
        <h1>History</h1>
        <span className="muted small">{workouts.length} workouts, {sessions.length} cardio</span>
      </div>
      <div className="seg" role="group" aria-label="Show">
        {(["all", "lift", "cardio"] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "cardio" ? "Cardio" : "Strength"}
          </button>
        ))}
      </div>
      {items.length === 0 && (
        <div className="empty" style={{ marginTop: 12 }}>
          <p>Nothing logged yet.</p>
          <p className="muted small">Cardio sessions and workouts show up here, grouped by week.</p>
          <button className="btn primary" onClick={onTrain}>Train</button>
        </div>
      )}
      {[...weeks.values()].map((w) => {
        const hit = w.minutes >= target;
        const parts: string[] = [];
        if (filter !== "lift") parts.push(`${Math.round(w.minutes)} / ${target} min`);
        if (filter !== "cardio" && w.workouts) parts.push(`${w.workouts} workout${w.workouts === 1 ? "" : "s"}, ${fmtTonnage(w.volume)}`);
        return (
          <section key={weekKey(w.start)}>
            <div className="week-head">
              <h2>{weekLabel(w.start)}</h2>
              <span className={`tally${hit && filter !== "lift" ? " hit" : ""}`}>{parts.join(", ")}</span>
            </div>
            {w.items.map((it) =>
              it.kind === "cardio"
                ? <SessionCard key={it.s.id} session={it.s} settings={settings} onOpen={onOpenSession} />
                : <WorkoutCard key={it.w.id} workout={it.w} exercises={exercises} onOpen={onOpenWorkout} />
            )}
          </section>
        );
      })}
    </>
  );
}
