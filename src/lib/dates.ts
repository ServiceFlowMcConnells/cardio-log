// Weeks start on the day chosen in Settings (Monday unless changed). 0 = Sunday … 6 = Saturday.
let weekStartDay = 1;
export const setWeekStart = (d: number) => { weekStartDay = ((Math.round(d) % 7) + 7) % 7; };
export const getWeekStart = () => weekStartDay;
/** Position of a date in its week: 0 = the first day of the week. */
export const dayIndex = (d: Date) => (d.getDay() - weekStartDay + 7) % 7;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Short day names in week order, e.g. Mon … Sun. */
export const weekdayLabels = () => Array.from({ length: 7 }, (_, i) => WEEKDAYS[(weekStartDay + i) % 7]);
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - dayIndex(x));
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function weekKey(d: Date): string {
  const s = startOfWeek(d);
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`;
}

const fmtDay = new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short" });
const fmtShort = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit" });

export const formatDay = (d: Date) => fmtDay.format(d);
export const formatShort = (d: Date) => fmtShort.format(d);
export const formatTime = (d: Date) => fmtTime.format(d);

export function weekLabel(start: Date): string {
  const now = startOfWeek(new Date());
  const diff = Math.round((now.getTime() - start.getTime()) / (7 * 86400000));
  if (diff === 0) return "This week";
  if (diff === 1) return "Last week";
  return `${formatShort(start)} – ${formatShort(addDays(start, 6))}`;
}

// Value for <input type="datetime-local">
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
