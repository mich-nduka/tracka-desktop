import React from "react";

export interface RingSegment {
  color: string;
  trackColor: string;
  /** 0..1 sweep of the full circle. */
  fraction: number;
}

export function EarningsRing({
  size = 240,
  thickness = 14,
  gap = 6,
  segments,
  children,
}: {
  size?: number;
  thickness?: number;
  gap?: number;
  segments: RingSegment[];
  children?: React.ReactNode;
}) {
  const center = size / 2;

  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="overflow-visible">
        <g transform={`rotate(-90 ${center} ${center})`}>
          {segments.map((seg, i) => {
            const r = center - thickness / 2 - i * (thickness + gap);
            if (r <= thickness) return null;
            const circumference = 2 * Math.PI * r;
            const sweep = Math.min(Math.max(seg.fraction, 0), 1) * circumference;

            return (
              <React.Fragment key={i}>
                <circle
                  cx={center}
                  cy={center}
                  r={r}
                  stroke={seg.trackColor}
                  strokeWidth={thickness}
                  fill="none"
                />
                {sweep > 0 ? (
                  <circle
                    cx={center}
                    cy={center}
                    r={r}
                    stroke={seg.color}
                    strokeWidth={thickness}
                    strokeLinecap="round"
                    strokeDasharray={`${sweep} ${circumference}`}
                    fill="none"
                    style={{ transition: "stroke-dasharray 0.3s ease" }}
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </g>
      </svg>
      <div
        className="absolute flex flex-col items-center justify-center text-center pointer-events-none"
        style={{ maxWidth: size * 0.64 }}
      >
        {children}
      </div>
    </div>
  );
}
