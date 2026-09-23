import { useEffect, useState } from "react";
import { api, toast } from "../lib/api";
import {
  epochFromDateAndTime,
  lagosTimeOfDay,
  todayLagos,
} from "../lib/dates";
import { computeEarned, formatNaira, previewEarnedKobo } from "../lib/format";
import { DURATION_MIN_SECONDS, errorMessage } from "../lib/types";
import type { Session, Student } from "../lib/types";
import { Button, Card, Confirm, EmptyState, Segmented } from "../components/ui";
import {
  DateField,
  Field,
  NotesField,
  RateField,
  StudentPicker,
  StudentSelectList,
  TimeEntryField,
  timeEntryDurationSeconds,
  type TimeEntryValue,
} from "../components/fields";
import type { Route } from "../App";

const DEFAULT_TIME_ENTRY: TimeEntryValue = {
  mode: "times",
  startTod: 16 * 3600,
  endTod: 17 * 3600,
  durationSeconds: 3600,
};

export function SessionNewView({
  onChanged,
  go,
}: {
  onChanged: () => void;
  go: (r: Route) => void;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [localDate, setLocalDate] = useState(todayLagos());
  const [time, setTime] = useState<TimeEntryValue>(DEFAULT_TIME_ENTRY);
  const [rateKobo, setRateKobo] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listStudents(false)
      .then(setStudents)
      .catch((e) => toast(errorMessage(e), true));
  }, []);

  const selectedRoster = students.filter((s) => selectedIds.includes(s.id));
  const singleStudent = selectedIds.length === 1 ? selectedRoster[0] : null;

  useEffect(() => {
    setRateKobo(singleStudent?.hourlyRateKobo ?? null);
  }, [singleStudent?.id]);

  const toggleStudent = (id: string) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const durationSeconds = timeEntryDurationSeconds(time);
  const effectiveRate = rateKobo ?? singleStudent?.hourlyRateKobo ?? 0;
  const previewTenths = selectedRoster.reduce(
    (sum, s) => sum + computeEarned(durationSeconds, singleStudent ? effectiveRate : s.hourlyRateKobo),
    0,
  );
  const combinedRateKobo = selectedRoster.reduce((sum, s) => sum + s.hourlyRateKobo, 0);

  const canSave =
    selectedIds.length > 0 &&
    durationSeconds >= DURATION_MIN_SECONDS &&
    (singleStudent ? effectiveRate > 0 : true);

  const onSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const rows = await api.logManualGroup({
        studentIds: selectedIds,
        localDate,
        startedAt:
          time.mode === "times"
            ? epochFromDateAndTime(localDate, time.startTod)
            : 0,
        hasStartedAt: time.mode === "times",
        durationSeconds,
        rateKobo: singleStudent && rateKobo ? rateKobo : 0,
        hasRate: Boolean(singleStudent && rateKobo !== null && rateKobo !== singleStudent.hourlyRateKobo),
        notes: notes.trim(),
      });
      toast(rows.length === 1 ? "Session logged" : `${rows.length} sessions logged`);
      onChanged();
      go({ name: "history" });
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Log session</h1>
      {students.length === 0 ? (
        <EmptyState
          icon="people"
          title="No students yet"
          message="Add a student before logging a session."
          action={<Button onClick={() => go({ name: "students" })}>Add student</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none block mb-2">
              Students
            </label>
            <StudentSelectList
              students={students}
              selectedIds={selectedIds}
              onToggle={toggleStudent}
            />
            {selectedIds.length > 1 ? (
              <p className="text-xs text-center text-muted-foreground kbd font-medium mt-2">
                {selectedIds.length} students · {formatNaira(combinedRateKobo)}/hr combined
              </p>
            ) : null}
          </div>

          <DateField value={localDate} onChange={setLocalDate} />

          <TimeEntryField value={time} onChange={setTime} />

          {singleStudent ? (
            <RateField
              kobo={rateKobo}
              onChange={setRateKobo}
              label="Rate for this session (₦/hr)"
              hint={`${singleStudent.name}'s usual rate applies unless you change it`}
            />
          ) : null}

          <NotesField value={notes} onChange={setNotes} />

          <Card className="flex flex-col items-center justify-center py-4 text-center">
            <span className="text-xs text-muted-foreground">
              {selectedIds.length > 1
                ? `This class earns (${selectedIds.length} students)`
                : "This session earns"}
            </span>
            <span className="text-2xl font-bold text-foreground kbd mt-1">
              {previewEarnedKobo(previewTenths)}
            </span>
          </Card>

          <Button
            size="lg"
            onClick={onSave}
            disabled={!canSave || busy}
            className="w-full font-semibold"
          >
            {selectedIds.length > 1
              ? `Log ${selectedIds.length} sessions`
              : "Log session"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function SessionEditView({
  id,
  onChanged,
  go,
}: {
  id: string;
  onChanged: () => void;
  go: (r: Route) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [localDate, setLocalDate] = useState("");
  const [time, setTime] = useState<TimeEntryValue>(DEFAULT_TIME_ENTRY);
  const [rateKobo, setRateKobo] = useState<number | null>(null);
  const [source, setSource] = useState<"timer" | "manual">("manual");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api
      .getSession(id)
      .then((s) => {
        if (s.status === "running") {
          go({ name: "timer" });
          return;
        }
        setSession(s);
        setStudentId(s.studentId);
        setLocalDate(s.localDate);
        setSource(s.source);
        setNotes(s.notes ?? "");
        setRateKobo(s.rateSnapshotKobo);
        const dur = s.durationSeconds ?? 3600;
        const startTod = lagosTimeOfDay(s.startedAt);
        setTime({
          mode: "times",
          startTod,
          endTod: (startTod + dur) % 86400,
          durationSeconds: dur,
        });
      })
      .catch((e) => toast(errorMessage(e), true));

    api
      .listStudents(true)
      .then(setStudents)
      .catch(() => {});
  }, [id]);

  const durationSeconds = timeEntryDurationSeconds(time);
  const previewTenths =
    rateKobo && rateKobo > 0 ? computeEarned(durationSeconds, rateKobo) : 0;

  if (!session) return <div className="page text-muted-foreground">Loading…</div>;

  const isTimer = session.source === "timer";

  const onSave = async () => {
    if (!rateKobo || durationSeconds < DURATION_MIN_SECONDS) return;
    setBusy(true);
    try {
      await api.updateSession(id, {
        studentId: isTimer ? session.studentId : studentId,
        hasStudentId: !isTimer && studentId !== session.studentId,
        source,
        hasSource: source !== session.source,
        localDate,
        hasLocalDate: localDate !== session.localDate,
        startedAt:
          time.mode === "times"
            ? epochFromDateAndTime(localDate, time.startTod)
            : session.startedAt,
        hasStartedAt: time.mode === "times",
        rateSnapshotKobo: rateKobo,
        hasRate: rateKobo !== session.rateSnapshotKobo,
        durationSeconds,
        hasDuration: durationSeconds !== session.durationSeconds,
        notes: notes.trim(),
        hasNotes: (notes.trim() || "") !== (session.notes ?? ""),
      });
      toast("Session updated");
      onChanged();
      go({ name: "history" });
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => go({ name: "history" })}
        className="w-fit -ml-2 text-muted-foreground"
      >
        ← History
      </Button>

      <h1 className="page-title">Edit session</h1>

      <div className="flex flex-col gap-4">
        <StudentPicker
          students={students}
          value={studentId}
          onChange={setStudentId}
          disabled={isTimer}
        />

        <DateField
          value={localDate}
          onChange={setLocalDate}
          warnWhenChangedFrom={session.localDate}
        />

        <TimeEntryField value={time} onChange={setTime} />

        <RateField
          kobo={rateKobo}
          onChange={setRateKobo}
          label="Rate (₦/hr)"
          hint="Historical snapshot — editing recomputes earnings"
        />

        <Field label="Source">
          <Segmented
            value={source}
            onChange={(s) => setSource(s as "timer" | "manual")}
            options={[
              { value: "timer", label: "Timer" },
              { value: "manual", label: "Manual" },
            ]}
          />
        </Field>

        <NotesField value={notes} onChange={setNotes} />

        <Card className="flex flex-col items-center justify-center py-4 text-center">
          <span className="text-xs text-muted-foreground">Recomputed earnings</span>
          <span className="text-2xl font-bold text-foreground kbd mt-1">
            {previewEarnedKobo(previewTenths)}
          </span>
        </Card>

        <div className="flex flex-col gap-2 mt-2">
          <Button
            size="lg"
            onClick={onSave}
            disabled={!rateKobo || durationSeconds < DURATION_MIN_SECONDS || busy}
            className="w-full font-semibold"
          >
            Save changes
          </Button>
          <Button
            size="lg"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            className="w-full"
          >
            Delete session
          </Button>
        </div>
      </div>

      {confirmDelete ? (
        <Confirm
          title="Delete session?"
          message="This session will be removed from all earnings totals. This cannot be undone."
          onConfirm={() => {
            api
              .deleteSession(id)
              .then(() => {
                toast("Session deleted");
                onChanged();
                go({ name: "history" });
              })
              .catch((e) => toast(errorMessage(e), true));
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
