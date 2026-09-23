import { TrackaService } from "../../bindings/tracka-desktop";
import type {
  Dashboard,
  LifetimeStats,
  ManualGroupInput,
  ReportData,
  Session,
  SessionFilter,
  SessionPatch,
  StopOptions,
  Student,
  SyncStatus,
} from "./types";

// Thin typed wrapper over the generated Wails bindings. The generated
// models are classes with identical shapes, so we cast to plain types.

export const api = {
  listStudents: (includeArchived: boolean) =>
    TrackaService.ListStudents(includeArchived) as unknown as Promise<Student[]>,
  getStudent: (id: string) => TrackaService.GetStudent(id) as unknown as Promise<Student>,
  createStudent: (name: string, hourlyRateKobo: number) =>
    TrackaService.CreateStudent(name, hourlyRateKobo) as unknown as Promise<Student>,
  updateStudent: (id: string, name: string, hourlyRateKobo: number) =>
    TrackaService.UpdateStudent(id, name, hourlyRateKobo) as unknown as Promise<Student>,
  archiveStudent: (id: string) => TrackaService.ArchiveStudent(id) as Promise<void>,
  unarchiveStudent: (id: string) => TrackaService.UnarchiveStudent(id) as Promise<void>,
  deleteStudent: (id: string) => TrackaService.DeleteStudent(id) as Promise<void>,

  getRunningGroup: () => TrackaService.GetRunningGroup() as unknown as Promise<Session[]>,
  startTimer: (studentIDs: string[], notes: string) =>
    TrackaService.StartTimer(studentIDs, notes) as unknown as Promise<Session[]>,
  stopTimer: (endedAtMillis: number, opts: StopOptions) =>
    TrackaService.StopTimer(endedAtMillis, opts) as unknown as Promise<Session[]>,
  discardRunningGroup: () => TrackaService.DiscardRunningGroup() as Promise<void>,

  logManualGroup: (input: ManualGroupInput) =>
    TrackaService.LogManualGroup(input as never) as unknown as Promise<Session[]>,
  getSession: (id: string) => TrackaService.GetSession(id) as unknown as Promise<Session>,
  updateSession: (id: string, patch: SessionPatch) =>
    TrackaService.UpdateSession(id, patch as never) as unknown as Promise<Session>,
  deleteSession: (id: string) => TrackaService.DeleteSession(id) as Promise<void>,
  listSessionsByStudent: (studentID: string, limit: number, offset: number) =>
    TrackaService.ListSessionsByStudent(studentID, limit, offset) as unknown as Promise<Session[]>,
  listSessions: (filter: SessionFilter, limit: number, offset: number) =>
    TrackaService.ListSessions(filter as never, limit, offset) as unknown as Promise<Session[]>,

  getDashboard: (kind: string) => TrackaService.GetDashboard(kind) as unknown as Promise<Dashboard>,
  getLifetime: (studentID: string) =>
    TrackaService.GetLifetime(studentID) as unknown as Promise<LifetimeStats>,

  collectReport: (studentIDs: string[], from: string, to: string, label: string) =>
    TrackaService.CollectReport(studentIDs, from, to, label) as unknown as Promise<ReportData>,
  getReportHTML: (studentIDs: string[], from: string, to: string, label: string) =>
    TrackaService.GetReportHTML(studentIDs, from, to, label) as unknown as Promise<string>,

  exportCSV: () => TrackaService.ExportCSV() as unknown as Promise<{ filename: string; content: string }>,
  exportBackup: () =>
    TrackaService.ExportBackup() as unknown as Promise<{ filename: string; base64: string; mime: string }>,
  markExported: () => TrackaService.MarkExported() as Promise<void>,
  getBackupStatus: () =>
    TrackaService.GetBackupStatus() as unknown as Promise<{ lastExportAt: number | null; overdue: boolean }>,
  restoreBackup: (base64Data: string, filename: string) =>
    TrackaService.RestoreBackup(base64Data, filename) as unknown as Promise<string>,
  restoreBackupDialog: () => TrackaService.RestoreBackupDialog() as unknown as Promise<string>,
  syncNow: () => TrackaService.SyncNow() as unknown as Promise<boolean>,
  getSyncStatus: () => TrackaService.GetSyncStatus() as unknown as Promise<SyncStatus>,
  startupCheck: () =>
    TrackaService.StartupCheck() as unknown as Promise<{
      ok: boolean;
      integrityDetail: string;
      runningCount: number;
      runningSince: number;
      isStale: boolean;
      backupOverdue: boolean;
      schemaVersion: number;
      databasePath: string;
    }>,
};

// ---------- file download helpers (desktop save via browser download) ----------

export function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  triggerDownload(filename, blob);
}

export function downloadBase64(filename: string, base64: string, mime = "application/octet-stream") {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  triggerDownload(filename, new Blob([bytes], { type: mime }));
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// ---------- toasts ----------

export function toast(message: string, isError = false) {
  window.dispatchEvent(new CustomEvent("tracka-toast", { detail: { message, isError } }));
}
