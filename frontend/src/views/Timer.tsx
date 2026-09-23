import { useEffect, useMemo, useState } from "react";
import { X, Square } from "lucide-react";
import { api, toast } from "../lib/api";
import { computeEarned, formatElapsed, formatNaira, previewEarnedKobo } from "../lib/format";
import { DURATION_MAX_SECONDS, DURATION_MIN_SECONDS, errorCode, errorMessage } from "../lib/types";
import type { Session, Student } from "../lib/types";
import { Button, Card, CircleButton, Confirm, EmptyState } from "../components/ui";
import { EarningsRing } from "../components/EarningsRing";
import { getAccent } from "../components/IconChip";
import {
  DateField,
  DurationField,
  NotesField,
  StudentSelectList,
} from "../components/fields";

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function TimerView({ rev, onChanged }: { rev: number; onChanged: () => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [group, setGroup] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [dateOverride, setDateOverride] = useState("");
  const [staleDuration, setStaleDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const now = useNow();

  const reload = () => {
    api
      .listStudents(false)
      .then(setStudents)
      .catch((e) => toast(errorMessage(e), true));
    api
      .getRunningGroup()
      .then((g) => {
        setGroup(g);
        if (g.length > 0) {
          setNotes(g[0].notes ?? "");
          setDateOverride(g[0].localDate);
        }
      })
      .catch((e) => toast(errorMessage(e), true));
  };

  useEffect(reload, [rev]);

  const running = group.length > 0 ? group[0] : null;
  const elapsed = running ? Math.max(0, Math.floor((now - running.startedAt) / 1000)) : 0;
  const canStop = elapsed >= DURATION_MIN_SECONDS;
  const isStale = running ? now - running.startedAt > 8 * 3600 * 1000 : false;

  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const combinedRate = group.reduce((sum, s) => sum + s.rateSnapshotKobo, 0);
  const earnedTotal = group.reduce((sum, s) => sum + computeEarned(elapsed, s.rateSnapshotKobo), 0);
  const names = group.map((s) => byId.get(s.studentId)?.name ?? "…").join(" · ");
  const firstAccent = running ? getAccent(running.studentId) : getAccent("default");

  const toggle = (id: string) =>
    setSelected((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const onStart = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await api.startTimer(selected, notes.trim());
      setSelected([]);
      setNotes("");
      toast(selected.length === 1 ? "Timer started" : `Timer started for ${selected.length} students`);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  const onStop = async (durationOverride?: number) => {
    if (!running) return;
    setBusy(true);
    try {
      const stopped = await api.stopTimer(Date.now(), {
        localDateOverride: dateOverride || "",
        durationOverrideSeconds: durationOverride ?? 0,
        hasDurationOverride: durationOverride !== undefined,
        notes: notes.trim(),
        hasNotes: true,
      });
      toast(stopped.length === 1 ? "Session saved" : `${stopped.length} sessions saved`);
      onChanged();
    } catch (e) {
      const code = errorCode(e);
      if (code === "DURATION_TOO_SHORT" || code === "DURATION_TOO_LONG") {
        toast(`${errorMessage(e)} Discard instead?`, true);
        setConfirmDiscard(true);
      } else {
        toast(errorMessage(e), true);
      }
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = async () => {
    setConfirmDiscard(false);
    try {
      await api.discardRunningGroup();
      toast("Timer discarded");
      onChanged();
    } catch (e) {
      toast(errorMessage(e), true);
    }
  };

  if (!running) {
    const selectedRate = students
      .filter((s) => selected.includes(s.id))
      .reduce((sum, s) => sum + s.hourlyRateKobo, 0);

    return (
      <div className="page">
        <h1 className="page-title">Timer</h1>
        {students.length === 0 ? (
          <EmptyState
            icon="people"
            title="No students yet"
            message="Add a student before starting a timer."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">
                Who are you teaching?
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Pick one student or several — everyone earns at their own rate for the same time.
              </p>
              <StudentSelectList
                students={students}
                selectedIds={selected}
                onToggle={toggle}
              />
            </div>

            <NotesField value={notes} onChange={setNotes} />

            {selected.length > 1 ? (
              <p className="text-xs text-center text-muted-foreground kbd font-medium">
                {selected.length} students · {formatNaira(selectedRate)}/hr combined
              </p>
            ) : null}

            <Button
              size="lg"
              onClick={onStart}
              disabled={selected.length === 0 || busy}
              className="w-full font-semibold"
            >
              {selected.length > 1
                ? `Start class (${selected.length} students)`
                : "Start class"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Now teaching</h1>

      <Card className="flex flex-col items-center justify-center py-8 px-6 text-center">
        <div className="text-sm text-muted-foreground font-medium mb-3 truncate max-w-md">
          {names || "…"}
        </div>

        {/* Live sweeping circular EarningsRing arc */}
        <EarningsRing
          size={252}
          thickness={13}
          segments={[
            {
              color: firstAccent.main,
              trackColor: "#27272A",
              fraction: (elapsed % 3600) / 3600,
            },
          ]}
        >
          <div className="text-3xl font-extrabold text-foreground tracking-tight kbd mb-1">
            {formatElapsed(elapsed)}
          </div>
          <div
            className="text-lg font-bold kbd mb-1"
            style={{ color: firstAccent.onSoft }}
          >
            {previewEarnedKobo(earnedTotal)}
          </div>
          <div className="text-xs text-muted-foreground">
            at {formatNaira(combinedRate)}/hr{group.length > 1 ? " combined" : ""}
          </div>
        </EarningsRing>

        {/* Multi-student live earnings breakdown */}
        {group.length > 1 ? (
          <div className="w-full max-w-sm flex flex-col gap-2 mt-5 pt-4 border-t border-border/60">
            {group.map((s) => {
              const accent = getAccent(s.studentId);
              const studentName = byId.get(s.studentId)?.name ?? "…";
              const studentEarned = computeEarned(elapsed, s.rateSnapshotKobo);

              return (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: accent.main }}
                    />
                    <span className="text-muted-foreground truncate">
                      {studentName} · {formatNaira(s.rateSnapshotKobo)}/hr
                    </span>
                  </div>
                  <span className="font-semibold text-foreground kbd shrink-0 ml-2">
                    {previewEarnedKobo(studentEarned)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Circular Action Buttons */}
        {!isStale ? (
          <div className="flex items-center justify-center gap-6 mt-6">
            <CircleButton
              icon={<X className="h-5 w-5" />}
              size={52}
              variant="danger"
              onClick={() => setConfirmDiscard(true)}
              title="Discard timer"
            />
            <CircleButton
              icon={<Square className="h-6 w-6 fill-current" />}
              size={72}
              variant="primary"
              disabled={!canStop || busy}
              onClick={() => onStop()}
              title="Stop and save session"
            />
            <div style={{ width: 52 }} />
          </div>
        ) : null}

        {!isStale && !canStop ? (
          <div className="text-xs text-muted-foreground mt-3 select-none">
            Saves after 1 minute — {DURATION_MIN_SECONDS - elapsed}s to go
          </div>
        ) : null}
      </Card>

      {/* Stale Warning Card */}
      {isStale ? (
        <Card warn>
          <div className="font-bold text-[#fcd34d] mb-1">
            This timer has been running over 8 hours
          </div>
          <div className="text-xs text-[#fcd34d] mb-4">
            Set the real class length below, then stop — so phantom hours don't get logged.
          </div>
          <DurationField
            label="Actual duration"
            seconds={staleDuration ?? Math.min(elapsed, DURATION_MAX_SECONDS)}
            onChange={setStaleDuration}
          />
          <div className="flex items-center gap-3 mt-4">
            <Button
              onClick={() =>
                onStop(staleDuration ?? Math.min(elapsed, DURATION_MAX_SECONDS))
              }
              disabled={busy}
            >
              Stop with this duration
            </Button>
            <Button variant="destructive" onClick={() => setConfirmDiscard(true)}>
              Discard timer
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Notes and Date override */}
      <Card>
        <NotesField
          value={notes}
          onChange={setNotes}
          label="Notes (saved on stop)"
        />
        <DateField
          label="Counts toward (date)"
          value={dateOverride || running.localDate}
          onChange={setDateOverride}
          warnWhenChangedFrom={running.localDate}
        />
      </Card>

      {confirmDiscard ? (
        <Confirm
          title="Discard running timer?"
          message="Nothing will be logged for this class."
          confirmLabel="Discard"
          onConfirm={onDiscard}
          onCancel={() => setConfirmDiscard(false)}
        />
      ) : null}
    </div>
  );
}
