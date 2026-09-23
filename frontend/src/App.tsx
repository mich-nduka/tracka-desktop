import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  FileText,
  History,
  LayoutDashboard,
  Settings,
  Timer,
  Users,
} from "lucide-react";
import { api } from "./lib/api";
import { DashboardView } from "./views/Dashboard";
import { TimerView } from "./views/Timer";
import { StudentDetailView, StudentsView } from "./views/Students";
import { HistoryView } from "./views/History";
import { SessionEditView, SessionNewView } from "./views/SessionForm";
import { ReportView } from "./views/Report";
import { SettingsView } from "./views/Settings";
import { Button, Card, useToasts } from "./components/ui";
import { RunningTimerBanner } from "./components/RunningTimerBanner";
import { SyncButton } from "./components/SyncButton";
import type { Session, Student } from "./lib/types";

export type Route =
  | { name: "dashboard" }
  | { name: "timer" }
  | { name: "students" }
  | { name: "student"; id: string }
  | { name: "history" }
  | { name: "session-new" }
  | { name: "session-edit"; id: string }
  | { name: "report"; studentId?: string }
  | { name: "settings" };

const NAV: { name: Route["name"]; label: string; icon: React.ReactNode }[] = [
  { name: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { name: "timer", label: "Timer", icon: <Timer size={18} /> },
  { name: "students", label: "Students", icon: <Users size={18} /> },
  { name: "history", label: "History", icon: <History size={18} /> },
  { name: "report", label: "Report", icon: <FileText size={18} /> },
  { name: "settings", label: "Settings", icon: <Settings size={18} /> },
];

function activeRoot(route: Route): string {
  switch (route.name) {
    case "student":
      return "students";
    case "session-new":
    case "session-edit":
      return "history";
    case "report":
      return "report";
    default:
      return route.name;
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "dashboard" });
  const [rev, setRev] = useState(0);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const [runningGroup, setRunningGroup] = useState<Session[]>([]);
  const [runningSince, setRunningSince] = useState(0);
  const [students, setStudents] = useState<Student[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const toasts = useToasts();

  const onChanged = useCallback(() => setRev((r) => r + 1), []);
  const go = useCallback((r: Route) => setRoute(r), []);

  useEffect(() => {
    api
      .startupCheck()
      .then((s) => {
        if (!s.ok) {
          setStartupError(`Database integrity check failed: ${s.integrityDetail || "unknown error"}`);
          return;
        }
        setRunningSince(s.runningSince);
        if (s.runningCount > 0 && s.isStale) setStaleNotice(true);
      })
      .catch((e) => setStartupError(String(e)));

    api
      .listStudents(true)
      .then(setStudents)
      .catch(() => {});
  }, [rev]);

  // Poll the running group so the sidebar dot + banner stay fresh.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      api
        .getRunningGroup()
        .then((g) => {
          setRunningGroup(g);
          if (g.length > 0) setRunningSince(g[0].startedAt);
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [rev]);

  const studentMap = new Map(students.map((s) => [s.id, s]));

  if (startupError) {
    return (
      <div className="shell">
        <div className="main">
          <div className="page">
            <h1 className="page-title">Tracka couldn't start</h1>
            <Card warn>
              <div className="font-bold text-[#fcd34d]">Database problem</div>
              <p className="text-xs text-[#fcd34d] mt-1">{startupError}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Restore from a recent backup in Settings once the app opens, or delete the database file to start fresh.
              </p>
            </Card>
          </div>
        </div>
        {toasts}
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar no-print">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-name">Tracka</div>
            <div className="brand-sub">offline · single-user</div>
          </div>
        </div>
        {NAV.map((n) => (
          <button
            key={n.name}
            className={`nav-item${activeRoot(route) === n.name ? " active" : ""}`}
            onClick={() => {
              if (n.name === "report") go({ name: "report" });
              else go({ name: n.name } as Route);
            }}
          >
            {n.icon}
            <span>{n.label}</span>
            {n.name === "timer" && runningGroup.length > 0 ? <span className="dot" /> : null}
          </button>
        ))}
        <SyncButton variant="sidebar" onChanged={onChanged} className="mt-auto mb-2" />
        <div className="sidebar-foot">
          Weeks start Monday
          <br />
          Africa/Lagos (UTC+1)
        </div>
      </aside>

      <main className="main">
        {runningGroup.length > 0 && route.name !== "timer" ? (
          <div className="page mb-4">
            <RunningTimerBanner
              runningGroup={runningGroup}
              runningSince={runningSince}
              now={now}
              studentMap={studentMap}
              go={go}
              onChanged={onChanged}
            />
          </div>
        ) : null}

        {staleNotice && runningGroup.length > 0 ? (
          <div className="page mb-4">
            <Card warn>
              <div className="font-bold text-[#fcd34d]">
                A timer has been running over 8 hours
              </div>
              <div className="text-xs text-[#fcd34d] my-2">
                Open the timer to set the real class length or discard it.
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => { setStaleNotice(false); go({ name: "timer" }); }}>
                  Open timer
                </Button>
                <Button size="sm" variant="warn" onClick={() => setStaleNotice(false)}>
                  Dismiss
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        {route.name === "dashboard" ? <DashboardView rev={rev} go={go} /> : null}
        {route.name === "timer" ? <TimerView rev={rev} onChanged={onChanged} /> : null}
        {route.name === "students" ? <StudentsView rev={rev} onChanged={onChanged} go={go} /> : null}
        {route.name === "student" ? (
          <StudentDetailView id={route.id} rev={rev} onChanged={onChanged} go={go} />
        ) : null}
        {route.name === "history" ? <HistoryView rev={rev} onChanged={onChanged} go={go} /> : null}
        {route.name === "session-new" ? <SessionNewView onChanged={onChanged} go={go} /> : null}
        {route.name === "session-edit" ? (
          <SessionEditView id={route.id} onChanged={onChanged} go={go} />
        ) : null}
        {route.name === "report" ? <ReportView initialStudentId={route.studentId} /> : null}
        {route.name === "settings" ? <SettingsView rev={rev} onChanged={onChanged} /> : null}

        <div className="page">
          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-6 select-none">
            <BarChart3 size={13} />
            Tracka desktop — same rules as mobile: kobo money, Lagos dates, one running timer.
          </div>
        </div>
      </main>
      {toasts}
    </div>
  );
}
