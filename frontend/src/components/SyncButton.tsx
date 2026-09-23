import React, { useEffect, useState } from "react";
import { AlertCircle, Cloud, CloudOff, RefreshCw } from "lucide-react";
import { api, toast } from "../lib/api";
import { errorMessage, type SyncStatus } from "../lib/types";

interface SyncButtonProps {
  variant?: "sidebar" | "chip";
  onChanged?: () => void;
  className?: string;
}

export function SyncButton({ variant = "sidebar", onChanged, className = "" }: SyncButtonProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchStatus = () => {
    api
      .getSyncStatus()
      .then(setStatus)
      .catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (busy) return;

    setBusy(true);
    try {
      const ok = await api.syncNow();
      const updated = await api.getSyncStatus();
      setStatus(updated);
      onChanged?.();

      if (ok) {
        toast("Synced with Neon");
      } else if (updated.state === "offline") {
        toast(
          updated.pendingCount > 0
            ? `Offline · ${updated.pendingCount} local changes queued`
            : "Offline · Local mode",
          true
        );
      } else if (updated.error) {
        toast(`Sync failed: ${updated.error}`, true);
      }
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setBusy(false);
    }
  };

  const isSyncing = busy || status?.state === "syncing";
  const isOffline = status?.state === "offline";
  const isError = status?.state === "error";
  const pendingCount = status?.pendingCount ?? 0;

  if (variant === "chip") {
    let chipIcon = <Cloud size={16} className="text-emerald-400" />;
    let chipBg = "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    let title = "Synced with Cloud · Click to sync";

    if (isSyncing) {
      chipIcon = <RefreshCw size={16} className="animate-spin text-primary" />;
      chipBg = "bg-primary/10 hover:bg-primary/20 text-primary border-primary/30";
      title = "Syncing with Cloud...";
    } else if (isError) {
      chipIcon = <AlertCircle size={16} className="text-amber-400" />;
      chipBg = "bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30";
      title = `Sync Error: ${status?.error || "Check connection"} · Click to retry`;
    } else if (isOffline) {
      chipIcon = <CloudOff size={16} className="text-zinc-400" />;
      chipBg = "bg-zinc-800 hover:bg-zinc-700/80 text-zinc-300 border-zinc-700";
      title = pendingCount > 0 ? `${pendingCount} changes queued · Click to sync` : "Offline · Click to sync";
    }

    return (
      <button
        type="button"
        onClick={handleSync}
        disabled={isSyncing}
        title={title}
        className={`relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all shadow-sm active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed ${chipBg} ${className}`}
      >
        {chipIcon}
        <span>{isSyncing ? "Syncing..." : pendingCount > 0 ? `${pendingCount} queued` : "Sync"}</span>
        {pendingCount > 0 && !isSyncing ? (
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        ) : null}
      </button>
    );
  }

  // Sidebar variant
  let stateIcon = <Cloud size={17} className="text-emerald-400" />;
  let stateTitle = "Cloud Synced";
  let stateSub = status?.lastSyncAt
    ? `Last sync ${new Date(status.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Push & pull ready";
  let badgeColor = "bg-emerald-500/20 border-emerald-500/30 text-emerald-400";

  if (isSyncing) {
    stateIcon = <RefreshCw size={17} className="animate-spin text-primary" />;
    stateTitle = "Syncing with Cloud...";
    stateSub = "Reconciling changes";
    badgeColor = "bg-primary/20 border-primary/30 text-primary";
  } else if (isError) {
    stateIcon = <AlertCircle size={17} className="text-amber-400" />;
    stateTitle = "Sync Attention";
    stateSub = "Click to retry sync";
    badgeColor = "bg-amber-500/20 border-amber-500/30 text-amber-400";
  } else if (isOffline) {
    stateIcon = <CloudOff size={17} className="text-zinc-400" />;
    if (pendingCount > 0) {
      stateTitle = `${pendingCount} Queued ${pendingCount === 1 ? "Change" : "Changes"}`;
      stateSub = "Click to push to Neon";
      badgeColor = "bg-amber-500/20 border-amber-500/30 text-amber-400";
    } else {
      stateTitle = "Offline Mode";
      stateSub = "Click to connect & sync";
      badgeColor = "bg-zinc-800 border-zinc-700 text-zinc-400";
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => handleSync()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSync();
        }
      }}
      title="Click to perform immediate bidirectional push/pull cloud sync"
      className={`group w-full text-left p-2.5 rounded-lg border border-border/60 bg-card/60 hover:bg-accent/40 active:bg-accent/70 transition-all cursor-pointer select-none ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`w-8 h-8 rounded-md flex items-center justify-center border transition-transform group-hover:scale-105 ${badgeColor}`}
        >
          {stateIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground truncate">{stateTitle}</span>
            <RefreshCw
              size={12}
              className={`text-muted-foreground group-hover:text-foreground transition-transform ${
                isSyncing ? "animate-spin" : "group-hover:rotate-180 duration-500"
              }`}
            />
          </div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">{stateSub}</div>
        </div>
      </div>
    </div>
  );
}
