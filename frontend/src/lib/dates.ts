import type { LocalDate } from "./types";

// Africa/Lagos is UTC+1 with no DST — fixed offset (port of mobile utils/dates.ts).
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export function lagosDate(epochMs: number): LocalDate {
  return new Date(epochMs + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayLagos(): LocalDate {
  return lagosDate(Date.now());
}

export function lagosMidday(date: LocalDate): number {
  return Date.parse(`${date}T12:00:00.000Z`) - LAGOS_OFFSET_MS;
}

const DAY_SECONDS = 86400;

export function lagosTimeOfDay(epochMs: number): number {
  const tod = Math.floor((epochMs + LAGOS_OFFSET_MS) / 1000) % DAY_SECONDS;
  return (tod + DAY_SECONDS) % DAY_SECONDS;
}

export function epochFromDateAndTime(date: LocalDate, todSeconds: number): number {
  return Date.parse(`${date}T00:00:00.000Z`) - LAGOS_OFFSET_MS + todSeconds * 1000;
}

export function durationBetweenTod(startTod: number, endTod: number): number {
  return (endTod - startTod + DAY_SECONDS) % DAY_SECONDS;
}

export function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DateRange {
  from: LocalDate;
  to: LocalDate;
}

export function weekRange(date: LocalDate): DateRange {
  const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const sinceMonday = (dow + 6) % 7;
  const from = addDays(date, -sinceMonday);
  return { from, to: addDays(from, 6) };
}

export function monthRange(date: LocalDate): DateRange {
  const [y, m] = date.split("-").map(Number);
  const prefix = date.slice(0, 7);
  return {
    from: `${prefix}-01`,
    to: `${prefix}-${String(daysInMonth(y, m)).padStart(2, "0")}`,
  };
}

export function formatLocalDate(date: LocalDate): string {
  const [y, m, d] = date.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}
