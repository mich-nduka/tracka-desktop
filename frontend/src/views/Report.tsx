import { useEffect, useMemo, useState } from "react";
import { api, toast } from "../lib/api";
import { formatLocalDate, monthRange, todayLagos, weekRange } from "../lib/dates";
import { formatDurationLong, previewEarnedKobo } from "../lib/format";
import { errorMessage } from "../lib/types";
import type { ReportData, Student } from "../lib/types";
import { Button, Card, Segmented } from "../components/ui";
import { DateField, StudentSelectList } from "../components/fields";

type Preset = "week" | "month" | "all" | "custom";

function rangeLabel(preset: Preset, from: string, to: string): string {
  if (preset === "all") return "All time";
  if (!from || !to) return "Custom range";
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (preset === "week") return `This week (${formatLocalDate(from)} – ${formatLocalDate(to)})`;
  if (preset === "month") return `This month (${formatLocalDate(from)} – ${formatLocalDate(to)})`;
  return sameMonth
    ? `${Number(from.slice(8))} – ${formatLocalDate(to)}`
    : `${formatLocalDate(from)} – ${formatLocalDate(to)}`;
}

export function ReportView({ initialStudentId }: { initialStudentId?: string }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(() => monthRange(todayLagos()).from);
  const [to, setTo] = useState(() => todayLagos());
  const [data, setData] = useState<ReportData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listStudents(true)
      .then((all) => {
        setStudents(all);
        if (initialStudentId) setSelected([initialStudentId]);
        else setSelected(all.map((s) => s.id));
      })
      .catch((e) => toast(errorMessage(e), true));
  }, [initialStudentId]);

  useEffect(() => {
    const today = todayLagos();
    if (preset === "week") {
      const r = weekRange(today);
      setFrom(r.from);
      setTo(r.to);
    } else if (preset === "month") {
      const r = monthRange(today);
      setFrom(r.from);
      setTo(r.to);
    } else if (preset === "all") {
      setFrom("");
      setTo("");
    }
  }, [preset]);

  const customInvalid = Boolean(preset === "custom" && from && to && from > to);
  const label = rangeLabel(preset, from, to);

  useEffect(() => {
    if (selected.length === 0 || customInvalid) {
      setData(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .collectReport(selected, from, to, label)
        .then(setData)
        .catch((e) => toast(errorMessage(e), true));
    }, 250);
    return () => clearTimeout(t);
  }, [selected.join(","), from, to, customInvalid, label]);

  const toggle = (id: string) =>
    setSelected((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const allIds = useMemo(() => students.map((s) => s.id), [students]);
  const allSelected = allIds.length > 0 && selected.length === allIds.length;

  const print = async () => {
    if (selected.length === 0 || customInvalid) return;
    setBusy(true);
    try {
      const html = await api.getReportHTML(selected, from, to, label);
      const iframe = document.createElement("iframe");
      iframe.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;z-index:9999;border:none;background:#fff;";
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument;
      if (!doc) throw new Error("Could not open print frame");
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => iframe.remove(), 1000);
      }, 300);
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Earnings report</h1>

      {/* Students section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none">
            Students
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(allSelected ? [] : allIds)}
            className="text-xs"
          >
            {allSelected ? "Clear all" : "Select all"}
          </Button>
        </div>
        <StudentSelectList
          students={students}
          selectedIds={selected}
          onToggle={toggle}
        />
      </div>

      {/* Period selection */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none block mb-2">
          Period
        </label>
        <Segmented
          value={preset}
          onChange={(p) => setPreset(p as Preset)}
          options={[
            { value: "week", label: "This week" },
            { value: "month", label: "This month" },
            { value: "all", label: "All time" },
            { value: "custom", label: "Custom" },
          ]}
        />

        {preset === "custom" ? (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
            {customInvalid ? (
              <p className="col-span-2 text-xs text-[#fcd34d] font-medium">
                ⚠ The start date is after the end date
              </p>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground mt-2 kbd">
            {preset === "all" ? "All time" : `${formatLocalDate(from)} – ${formatLocalDate(to)}`}
          </div>
        )}
      </div>

      {/* Report summary card matching mobile */}
      <Card className="flex flex-col items-center justify-center py-6 text-center">
        {data ? (
          <>
            <div className="text-2xl font-bold text-foreground kbd">
              {previewEarnedKobo(data.grand.earnedTenths)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 kbd">
              {data.students.length} student{data.students.length === 1 ? "" : "s"} ·{" "}
              {data.grand.sessionCount} session{data.grand.sessionCount === 1 ? "" : "s"} ·{" "}
              {formatDurationLong(data.grand.totalSeconds)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">{label}</div>
            <div className="mt-4 no-print">
              <Button onClick={print} disabled={busy || selected.length === 0 || customInvalid}>
                Print / save PDF…
              </Button>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            {selected.length === 0 ? "Select at least one student" : "Choose a valid period"}
          </div>
        )}
      </Card>

      {/* Printable paper preview */}
      {data && data.students.length > 0 ? (
        <div className="paper">
          <h3 className="text-base font-bold text-zinc-900 mb-1">Tracka — Earnings report</h3>
          <div className="text-xs text-zinc-500 mb-4">
            {label} · Generated {data.generatedAt}
          </div>
          {data.students.map((s) => (
            <div key={s.name} className="mt-4 pt-3 border-t border-zinc-200">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-800 mb-2">
                <span className="font-bold">
                  {s.name} {s.archived ? "(archived)" : ""}
                </span>
                <span className="kbd">
                  {s.sessionCount} sessions · {formatDurationLong(s.totalSeconds)} ·{" "}
                  <strong className="text-zinc-950 font-bold">
                    {previewEarnedKobo(s.earnedTenths)}
                  </strong>
                </span>
              </div>
              {s.sessions.length === 0 ? (
                <div className="text-xs text-zinc-400">No sessions in this period</div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-200">
                      <th className="py-1">Date</th>
                      <th className="py-1">Duration</th>
                      <th className="py-1">Earned</th>
                      <th className="py-1">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.sessions.map((r, i) => (
                      <tr key={i} className="border-b border-zinc-100">
                        <td className="py-1.5">{formatLocalDate(r.localDate)}</td>
                        <td className="py-1.5 kbd">{formatDurationLong(r.durationSeconds)}</td>
                        <td className="py-1.5 font-semibold kbd">{previewEarnedKobo(r.earnedTenths)}</td>
                        <td className="py-1.5 text-zinc-500">{r.hasNotes ? r.notes : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
