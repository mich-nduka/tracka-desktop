import { useEffect, useState } from "react";
import { Eye, EyeOff, ChevronRight, FileText } from "lucide-react";
import { api, toast } from "../lib/api";
import { formatLocalDate } from "../lib/dates";
import { formatDurationLong, formatNaira, previewEarnedKobo } from "../lib/format";
import { errorMessage } from "../lib/types";
import type { Session, Student } from "../lib/types";
import { Button, Card, Confirm, EmptyState, Input } from "../components/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import { IconChip, getAccent } from "../components/IconChip";
import { Field, RateField } from "../components/fields";
import type { Route } from "../App";

function StudentFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Student;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [rateKobo, setRateKobo] = useState<number | null>(initial?.hourlyRateKobo ?? null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast("Name cannot be empty.", true);
    if (!rateKobo || rateKobo <= 0) return toast("Enter a valid hourly rate in naira.", true);
    setBusy(true);
    try {
      if (initial) await api.updateStudent(initial.id, name.trim(), rateKobo);
      else await api.createStudent(name.trim(), rateKobo);
      toast(initial ? "Student updated" : "Student added");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit student" : "Add student"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Student name"
              autoFocus
            />
          </Field>
          <RateField
            label="Hourly rate (₦)"
            kobo={rateKobo}
            onChange={setRateKobo}
            hint="Set the agreed hourly rate for this student"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim() || !rateKobo}>
            {initial ? "Save changes" : "Add student"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StudentsView({
  rev,
  onChanged,
  go,
}: {
  rev: number;
  onChanged: () => void;
  go: (r: Route) => void;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    api
      .listStudents(true)
      .then(setStudents)
      .catch((e) => toast(errorMessage(e), true));
  }, [rev]);

  const visible = students
    .filter((s) => (showArchived ? true : s.status === "active"))
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Students</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors cursor-pointer select-none ${
              showArchived
                ? "bg-[#27272a] text-foreground border-zinc-600"
                : "bg-card text-muted-foreground border-border hover:bg-zinc-800 hover:text-foreground"
            }`}
          >
            {showArchived ? <Eye size={13} /> : <EyeOff size={13} />}
            <span>Archived</span>
          </button>
          <Button size="sm" variant="secondary" onClick={() => go({ name: "report" })}>
            Report
          </Button>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            + Add
          </Button>
        </div>
      </div>

      <Input
        placeholder="Search students…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon="people"
          title="No students"
          message={
            search
              ? "No students match your search."
              : "Add your first student with their agreed hourly rate."
          }
          action={
            !search ? (
              <Button onClick={() => setFormOpen(true)}>Add your first student</Button>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((s) => {
            const accent = getAccent(s.id);
            return (
              <div
                key={s.id}
                onClick={() => go({ name: "student", id: s.id })}
                className={`group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 hover:bg-zinc-900/60 cursor-pointer transition-colors ${
                  s.status === "archived" ? "opacity-60" : ""
                }`}
              >
                <IconChip icon="school" accent={accent} size={42} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-foreground truncate">
                    {s.name}
                  </div>
                  <div className="text-xs text-muted-foreground kbd">
                    {formatNaira(s.hourlyRateKobo)}/hr
                    {s.status === "archived" ? " · archived" : ""}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity" />
              </div>
            );
          })}
        </div>
      )}

      {formOpen ? (
        <StudentFormModal
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

export function StudentDetailView({
  id,
  onChanged,
  go,
}: {
  id: string;
  rev: number;
  onChanged: () => void;
  go: (r: Route) => void;
}) {
  const [student, setStudent] = useState<Student | null>(null);
  const [lifetime, setLifetime] = useState({ earnedKobo: 0, seconds: 0, sessionCount: 0 });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = () => {
    api
      .getStudent(id)
      .then(setStudent)
      .catch((e) => toast(errorMessage(e), true));
    api
      .getLifetime(id)
      .then(setLifetime)
      .catch(() => {});
    api
      .listSessionsByStudent(id, 100, 0)
      .then(setSessions)
      .catch(() => {});
  };

  useEffect(reload, [id]);

  if (!student) return <div className="page text-muted-foreground">Loading…</div>;

  const accent = getAccent(student.id);

  return (
    <div className="page">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => go({ name: "students" })}
        className="w-fit -ml-2 text-muted-foreground"
      >
        ← All students
      </Button>

      {/* Hero card matching mobile hero */}
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-[#18181b] p-6 text-center">
        <IconChip icon="school" accent={accent} size={56} />
        <h1 className="text-xl font-bold text-foreground mt-3">{student.name}</h1>
        <p className="text-xs text-muted-foreground kbd mt-1">
          {formatNaira(student.hourlyRateKobo)}/hr
          {student.status === "archived" ? " · archived" : ""}
        </p>
      </div>

      {/* 3 Stat tiles matching mobile */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="flex flex-col items-center justify-center py-3.5 px-2 text-center">
          <div className="font-bold text-base text-foreground kbd">
            {previewEarnedKobo(lifetime.earnedKobo)}
          </div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">
            Lifetime
          </div>
        </Card>
        <Card className="flex flex-col items-center justify-center py-3.5 px-2 text-center">
          <div className="font-bold text-base text-foreground kbd">
            {formatDurationLong(lifetime.seconds)}
          </div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">
            Taught
          </div>
        </Card>
        <Card className="flex flex-col items-center justify-center py-3.5 px-2 text-center">
          <div className="font-bold text-base text-foreground kbd">
            {lifetime.sessionCount}
          </div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">
            {lifetime.sessionCount === 1 ? "Session" : "Sessions"}
          </div>
        </Card>
      </div>

      {/* Action buttons matching mobile */}
      <div className="grid grid-cols-4 gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => go({ name: "report", studentId: student.id })}
        >
          Report
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          Edit
        </Button>
        {student.status === "active" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              api
                .archiveStudent(student.id)
                .then(() => {
                  toast("Student archived — history stays in your totals");
                  onChanged();
                  reload();
                })
                .catch((e) => toast(errorMessage(e), true));
            }}
          >
            Archive
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              api
                .unarchiveStudent(student.id)
                .then(() => {
                  toast("Student restored");
                  onChanged();
                  reload();
                })
                .catch((e) => toast(errorMessage(e), true));
            }}
          >
            Unarchive
          </Button>
        )}
        <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </div>

      {/* Recent sessions */}
      <div>
        <h2 className="section-title mb-3">Sessions</h2>
        {sessions.length === 0 ? (
          <EmptyState
            title="No sessions"
            message={`No sessions with ${student.name} yet.`}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((s) => {
              const isTimer = s.source === "timer";
              return (
                <div
                  key={s.id}
                  onClick={() =>
                    s.status === "running"
                      ? go({ name: "timer" })
                      : go({ name: "session-edit", id: s.id })
                  }
                  className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 hover:bg-zinc-900/60 cursor-pointer transition-colors"
                >
                  <IconChip icon={isTimer ? "stopwatch" : "create"} accent={accent} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">
                        {formatLocalDate(s.localDate)}
                      </span>
                      {s.notes ? (
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground kbd">
                      {s.status === "running"
                        ? "Running…"
                        : `${formatDurationLong(s.durationSeconds ?? 0)} · ${s.source}`}
                      {s.notes ? ` · ${s.notes}` : ""}
                    </div>
                  </div>
                  <div className="font-bold text-sm text-foreground kbd">
                    {s.earnedKobo != null ? previewEarnedKobo(s.earnedKobo) : "…"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing ? (
        <StudentFormModal
          initial={student}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
            reload();
          }}
        />
      ) : null}

      {confirmDelete ? (
        <Confirm
          title={`Delete ${student.name}?`}
          message={
            lifetime.sessionCount > 0
              ? `This permanently deletes ${student.name} AND their ${lifetime.sessionCount} logged session${lifetime.sessionCount === 1 ? "" : "s"}. Earnings totals will change. Consider archiving instead.`
              : `This permanently deletes ${student.name}.`
          }
          confirmLabel="Delete everything"
          onConfirm={() => {
            api
              .deleteStudent(student.id)
              .then(() => {
                toast("Student deleted");
                onChanged();
                go({ name: "students" });
              })
              .catch((e) => toast(errorMessage(e), true));
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
