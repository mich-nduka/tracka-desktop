import { useEffect, useMemo, useState } from "react";
import { api, toast } from "../lib/api";
import { addDays, formatLocalDate, todayLagos } from "../lib/dates";
import { formatDurationLong, previewEarnedKobo } from "../lib/format";
import type { Dashboard as DashboardData } from "../lib/types";
import { Button, Card, EmptyState, Segmented } from "../components/ui";
import { EarningsRing, type RingSegment } from "../components/EarningsRing";
import { DailyBars } from "../components/DailyBars";
import { IconChip, getAccent } from "../components/IconChip";
import { SyncButton } from "../components/SyncButton";
import type { Route } from "../App";

type DashboardRange = "today" | "week" | "month";

const RANGE_LABEL: Record<DashboardRange, string> = {
  today: "earned today",
  week: "earned this week",
  month: "earned this month",
};

function weekday(date: string): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function greeting(): string {
  const hourLagos = (new Date().getUTCHours() + 1) % 24;
  if (hourLagos < 12) return "Good morning 👋";
  if (hourLagos < 17) return "Good afternoon 👋";
  return "Good evening 👋";
}

export function DashboardView({ rev, go }: { rev: number; go: (r: Route) => void }) {
  const [range, setRange] = useState<DashboardRange>("week");
  const [data, setData] = useState<DashboardData | null>(null);
  const [studentCount, setStudentCount] = useState(0);
  const [backupOverdue, setBackupOverdue] = useState(false);
  const [nagDismissed, setNagDismissed] = useState(false);
  const [localRev, setLocalRev] = useState(0);

  useEffect(() => {
    api
      .getDashboard(range)
      .then(setData)
      .catch((e) => toast(String(e), true));
    api
      .listStudents(false)
      .then((s) => setStudentCount(s.length))
      .catch(() => {});
    api
      .getBackupStatus()
      .then((b) => setBackupOverdue(b.overdue))
      .catch(() => {});
  }, [range, rev, localRev]);

  const rows = data?.byStudent ?? [];
  const total = data?.totalTenths ?? 0;

  // Concentric ring segments (top 3 students' share)
  const ringSegments: RingSegment[] = (rows.length > 0 ? rows.slice(0, 3) : [{ studentId: "", earnedKobo: 0 }]).map(
    (r) => {
      const accent = r.studentId ? getAccent(r.studentId) : getAccent("default");
      return {
        color: accent.main,
        trackColor: "#27272A",
        fraction: total > 0 ? r.earnedKobo / total : 0,
      };
    },
  );

  // Bars for every day of the range (week/month)
  const { barValues, barLabels } = useMemo(() => {
    if (!data || range === "today") return { barValues: [] as number[], barLabels: [] as string[] };
    const byDate = new Map(data.dailySeries.map((d) => [d.localDate, d.earnedKobo]));
    const dates: string[] = [];
    for (let d = data.range.from; d <= data.range.to; d = addDays(d, 1)) dates.push(d);
    return {
      barValues: dates.map((d) => byDate.get(d) ?? 0),
      barLabels:
        range === "week"
          ? dates.map((d) => weekday(d)[0])
          : dates.map((d, i) => (i % 7 === 0 ? String(Number(d.slice(8))) : "")),
    };
  }, [data, range]);

  const today = todayLagos();

  return (
    <div className="page">
      {/* Top greeting and range toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <IconChip icon="flower" size={44} background="#27272a" color="#fafafa" />
          <div>
            <div className="text-xs text-muted-foreground font-medium">{greeting()}</div>
            <h1 className="page-title text-2xl font-bold">
              {weekday(today)}, {formatLocalDate(today)}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SyncButton variant="chip" onChanged={() => setLocalRev((r) => r + 1)} />
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "today", label: "Today" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
        </div>
      </div>

      {backupOverdue && !nagDismissed ? (
        <Card warn>
          <div className="font-bold text-[#fcd34d] mb-1">Backup overdue</div>
          <div className="text-xs text-[#fcd34d] mb-3">
            Your data lives only on this computer. Export a backup — it's been over a week.
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => go({ name: "settings" })}>
              Export now
            </Button>
            <Button size="sm" variant="warn" onClick={() => setNagDismissed(true)}>
              Later
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Main concentric EarningsRing Card */}
      <Card className="flex flex-col items-center justify-center py-8 px-6">
        <EarningsRing size={240} thickness={13} segments={ringSegments}>
          <div className="text-xs text-muted-foreground font-medium mb-0.5">
            {RANGE_LABEL[range]}
          </div>
          <div className="text-3xl font-bold tracking-tight text-foreground kbd my-0.5">
            {previewEarnedKobo(total)}
          </div>
          {data ? (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {formatLocalDate(data.range.from)} – {formatLocalDate(data.range.to)}
            </div>
          ) : null}
        </EarningsRing>

        {barValues.length > 0 ? (
          <div className="w-full mt-6 pt-4 border-t border-border/50 max-w-lg">
            <DailyBars values={barValues} labels={barLabels} />
          </div>
        ) : null}
      </Card>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={() => go({ name: "timer" })}>
          Start timer
        </Button>
        <Button variant="secondary" onClick={() => go({ name: "session-new" })}>
          Log session
        </Button>
      </div>

      {/* By student section */}
      <div>
        <h2 className="section-title mb-3">By student</h2>
        {rows.length === 0 ? (
          studentCount === 0 ? (
            <EmptyState
              icon="people"
              title="Welcome to Tracka"
              message="Add your first student to start tracking classes and earnings."
              action={
                <Button onClick={() => go({ name: "students" })}>
                  Add your first student
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={`No classes ${range === "today" ? "today" : `this ${range}`}`}
              message="Start a timer when class begins, or log a session you already taught."
            />
          )
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((r) => {
              const accent = getAccent(r.studentId);
              return (
                <div
                  key={r.studentId}
                  onClick={() => go({ name: "student", id: r.studentId })}
                  className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 hover:bg-zinc-900/60 cursor-pointer transition-colors"
                >
                  <IconChip icon="school" accent={accent} size={42} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">
                      {r.name}
                    </div>
                    <div className="text-xs text-muted-foreground kbd">
                      {r.sessionCount} session{r.sessionCount === 1 ? "" : "s"} · {formatDurationLong(r.seconds)}
                    </div>
                  </div>
                  <div className="font-bold text-sm text-foreground kbd">
                    {previewEarnedKobo(r.earnedKobo)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
