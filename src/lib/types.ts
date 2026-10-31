export type Machine = "treadmill" | "bike";

export interface Block {
  id?: string;
  session_id?: string;
  position: number;
  machine: Machine;
  duration_min: number;
  avg_hr: number | null;
  max_hr: number | null;
  rpe: number | null;
  distance_km: number | null;
  calories: number | null;
  speed_kmh: number | null;
  incline_pct: number | null;
  resistance: number | null;
  rpm: number | null;
  avg_watts: number | null;
  is_benchmark: boolean;
}

export interface Session {
  id: string;
  performed_at: string;
  notes: string | null;
  blocks: Block[];
}

export interface Settings {
  weekly_target_min: number;
  max_hr: number | null;
  zone_low_pct: number;
  zone_high_pct: number;
  weight_increment: number;
  default_rest_sec: number;
  e1rm_formula: "rpe" | "epley" | "brzycki";
  deload_until: string | null; // YYYY-MM-DD, last day of a deload week
  week_start: number; // 0 = Sunday, 1 = Monday …
}

export const DEFAULT_SETTINGS: Settings = {
  weekly_target_min: 150,
  max_hr: null,
  zone_low_pct: 60,
  zone_high_pct: 75,
  weight_increment: 2.5,
  default_rest_sec: 120,
  e1rm_formula: "rpe",
  deload_until: null,
  week_start: 1,
};

export const MACHINE_LABEL: Record<Machine, string> = {
  treadmill: "Treadmill",
  bike: "Bike",
};
