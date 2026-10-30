// Desktop (laptop browser) mode: a sidebar layout with wider, multi-column pages for planning and
// editing. Live workout recording is phone-only, so start/warm-up buttons are hidden here.
import { createContext, useContext, useEffect, useState } from "react";
import { inAndroidApp } from "./nativeTimer";

const QUERY = "(min-width: 1024px)";
const isDesktopNow = () => typeof window !== "undefined" && !inAndroidApp() && window.matchMedia?.(QUERY).matches === true;

export function useDesktopMedia(): boolean {
  const [desk, setDesk] = useState(isDesktopNow);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setDesk(isDesktopNow());
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return desk;
}

export const DesktopContext = createContext(false);
/** True on a laptop/desktop browser. Use it to hide live-recording controls. */
export const useDesktop = () => useContext(DesktopContext);
