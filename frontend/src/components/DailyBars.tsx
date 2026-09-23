import { previewEarnedKobo } from "@/lib/format";

export function DailyBars({
  values,
  labels,
  height = 72,
}: {
  values: number[];
  labels?: (string | null)[];
  height?: number;
}) {
  const max = Math.max(...values, 1);

  return (
    <div className="flex items-end gap-1 w-full" style={{ height: height + 24 }}>
      {values.map((v, i) => {
        const h = v === 0 ? 4 : Math.max(8, Math.round((v / max) * height));
        const formatted = previewEarnedKobo(v);

        return (
          <div
            key={i}
            className="flex-1 flex flex-col items-center gap-1.5 min-w-0 group relative"
            title={`${labels?.[i] ?? ""}: ${formatted}`}
          >
            <div
              className={`w-full max-w-[14px] rounded-full transition-all duration-200 ${
                v === 0 ? "bg-[#27272a]" : "bg-[#2662D9] group-hover:bg-[#3b82f6]"
              }`}
              style={{ height: `${h}px` }}
            />
            {labels ? (
              <span className="text-[10px] text-muted-foreground leading-none select-none">
                {labels[i] ?? "\u00A0"}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
