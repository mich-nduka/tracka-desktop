import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { api, toast } from "../lib/api";
import { formatLocalDate, monthRange, todayLagos, weekRange } from "../lib/dates";
import { formatDurationLong, previewEarnedKobo } from "../lib/format";
import { errorMessage } from "../lib/types";
import type { Session, Student } from "../lib/types";
import { Button, Confirm, EmptyState, FilterChip, Input, Segmented } from "../components/ui";
import { IconChip, getAccent } from "../components/IconChip";
import type { Route } from "../App";

const PAGE = 50;

type RangePreset = "all" | "week" | "month";

export function HistoryView({
  rev,
  onChanged,
  go,
}: {
  rev: number;
  onChanged: () => void;
  go: (r: Route) => void;
}) {
  const [preset, setPreset] = useState<RangePreset>("all");
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setLimit(PAGE);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    api
      .listStudents(true)
      .then(setStudents)
      .catch(() => {});
  }, [rev]);

  useEffect(() => {
    const today = todayLagos();
    let from = "";
    let to = "";
    if (preset === "week") {
      const r = weekRange(today);
      from = r.from;
      to = r.to;
    } else if (preset === "month") {
      const r = monthRange(today);
      from = r.from;
      to = r.to;
    }
    api
      .listSessions({ studentId: studentId ?? "", from, to, search: debouncedSearch }, limit, 0)
      .then(setSessions)
      .catch((e) => toast(errorMessage(e), true));
  }, [preset, studentId, debouncedSearch, limit, rev]);

  const byId = new Map(students.map((s) => [s.id, s]));

  return (
    <div className="page">
      <div className="flex items-center justify-between">
        <h1 className="page-title">History</h1>
        <Segmented
          value={preset}
          onChange={(v) => {
            setPreset(v);
            setLimit(PAGE);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "week", label: "This week" },
            { value: "month", label: "This month" },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3">
        <Input
          placeholder="Search notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {students.length > 1 ? (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <FilterChip
              label="Everyone"
              selected={studentId === null}
              onPress={() => setStudentId(null)}
            />
            {students.map((s) => (
              <FilterChip
                key={s.id}
                label={s.name}
                selected={studentId === s.id}
                onPress={() => setStudentId(studentId === s.id ? null : s.id)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions"
          message="Nothing matches these filters yet."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((s) => {
            const student = byId.get(s.studentId);
            const accent = getAccent(s.studentId);
            const isTimer = s.source === "timer";

            return (
              <div
                key={s.id}
                onClick={() =>
                  s.status === "running"
                    ? go({ name: "timer" })
                    : go({ name: "session-edit", id: s.id })
                }
                className="group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 hover:bg-zinc-900/60 cursor-pointer transition-colors"
              >
                <IconChip
                  icon={isTimer ? "stopwatch" : "create"}
                  accent={accent}
                  size={42}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground truncate">
                      {student?.name ?? "Unknown"} · {formatLocalDate(s.localDate)}
                    </span>
                    {s.notes ? (
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : null}
                    {s.status === "running" ? (
                      <span className="text-[11px] text-emerald-400 font-semibold kbd animate-pulse">
                        ● running
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground kbd mt-0.5 truncate">
                    {s.status === "running"
                      ? `${s.source} · started ${new Date(s.startedAt).toLocaleTimeString()}`
                      : `${formatDurationLong(s.durationSeconds ?? 0)} · ${s.source}`}
                    {s.notes ? ` · ${s.notes}` : ""}
                  </div>
                </div>

                <div className="font-bold text-sm text-foreground kbd">
                  {s.earnedKobo != null ? previewEarnedKobo(s.earnedKobo) : "…"}
                </div>

                <button
                  type="button"
                  title={s.status === "running" ? "Discard timer" : "Delete session"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete(s);
                  }}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-950/40 transition-colors ml-1 cursor-pointer opacity-70 group-hover:opacity-100 no-print"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}

          <div className="flex justify-center mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLimit((l) => l + PAGE)}
            >
              Load more
            </Button>
          </div>

          <div className="text-xs text-muted-foreground text-center select-none">
            {sessions.length} shown · click to edit · ✕ to{" "}
            {sessions.some((s) => s.status === "running") ? "discard" : "delete"}
          </div>
        </div>
      )}

      {pendingDelete ? (
        <Confirm
          title={
            pendingDelete.status === "running"
              ? "Discard running timer?"
              : "Delete session?"
          }
          message={
            pendingDelete.status === "running"
              ? "The running timer will be discarded — nothing will be logged."
              : `Delete the session on ${formatLocalDate(pendingDelete.localDate)}? This session will be removed from all earnings totals.`
          }
          confirmLabel={pendingDelete.status === "running" ? "Discard" : "Delete"}
          onConfirm={() => {
            const p = pendingDelete;
            setPendingDelete(null);
            (p.status === "running"
              ? api.discardRunningGroup()
              : api.deleteSession(p.id)
            )
              .then(() => {
                toast(p.status === "running" ? "Timer discarded" : "Session deleted");
                onChanged();
              })
              .catch((e) => toast(errorMessage(e), true));
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
