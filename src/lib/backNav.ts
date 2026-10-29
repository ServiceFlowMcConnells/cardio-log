// Back button / back gesture support.
// The app keeps its screens in React state, not URLs, so we hold one "trap" history entry while you're
// anywhere but the home screen. Pressing back pops it; we handle the back ourselves (close a picker,
// return to the previous screen or the Week tab) and set the trap again. On the home screen there's no
// trap, so back leaves the app as normal.
import { useEffect, useRef } from "react";

type Handler = { run: () => void };
const handlers: Handler[] = [];

/** While `active`, the back button calls `fn` (e.g. close a picker) instead of leaving the screen. */
export function useBackHandler(active: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const h: Handler = { run: () => ref.current() };
    handlers.push(h);
    return () => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, [active]);
}

/** App-level: `atRoot` = on the home screen with nothing open. `onBack` steps back one screen. */
export function useHistoryTrap(atRoot: boolean, onBack: () => void) {
  const trapped = useRef(false);
  const ignore = useRef(0);
  const want = useRef(!atRoot);
  const backRef = useRef(onBack);
  backRef.current = onBack;
  want.current = !atRoot || handlers.length > 0;

  const sync = () => {
    if (want.current && !trapped.current) {
      history.pushState({ trainingLogTrap: true }, "");
      trapped.current = true;
    } else if (!want.current && trapped.current) {
      trapped.current = false;
      ignore.current++;
      history.back();
    }
  };

  useEffect(sync);

  useEffect(() => {
    const onPop = () => {
      if (ignore.current > 0) { ignore.current--; return; }
      trapped.current = false;
      const h = handlers[handlers.length - 1];
      if (h) h.run();
      else backRef.current();
      // Re-arm once React has applied the change
      setTimeout(sync, 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
