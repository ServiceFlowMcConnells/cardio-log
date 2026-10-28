import { useEffect, useRef } from "react";
import type { Exercise } from "./strength";
import { readWorkoutDraft } from "../components/WorkoutLogger";
import { playRestEnd, soundOn } from "./restAlert";
import { nativeRestTimer } from "./nativeTimer";

/**
 * Watches the in-progress workout's rest timer from anywhere in the app.
 * In the browser: beep + buzz at zero while the app is open.
 * In the Android app: hands each rest to the phone, which shows a live countdown notification and
 * sounds at the end even when minimised (so the browser beep is skipped there).
 */
export function useRestAlerts(exercises: Exercise[]) {
  const names = useRef(new Map<string, string>());
  names.current = new Map(exercises.map((e) => [e.id, e.name]));
  const alerted = useRef<number | null>(null);
  const sentToPhone = useRef<number | null>(null);

  useEffect(() => {
    const native = nativeRestTimer();
    native?.requestPermission().catch(() => {});

    const nextUp = () => {
      const d = readWorkoutDraft();
      for (const e of d?.exercises ?? []) {
        const i = e.sets.findIndex((x) => !x.done);
        if (i >= 0) return `Next: ${names.current.get(e.exercise_id) ?? "next exercise"}, set ${i + 1}`;
      }
      return "Time for your next set";
    };

    const tick = setInterval(() => {
      const end = readWorkoutDraft()?.restEnd ?? null;
      if (native) {
        // Mirror the rest to the phone whenever it starts, changes (±15 s) or stops
        if (end !== sentToPhone.current) {
          if (end && end > Date.now() + 1000) native.start({ endAt: end, title: "Resting", body: nextUp(), sound: soundOn() }).catch(() => {});
          else if (sentToPhone.current && (!end || end > Date.now())) native.cancel().catch(() => {});
          sentToPhone.current = end;
        }
        return;
      }
      if (!end || alerted.current === end || document.visibilityState !== "visible") return;
      const late = Date.now() - end;
      if (late >= 0) {
        alerted.current = end;
        if (late < 3000) playRestEnd();
      }
    }, 250);

    return () => clearInterval(tick);
  }, []);
}
