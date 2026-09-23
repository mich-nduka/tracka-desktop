// Port of mobile utils/format.ts + utils/earnings.ts

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatNaira(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const naira = Math.round(Math.abs(kobo)) / 100;
  const [int, frac] = naira.toFixed(2).split(".");
  const grouped = groupThousands(int);
  return frac === "00" ? `${sign}₦${grouped}` : `${sign}₦${grouped}.${frac}`;
}

export function previewEarnedKobo(tenths: number): string {
  return formatNaira(tenths / 10);
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatDurationLong(seconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatTod(todSeconds: number): string {
  const h = Math.floor(todSeconds / 3600);
  const m = Math.floor((todSeconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function computeEarned(durationSeconds: number, rateKobo: number): number {
  return Math.round((durationSeconds * rateKobo * 10) / 3600);
}

/** "5000" naira string -> kobo int. Returns null when invalid. */
export function parseNairaToKobo(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const kobo = Math.round(parseFloat(t) * 100);
  return kobo > 0 ? kobo : null;
}

export function formatRateInput(kobo: number): string {
  return (kobo / 100).toString();
}
