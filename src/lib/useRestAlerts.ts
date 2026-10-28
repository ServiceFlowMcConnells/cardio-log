import { useEffect, useRef } from "react";
import type { Exercise } from "./strength";
import { readWorkoutDraft } from "../components/WorkoutLogger";
import { cancelRestAlert, playRestEnd, scheduleRestAlert } from "./restAlert";

/** Watches the in-progress workout's rest timer from anywhere in the app. */
export function useRestAlerts(exercises: Exercise[]) {
  const names = useRef(new Map<string, string>());
  names.current = new Map(exercises.map((e) => [e.id, e.name]));
  const alerted = useRef<number | null>(null);

  useEffect(() => {
    const restEnd = () => readWorkoutDraft()?.restEnd ?? null;
    const nextUp = () => {
      const d = readWorkoutDraft();
      for (const e of d?.exercises ?? []) {
        const i = e.sets.findIndex((x) => !x.done);
        if (i >= 0) return `Next: ${names.current.get(e.exercise_id) ?? "next exercise"}, set ${i + 1}`;
      }
      return "Time for your next set";
    };

    // In the app: beep + buzz once at zero
    const tick = setInterval(() => {
      const end = restEnd();
      if (!end || alerted.current === end || document.visibilityState !== "visible") return;
      const late = Date.now() - end;
      if (late >= 0) {
        alerted.current = end;
        if (late < 3000) playRestEnd();
      }
    }, 250);

    // Minimised mid-rest: the server sends a push at the end. Back in the app: cancel it.
    const onVis = () => {
      const end = restEnd();
      if (document.visibilityState === "hidden") {
        if (end && end - Date.now() > 3000) scheduleRestAlert(end, nextUp()).catch(() => {});
      } else {
        if (end && Date.now() >= end) alerted.current = end; // the push already covered it
        cancelRestAlert().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
  }, []);
}
