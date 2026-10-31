import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { addDays, fromYmd } from "./nutrition";

/** A zoom or pan of a chart's time axis. center and shift are fractions of the chart width. */
export type Pinch = { phase: "start" | "move" | "end"; scale: number; center: number; shift: number };

export interface GestureOpts {
  disabled?: boolean;
  onPinch?: (p: Pinch) => void;
  /** Show a reading at this x (mouse hover, or a held finger sliding along). */
  read: (clientX: number) => void;
  /** Hide the reading (a pan or pinch started, or the mouse left). */
  clear: () => void;
  /** A quick tap or click. */
  tap: (clientX: number, mouse: boolean) => void;
  /** A held finger lifted after reading. */
  readDone?: (clientX: number) => void;
}

/** Touch: one finger drags along the timeline, hold still to read, two fingers pinch to zoom.
 *  Mouse: drag to move, hover to read, ctrl + scroll (or a trackpad pinch) to zoom. */
export function useChartGestures(opts: GestureOpts) {
  const o = useRef(opts);
  o.current = opts;
  const [el, setEl] = useState<SVGSVGElement | null>(null);
  const elRef = useRef<SVGSVGElement | null>(null);
  elRef.current = el;
  const touches = useRef(new Map<number, number>());
  const pinch0 = useRef<{ d: number; c: number } | null>(null);
  const drag = useRef<{ x0: number; x: number; mode: "pending" | "pan" | "read" } | null>(null);
  const hold = useRef<number>();

  const rect = () => elRef.current?.getBoundingClientRect();
  const frac = (clientX: number) => { const r = rect(); return r && r.width ? (clientX - r.left) / r.width : 0.5; };
  const twoX = () => { const xs = [...touches.current.values()]; return xs.length >= 2 ? [xs[0], xs[1]] : null; };
  const endZoom = () => o.current.onPinch?.({ phase: "end", scale: 1, center: 0.5, shift: 0 });

  // Trackpad pinch (or ctrl + scroll) on a laptop; needs a non-passive listener to stop the page zooming
  useEffect(() => {
    if (!el || opts.disabled) return;
    const onWheel = (e: WheelEvent) => {
      const f = o.current.onPinch;
      if (!f || !e.ctrlKey) return;
      e.preventDefault();
      const c = frac(e.clientX);
      f({ phase: "start", scale: 1, center: c, shift: 0 });
      f({ phase: "move", scale: Math.exp(-e.deltaY / 150), center: c, shift: 0 });
      f({ phase: "end", scale: 1, center: c, shift: 0 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, opts.disabled]);

  type PE = ReactPointerEvent<SVGSVGElement>;
  const bind = {
    ref: setEl,
    onPointerDown: (e: PE) => {
      const { disabled, onPinch, read, clear } = o.current;
      if (disabled) return;
      const isTouch = e.pointerType !== "mouse";
      touches.current.set(e.pointerId, e.clientX);
      const t = twoX();
      if (t && onPinch) {
        // Second finger down: pinch to zoom (ends any pan or reading)
        window.clearTimeout(hold.current);
        if (drag.current?.mode === "pan") endZoom();
        drag.current = null;
        pinch0.current = { d: Math.max(12, Math.abs(t[0] - t[1])), c: frac((t[0] + t[1]) / 2) };
        clear();
        onPinch({ phase: "start", scale: 1, center: pinch0.current.c, shift: 0 });
        return;
      }
      if (!isTouch && e.button !== 0) return;
      drag.current = { x0: e.clientX, x: e.clientX, mode: "pending" };
      if (isTouch) {
        // Hold still to read; drag to move along the timeline
        window.clearTimeout(hold.current);
        const x = e.clientX;
        hold.current = window.setTimeout(() => {
          if (drag.current?.mode !== "pending") return;
          drag.current = { ...drag.current, mode: "read" };
          navigator.vibrate?.(8);
          read(x);
        }, 320);
      }
    },
    onPointerMove: (e: PE) => {
      const { disabled, onPinch, read, clear } = o.current;
      if (disabled) return;
      if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, e.clientX);
      const t = twoX();
      if (t && pinch0.current && onPinch) {
        const c = frac((t[0] + t[1]) / 2);
        onPinch({ phase: "move", scale: Math.max(12, Math.abs(t[0] - t[1])) / pinch0.current.d, center: pinch0.current.c, shift: c - pinch0.current.c });
        return;
      }
      const d = drag.current;
      if (!d) { if (e.pointerType === "mouse") read(e.clientX); return; } // mouse hover reads
      d.x = e.clientX;
      if (d.mode === "read") { read(e.clientX); return; }
      if (d.mode === "pending" && Math.abs(e.clientX - d.x0) > 6 && onPinch) {
        window.clearTimeout(hold.current);
        clear();
        d.mode = "pan";
        onPinch({ phase: "start", scale: 1, center: frac(d.x0), shift: 0 });
      }
      if (d.mode === "pan" && onPinch) onPinch({ phase: "move", scale: 1, center: frac(d.x0), shift: frac(e.clientX) - frac(d.x0) });
    },
    onPointerUp: (e: PE) => {
      touches.current.delete(e.pointerId);
      window.clearTimeout(hold.current);
      if (pinch0.current) {
        if (touches.current.size < 2) { pinch0.current = null; endZoom(); }
        drag.current = null;
        return;
      }
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.mode === "pan") endZoom();
      else if (d.mode === "read") o.current.readDone?.(d.x);
      else o.current.tap(e.clientX, e.pointerType === "mouse");
    },
    onPointerCancel: (e: PE) => {
      touches.current.delete(e.pointerId);
      window.clearTimeout(hold.current);
      if (pinch0.current || drag.current?.mode === "pan") endZoom();
      pinch0.current = null;
      drag.current = null;
    },
    onPointerLeave: (e: PE) => { if (e.pointerType === "mouse" && !drag.current) o.current.clear(); },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
  return { bind, rect };
}

export const daysApart = (a: string, b: string) => Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86400000);

/** The date window after a pinch or pan, starting from the window g at the start of the gesture.
 *  Keeps the day under the fingers' starting midpoint under their midpoint now, within first..last. */
export function pinchWindow(g: { start: string; end: string }, p: Pinch, first: string, last: string, minSpan = 6) {
  const total = Math.max(minSpan + 1, daysApart(first, last));
  const span0 = Math.max(1, daysApart(g.start, g.end));
  const span1 = Math.round(Math.max(minSpan, Math.min(total, span0 / p.scale)));
  const anchor = daysApart(first, g.start) + p.center * span0;
  let s = Math.round(anchor - (p.center + p.shift) * span1);
  s = Math.max(0, Math.min(total - span1, s));
  return { start: addDays(first, s), end: addDays(first, s + span1) };
}
