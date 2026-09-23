import React, { useState } from "react";
import { Calendar, ChevronDown, Check } from "lucide-react";
import { IconChip, getAccent } from "@/components/IconChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDurationLong, formatNaira, formatTod } from "@/lib/format";
import { durationBetweenTod, formatLocalDate, todayLagos } from "@/lib/dates";
import { DURATION_MIN_SECONDS } from "@/lib/types";
import type { Student } from "@/lib/types";

export function Field({
  label,
  children,
  hint,
  warning,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  warning?: string;
}) {
  return (
    <div className="flex flex-col space-y-1.5 mb-3.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
      {warning ? (
        <p className="text-xs text-[#fcd34d] font-medium mt-1">⚠ {warning}</p>
      ) : null}
    </div>
  );
}

/**
 * Multi-select student list cards (mirrors mobile StudentSelectList)
 */
export function StudentSelectList({
  students,
  selectedIds,
  onToggle,
}: {
  students: Student[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {students.map((student) => {
        const selected = selectedIds.includes(student.id);
        const accent = getAccent(student.id);

        return (
          <div
            key={student.id}
            role="checkbox"
            aria-checked={selected}
            onClick={() => onToggle(student.id)}
            className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-all select-none ${
              selected
                ? "border-primary bg-zinc-900/60 ring-1 ring-primary/40 shadow-xs"
                : "border-border bg-card hover:bg-zinc-900/40"
            }`}
          >
            <IconChip icon="school" accent={accent} size={40} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate text-foreground">
                {student.name}
              </div>
              <div className="text-xs text-muted-foreground kbd">
                {formatNaira(student.hourlyRateKobo)}/hr
                {student.status === "archived" ? " · archived" : ""}
              </div>
            </div>
            <div
              className={`h-5 w-5 rounded-md border flex items-center justify-center transition-colors ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-zinc-700 bg-transparent"
              }`}
            >
              {selected ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Single-student picker for edit session (mirrors mobile StudentPicker)
 */
export function StudentPicker({
  students,
  value,
  onChange,
  disabled,
  label = "Student",
}: {
  students: Student[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = students.find((s) => s.id === value) ?? null;
  const accent = selected ? getAccent(selected.id) : undefined;

  return (
    <Field label={label} hint={disabled ? "Locked for timer sessions" : undefined}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`flex h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-[#18181b] px-3 text-left transition-colors ${
          disabled ? "opacity-60 cursor-not-allowed" : "hover:border-zinc-600 cursor-pointer"
        }`}
      >
        {selected ? <IconChip icon="school" accent={accent} size={28} /> : null}
        <span
          className={`flex-1 text-[13.5px] truncate ${
            selected ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          {selected
            ? `${selected.name} · ${formatNaira(selected.hourlyRateKobo)}/hr`
            : "Choose a student…"}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose student</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pt-2">
            {students.map((item) => {
              const itemAccent = getAccent(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:bg-zinc-900 cursor-pointer transition-colors"
                >
                  <IconChip icon="school" accent={itemAccent} size={40} />
                  <div>
                    <div className="font-semibold text-sm text-foreground">{item.name}</div>
                    <div className="text-xs text-muted-foreground kbd">
                      {formatNaira(item.hourlyRateKobo)}/hr
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Field>
  );
}

/**
 * DateField with date picker popover and validation warnings
 */
export function DateField({
  value,
  onChange,
  label = "Date",
  warnWhenChangedFrom,
}: {
  value: string;
  onChange: (d: string) => void;
  label?: string;
  warnWhenChangedFrom?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = todayLagos();

  const warning =
    warnWhenChangedFrom !== undefined && value !== warnWhenChangedFrom
      ? "Changing the day this session counts toward"
      : value > today
        ? "This date is in the future"
        : undefined;

  const display = value === today ? `Today · ${formatLocalDate(value)}` : formatLocalDate(value);

  return (
    <Field label={label} warning={warning}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-border bg-[#18181b] px-3 text-left hover:border-zinc-600 transition-colors cursor-pointer"
            >
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-[13.5px] text-foreground font-medium truncate">
                {display}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          }
        />
        <PopoverContent align="start" className="w-auto p-4">
          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold text-muted-foreground">Select Date</div>
            <input
              type="date"
              value={value}
              onChange={(e) => {
                if (e.target.value) {
                  onChange(e.target.value);
                  setOpen(false);
                }
              }}
              className="flex h-9 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={() => {
                  onChange(today);
                  setOpen(false);
                }}
              >
                Today
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </Field>
  );
}

const DURATION_PRESETS: { label: string; seconds: number }[] = [
  { label: "30m", seconds: 1800 },
  { label: "45m", seconds: 2700 },
  { label: "1h", seconds: 3600 },
  { label: "1h 30m", seconds: 5400 },
  { label: "2h", seconds: 7200 },
];

/**
 * Duration entry with preset pills and h/m/s boxes (mirrors mobile DurationField)
 */
export function DurationField({
  seconds,
  onChange,
  label = "Duration",
}: {
  seconds: number;
  onChange: (s: number) => void;
  label?: string;
}) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const setTime = (nh: number, nm: number, ns: number) => {
    onChange(Math.max(0, nh * 3600 + nm * 60 + ns));
  };

  return (
    <Field label={label}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {DURATION_PRESETS.map((preset) => {
          const selected = seconds === preset.seconds;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.seconds)}
              className={`rounded-full px-3.5 py-1 text-xs font-medium border transition-colors cursor-pointer select-none ${
                selected
                  ? "bg-primary text-primary-foreground border-primary font-semibold"
                  : "bg-card text-muted-foreground border-border hover:bg-zinc-800 hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={24}
          value={h}
          onChange={(e) => setTime(parseInt(e.target.value, 10) || 0, m, s)}
          className="w-16 text-center kbd"
        />
        <span className="text-xs text-muted-foreground font-medium">h</span>
        <Input
          type="number"
          min={0}
          max={59}
          value={m}
          onChange={(e) => setTime(h, parseInt(e.target.value, 10) || 0, s)}
          className="w-16 text-center kbd"
        />
        <span className="text-xs text-muted-foreground font-medium">m</span>
        <Input
          type="number"
          min={0}
          max={59}
          value={s}
          onChange={(e) => setTime(h, m, parseInt(e.target.value, 10) || 0)}
          className="w-16 text-center kbd"
        />
        <span className="text-xs text-muted-foreground font-medium">s</span>
        <span className="text-xs text-muted-foreground ml-2 kbd font-semibold text-foreground">
          ({formatDurationLong(seconds)})
        </span>
      </div>
    </Field>
  );
}

/**
 * Wall-clock time-of-day entry (24h)
 */
export function TimeField({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (todSeconds: number) => void;
  label: string;
}) {
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);

  const setH = (nh: number) => onChange(nh * 3600 + m * 60);
  const setM = (nm: number) => onChange(h * 3600 + nm * 60);

  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={23}
          value={h}
          onChange={(e) => setH(Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))}
          className="w-16 text-center kbd"
        />
        <span className="text-muted-foreground font-bold">:</span>
        <Input
          type="number"
          min={0}
          max={59}
          value={m}
          onChange={(e) => setM(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
          className="w-16 text-center kbd"
        />
        <span className="text-xs text-muted-foreground ml-1 kbd">
          {formatTod(value)}
        </span>
      </div>
    </Field>
  );
}

export type TimeEntryMode = "times" | "duration";

export interface TimeEntryValue {
  mode: TimeEntryMode;
  startTod: number;
  endTod: number;
  durationSeconds: number;
}

export function timeEntryDurationSeconds(value: TimeEntryValue): number {
  return value.mode === "times"
    ? durationBetweenTod(value.startTod, value.endTod)
    : value.durationSeconds;
}

function syncTimeEntryMode(value: TimeEntryValue, mode: TimeEntryMode): TimeEntryValue {
  if (mode === value.mode) return value;
  if (mode === "duration") {
    const derived = durationBetweenTod(value.startTod, value.endTod);
    return {
      ...value,
      mode,
      durationSeconds: derived >= DURATION_MIN_SECONDS ? derived : value.durationSeconds,
    };
  }
  return { ...value, mode, endTod: (value.startTod + value.durationSeconds) % 86400 };
}

/**
 * Combined TimeEntryField with mode toggle (Start & end / Duration)
 */
export function TimeEntryField({
  value,
  onChange,
  label = "Time",
}: {
  value: TimeEntryValue;
  onChange: (v: TimeEntryValue) => void;
  label?: string;
}) {
  const duration = timeEntryDurationSeconds(value);
  const crossesMidnight = value.mode === "times" && value.endTod <= value.startTod && duration > 0;
  const warning =
    value.mode === "times"
      ? value.startTod === value.endTod
        ? "End must differ from start"
        : duration < DURATION_MIN_SECONDS
          ? "Sessions must be at least 1 minute long"
          : undefined
      : undefined;

  return (
    <div className="mb-3.5">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none">
          {label}
        </label>
        <SegmentedControl
          value={value.mode}
          onChange={(m) => onChange(syncTimeEntryMode(value, m))}
          options={[
            { value: "times", label: "Start & end" },
            { value: "duration", label: "Duration" },
          ]}
        />
      </div>

      {value.mode === "times" ? (
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="grid grid-cols-2 gap-4">
            <TimeField
              label="Starts"
              value={value.startTod}
              onChange={(startTod) => onChange({ ...value, startTod })}
            />
            <TimeField
              label="Ends"
              value={value.endTod}
              onChange={(endTod) => onChange({ ...value, endTod })}
            />
          </div>
          {warning ? (
            <p className="text-xs text-[#fcd34d] font-medium mt-1">⚠ {warning}</p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1 kbd">
              {formatDurationLong(duration)} · {formatTod(value.startTod)} → {formatTod(value.endTod)}
              {crossesMidnight ? " (ends next day)" : ""}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-3.5">
          <DurationField
            seconds={value.durationSeconds}
            onChange={(durationSeconds) => onChange({ ...value, durationSeconds })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * RateField with integer kobo parsing and helper hints
 */
export function RateField({
  kobo,
  onChange,
  label = "Hourly rate (₦)",
  hint,
}: {
  kobo: number | null;
  onChange: (kobo: number | null) => void;
  label?: string;
  hint?: string;
}) {
  const [text, setText] = useState(kobo === null ? "" : String(kobo / 100));

  React.useEffect(() => {
    setText(kobo === null ? "" : String(kobo / 100));
  }, [kobo]);

  const invalid = text.trim() !== "" && !(parseFloat(text) > 0);

  return (
    <Field
      label={label}
      hint={hint}
      warning={invalid ? "Rate must be greater than zero" : undefined}
    >
      <Input
        type="number"
        step="any"
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const naira = parseFloat(t);
          onChange(Number.isFinite(naira) && naira > 0 ? Math.round(naira * 100) : null);
        }}
        placeholder="2500"
        className="kbd"
      />
    </Field>
  );
}

/**
 * NotesField with character countdown
 */
export function NotesField({
  value,
  onChange,
  label = "Notes (optional)",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const remaining = 500 - value.length;

  return (
    <Field
      label={label}
      hint={remaining < 60 ? `${remaining} characters left` : undefined}
    >
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        placeholder="What did you cover?"
      />
    </Field>
  );
}
