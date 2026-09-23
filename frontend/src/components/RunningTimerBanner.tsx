import React from "react";
import { Square } from "lucide-react";
import { IconChip, getAccent } from "@/components/IconChip";
import { formatElapsed, previewEarnedKobo } from "@/lib/format";
import { api, toast } from "@/lib/api";
import { errorMessage } from "@/lib/types";
import type { Route } from "@/App";

export function RunningTimerBanner({
  runningGroup,
  runningSince,
  now,
  studentMap,
  go,
  onChanged,
}: {
  runningGroup: { id: string; studentId: string; rateSnapshotKobo: number }[];
  runningSince: number;
  now: number;
  studentMap: Map<string, { id: string; name: string }>;
  go: (r: Route) => void;
  onChanged: () => void;
}) {
  if (runningGroup.length === 0) return null;

  const first = runningGroup[0];
  const accent = getAccent(first.studentId);
  const elapsedSeconds = Math.max(0, Math.floor((now - runningSince) / 1000));
  const canStop = elapsedSeconds >= 60;

  // Calculate live earnings preview
  const earnedTenths = runningGroup.reduce(
    (sum, s) => sum + Math.round((elapsedSeconds * s.rateSnapshotKobo * 10) / 3600),
    0,
  );

  const names = runningGroup
    .map((s) => studentMap.get(s.studentId)?.name ?? "…")
    .join(" · ");

  const onStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canStop) {
      go({ name: "timer" });
      return;
    }
    try {
      const stopped = await api.stopTimer(Date.now(), {
        durationOverrideSeconds: 0,
        hasDurationOverride: false,
        localDateOverride: "",
        notes: "",
        hasNotes: false,
      });
      toast(stopped.length === 1 ? "Session saved" : `${stopped.length} sessions saved`);
      onChanged();
    } catch (err) {
      toast(errorMessage(err), true);
    }
  };

  return (
    <div
      onClick={() => go({ name: "timer" })}
      className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 shadow-sm hover:border-zinc-700 transition-all cursor-pointer no-print"
    >
      <IconChip
        icon={runningGroup.length > 1 ? "people" : "school"}
        accent={accent}
        size={44}
      />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate text-foreground">
          {names || "…"}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
          <span className="font-medium text-foreground kbd">
            {formatElapsed(elapsedSeconds)}
          </span>
          <span>·</span>
          <span className="text-[#5ED4AC] font-semibold kbd">
            {previewEarnedKobo(earnedTenths)}
          </span>
          {runningGroup.length > 1 ? (
            <>
              <span>·</span>
              <span>{runningGroup.length} students</span>
            </>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onStop}
        disabled={!canStop}
        title={canStop ? "Stop and save session" : "Must run at least 1 minute"}
        className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-35 cursor-pointer shrink-0"
      >
        <Square className="h-4 w-4 fill-current" />
      </button>
    </div>
  );
}
