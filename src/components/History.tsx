import type { Session, Settings } from "../lib/types";
import { weekLabel } from "../lib/dates";
import { groupByWeek, zoneFor } from "../lib/calc";
import SessionCard from "./SessionCard";

export default function History({ sessions, settings, onOpen, onLog }: { sessions: Session[]; settings: Settings; onOpen: (s: Session) => void; onLog: () => void }) {
  const weeks = [...groupByWeek(sessions, zoneFor(settings)).values()].sort((a, b) => b.start.getTime() - a.start.getTime());
  const target = settings.weekly_target_min;

  return (
    <>
      <div className="page-head">
        <h1>History</h1>
        <span className="muted small">{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
      </div>
      {weeks.length === 0 && (
        <div className="empty">
          <p>Nothing logged yet.</p>
          <p className="muted small">Each session you save shows up here, grouped by week.</p>
          <button className="btn primary" onClick={onLog}>Log session</button>
        </div>
      )}
      {weeks.map((w) => {
        const hit = w.minutes >= target;
        return (
          <section key={w.key}>
            <div className="week-head">
              <h2>{weekLabel(w.start)}</h2>
              <span className={`tally${hit ? " hit" : ""}`}>
                {Math.round(w.minutes)} / {target} min{hit ? ", target hit" : ""}
              </span>
            </div>
            {w.sessions.map((s) => (
              <SessionCard key={s.id} session={s} settings={settings} onOpen={onOpen} />
            ))}
          </section>
        );
      })}
    </>
  );
}
