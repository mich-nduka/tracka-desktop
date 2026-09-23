export type LocalDate = string;

export interface Student {
  id: string;
  name: string;
  hourlyRateKobo: number;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  studentId: string;
  source: "timer" | "manual";
  status: "running" | "completed";
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number | null;
  rateSnapshotKobo: number;
  earnedKobo: number | null;
  localDate: LocalDate;
  notes: string | null;
  groupId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StudentEarnings {
  studentId: string;
  name: string;
  earnedKobo: number;
  seconds: number;
  sessionCount: number;
}

export interface DayTotal {
  localDate: LocalDate;
  earnedKobo: number;
}

export interface Dashboard {
  range: { from: LocalDate; to: LocalDate };
  totalTenths: number;
  byStudent: StudentEarnings[];
  dailySeries: DayTotal[];
}

export interface SessionFilter {
  studentId: string;
  from: string;
  to: string;
  search: string;
}

export interface StopOptions {
  localDateOverride: string;
  durationOverrideSeconds: number;
  hasDurationOverride: boolean;
  notes: string;
  hasNotes: boolean;
}

export interface ManualGroupInput {
  studentIds: string[];
  durationSeconds: number;
  localDate: LocalDate;
  startedAt: number;
  hasStartedAt: boolean;
  rateKobo: number;
  hasRate: boolean;
  notes: string;
}

export interface SessionPatch {
  studentId: string;
  hasStudentId: boolean;
  source: string;
  hasSource: boolean;
  localDate: string;
  hasLocalDate: boolean;
  startedAt: number;
  hasStartedAt: boolean;
  rateSnapshotKobo: number;
  hasRate: boolean;
  durationSeconds: number;
  hasDuration: boolean;
  notes: string;
  hasNotes: boolean;
}

export interface LifetimeStats {
  earnedKobo: number;
  seconds: number;
  sessionCount: number;
}

export interface ReportRange {
  from: string;
  to: string;
  label: string;
}

export interface ReportSessionRow {
  localDate: LocalDate;
  durationSeconds: number;
  rateKobo: number;
  earnedTenths: number;
  notes: string;
  hasNotes: boolean;
  source: string;
}

export interface ReportStudent {
  name: string;
  archived: boolean;
  currentRateKobo: number;
  sessionCount: number;
  totalSeconds: number;
  earnedTenths: number;
  sessions: ReportSessionRow[];
}

export interface ReportData {
  range: ReportRange;
  generatedAt: string;
  students: ReportStudent[];
  grand: { sessionCount: number; totalSeconds: number; earnedTenths: number };
}

export const DURATION_MIN_SECONDS = 60;
export const DURATION_MAX_SECONDS = 86400;
export const STALE_TIMER_SECONDS = 8 * 3600;

/** Extract the stable error code from a Go domain error ("CODE: message"). */
export function errorCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const i = msg.indexOf(":");
  if (i > 0 && /^[A-Z_]+$/.test(msg.slice(0, i).trim())) return msg.slice(0, i).trim();
  return "";
}

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const i = msg.indexOf(":");
  if (i > 0 && /^[A-Z_]+$/.test(msg.slice(0, i).trim())) return msg.slice(i + 1).trim();
  return msg;
}

export type SyncState = "synced" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  pendingCount: number;
  lastSyncAt: number | null;
  error?: string;
}
