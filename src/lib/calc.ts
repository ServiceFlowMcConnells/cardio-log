import type { Block, Session, Settings } from "./types";
import { startOfWeek, weekKey, addDays, dayIndex } from "./dates";

export interface Zone { low: number; high: number }

export function zoneFor(s: Settings): Zone | null {
  if (!s.max_hr) return null;
  return {
    low: Math.round((s.max_hr * s.zone_low_pct) / 100),
    high: Math.round((s.max_hr * s.zone_high_pct) / 100),
  };
}

export type ZoneStatus = "under" | "in" | "over" | null;

export function zoneStatus(hr: number | null, z: Zone | null): ZoneStatus {
  if (!hr || !z) return null;
  if (hr < z.low) return "under";
  if (hr > z.high) return "over";
  return "in";
}

/** ACSM metabolic equations: estimated METs for treadmill walking/running at a given speed and incline. */
export function treadmillMets(speedKmh: number, inclinePct: number | null): number {
  const S = (speedKmh * 1000) / 60; // m/min
  const G = (inclinePct ?? 0) / 100;
  const vo2 = speedKmh >= 8 ? 3.5 + 0.2 * S + 0.9 * S * G : 3.5 + 0.1 * S + 1.8 * S * G;
  return vo2 / 3.5;
}

/** Workload you produced per heartbeat. Higher at the same heart rate = fitter.
 *  Treadmill: estimated METs per 100 bpm. Bike: watts per bpm. */
export function outputPerBeat(b: Block): number | null {
  if (!b.avg_hr) return null;
  if (b.machine === "treadmill" && b.speed_kmh) return (treadmillMets(b.speed_kmh, b.incline_pct) / b.avg_hr) * 100;
  if (b.machine === "bike" && b.avg_watts) return b.avg_watts / b.avg_hr;
  return null;
}

export function sessionMinutes(s: Session): number {
  return s.blocks.reduce((a, b) => a + b.duration_min, 0);
}

export interface WeekStats {
  key: string;
  start: Date;
  minutes: number;
  zoneMinutes: number;
  sessions: Session[];
  calories: number;
  byDay: number[]; // 7 entries, Mon..Sun
}

export function groupByWeek(sessions: Session[], z: Zone | null): Map<string, WeekStats> {
  const map = new Map<string, WeekStats>();
  for (const s of sessions) {
    const d = new Date(s.performed_at);
    const key = weekKey(d);
    let w = map.get(key);
    if (!w) {
      w = { key, start: startOfWeek(d), minutes: 0, zoneMinutes: 0, sessions: [], calories: 0, byDay: [0, 0, 0, 0, 0, 0, 0] };
      map.set(key, w);
    }
    w.sessions.push(s);
    const dayIdx = dayIndex(d);
    for (const b of s.blocks) {
      w.minutes += b.duration_min;
      w.byDay[dayIdx] += b.duration_min;
      w.calories += b.calories ?? 0;
      if (zoneStatus(b.avg_hr, z) === "in") w.zoneMinutes += b.duration_min;
    }
  }
  return map;
}

export function emptyWeek(start: Date): WeekStats {
  return { key: weekKey(start), start, minutes: 0, zoneMinutes: 0, sessions: [], calories: 0, byDay: [0, 0, 0, 0, 0, 0, 0] };
}

/** Last n weeks including the current one, oldest first. */
export function recentWeeks(map: Map<string, WeekStats>, n: number): WeekStats[] {
  const cur = startOfWeek(new Date());
  const out: WeekStats[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = addDays(cur, -7 * i);
    out.push(map.get(weekKey(start)) ?? emptyWeek(start));
  }
  return out;
}

export function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function settingsSummary(b: Block): string {
  const parts: string[] = [];
  const r = (n: number) => round(n, 1);
  if (b.machine === "treadmill") {
    if (b.speed_kmh != null) parts.push(`${r(b.speed_kmh)} km/h`);
    if (b.incline_pct != null) parts.push(`${r(b.incline_pct)}% incline`);
  } else {
    if (b.resistance != null) parts.push(`level ${r(b.resistance)}`);
    if (b.rpm != null) parts.push(`${Math.round(b.rpm)} rpm`);
    if (b.avg_watts != null) parts.push(`${Math.round(b.avg_watts)} W`);
  }
  return parts.join(", ");
}

/** Benchmarks are compared when the machine settings match exactly. */
export function benchmarkKey(b: Block): string {
  return b.machine === "treadmill"
    ? `treadmill|${b.speed_kmh ?? ""}|${b.incline_pct ?? ""}|${Math.round(b.duration_min)}`
    : `bike|${b.resistance ?? ""}|${b.rpm ?? ""}|${Math.round(b.duration_min)}`;
}

export function toCsv(sessions: Session[]): string {
  const cols = ["date", "time", "machine", "duration_min", "avg_hr", "max_hr", "rpe", "speed_kmh", "incline_pct", "resistance", "rpm", "avg_watts", "distance_km", "calories", "benchmark", "notes"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [cols.join(",")];
  const sorted = [...sessions].sort((a, b) => a.performed_at.localeCompare(b.performed_at));
  for (const s of sorted) {
    const d = new Date(s.performed_at);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    for (const b of s.blocks) {
      rows.push([date, time, b.machine, b.duration_min, b.avg_hr, b.max_hr, b.rpe, b.speed_kmh, b.incline_pct, b.resistance, b.rpm, b.avg_watts, b.distance_km, b.calories, b.is_benchmark ? "yes" : "", s.notes].map(esc).join(","));
    }
  }
  return rows.join("\n");
}
