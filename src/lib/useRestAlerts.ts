import { useEffect, useRef } from "react";
import { readWorkoutDraft } from "../components/WorkoutLogger";
import { playRestEnd } from "./restAlert";

/** Watches the in-progress workout's rest timer from anywhere in the app. */
export function useRestAlerts() {
  const alerted = useRef<number | null>(null);

  useEffect(() => {
    const restEnd = () => readWorkoutDraft()?.restEnd ?? null;
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

    return () => clearInterval(tick);
  }, []);
}
