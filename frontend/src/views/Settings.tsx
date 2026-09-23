import { useEffect, useState } from "react";
import { api, downloadBase64, downloadText, toast } from "../lib/api";
import { errorMessage, type SyncStatus } from "../lib/types";
import { Button, Card, Confirm } from "../components/ui";
import { IconChip } from "../components/IconChip";

export function SettingsView({ onChanged }: { rev: number; onChanged: () => void }) {
  const [lastExportAt, setLastExportAt] = useState<number | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [dbPath, setDbPath] = useState("");
  const [schemaVersion, setSchemaVersion] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<null | "db" | "csv" | "restore" | "sync">(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const reload = () => {
    api
      .getBackupStatus()
      .then((b) => {
        setLastExportAt(b.lastExportAt);
        setOverdue(b.overdue);
      })
      .catch(() => {});
    api
      .startupCheck()
      .then((s) => {
        setDbPath(s.databasePath);
        setSchemaVersion(s.schemaVersion);
      })
      .catch(() => {});
    api
      .getSyncStatus()
      .then(setSyncStatus)
      .catch(() => {});
  };

  useEffect(() => {
    reload();
    const interval = setInterval(() => {
      api
        .getSyncStatus()
        .then(setSyncStatus)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    setBusy("sync");
    try {
      const ok = await api.syncNow();
      const s = await api.getSyncStatus();
      setSyncStatus(s);
      onChanged();
      if (ok) {
        toast("Synced with Neon");
      } else if (s.state === "offline") {
        toast("Offline · Changes queued locally", true);
      } else if (s.error) {
        toast(`Sync failed: ${s.error}`, true);
      }
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(null);
    }
  };

  const exportBackup = async () => {
    setBusy("db");
    try {
      const f = await api.exportBackup();
      downloadBase64(f.filename, f.base64, f.mime);
      await api.markExported();
      onChanged();
      reload();
      toast("Backup exported");
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setBusy("csv");
    try {
      const f = await api.exportCSV();
      downloadText(f.filename, f.content, "text/csv");
      await api.markExported();
      onChanged();
      reload();
      toast("CSV exported");
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(null);
    }
  };

  const restoreViaDialog = async () => {
    setBusy("restore");
    try {
      const msg = await api.restoreBackupDialog();
      onChanged();
      reload();
      toast(msg);
    } catch (e) {
      const code = (e as Error)?.message?.split(":")[0] ?? "";
      if (code === "CANCELLED") {
        // user dismissed picker
      } else {
        toast(errorMessage(e), true);
      }
    } finally {
      setBusy(null);
      setConfirmRestore(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>

      {/* Neon Cloud Sync Card */}
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3.5">
          <IconChip
            icon={
              syncStatus?.state === "offline"
                ? "cloud-offline"
                : syncStatus?.state === "error"
                ? "alert-circle"
                : "cloud-done"
            }
            size={44}
            background="#27272a"
            color="#fafafa"
          />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-foreground">Neon Cloud Sync</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {syncStatus?.state === "syncing"
                ? "Syncing with Neon…"
                : syncStatus?.state === "offline"
                ? `Offline · ${syncStatus.pendingCount} local changes pending`
                : syncStatus?.state === "error"
                ? `Sync error: ${syncStatus.error || "Failed to reach Neon"}`
                : syncStatus?.lastSyncAt
                ? `Synced with Neon · Last sync: ${new Date(syncStatus.lastSyncAt).toLocaleTimeString()}`
                : "Connected to Neon Postgres"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 pt-1">
          <Button
            variant="secondary"
            onClick={handleSync}
            disabled={busy !== null}
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </Card>

      {/* Backup Card */}
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3.5">
          <IconChip icon="cloud-upload" size={44} background="#27272a" color="#fafafa" />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-foreground">Backup</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lastExportAt
                ? `Last export: ${new Date(lastExportAt).toLocaleString()}${overdue ? " · Overdue" : ""}`
                : "Never exported — data is safe in the cloud, but keep regular backups."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap pt-1">
          <Button onClick={exportBackup} disabled={busy !== null}>
            {busy === "db" ? "Exporting…" : "Export backup (.zip)"}
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={busy !== null}>
            {busy === "csv" ? "Exporting…" : "Export sessions (CSV)"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirmRestore(true)}
            disabled={busy !== null}
          >
            Restore from backup…
          </Button>
        </div>
      </Card>

      {/* About Card */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-3.5">
          <IconChip icon="information-circle" size={44} background="#27272a" color="#fafafa" />
          <h2 className="text-base font-semibold text-foreground">About</h2>
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground pt-1">
          <p>Weeks start on Monday · Timezone: Africa/Lagos (UTC+1)</p>
          <p>Currency stored as integer kobo; earnings at 1/10-kobo precision.</p>
          <p>Tracka desktop 1.0.0 · Offline-first SQLite with Neon Cloud Sync · schema v{schemaVersion}</p>
          <p className="text-[11px] text-zinc-500 break-all select-all font-mono mt-1">
            Local cache: {dbPath || "~/.config/tracka-desktop/tracka.db"}
          </p>
        </div>
      </Card>

      {confirmRestore ? (
        <Confirm
          title="Restore from backup?"
          message="This REPLACES everything currently in the app with the backup file. This cannot be undone."
          confirmLabel="Choose file…"
          onConfirm={() => void restoreViaDialog()}
          onCancel={() => setConfirmRestore(false)}
        />
      ) : null}
    </div>
  );
}
