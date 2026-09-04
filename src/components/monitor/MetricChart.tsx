import { useRef, useState } from "react";
import { useT } from "../../i18n";

export interface ChartSeries {
  values: number[];
  color: string;
  /** Fill under the line (first series only, usually). */
  fill?: string;
  label: string;
}

interface Props {
  series: ChartSeries[];
  /** Seconds between samples, for the "Ns ago" readout. */
  intervalSecs: number;
  /** How each series value renders in the tooltip. */
  format: (v: number) => string;
  height?: number;
  /** Fixed scale ceiling (e.g. 100 for CPU%); auto if omitted. */
  max?: number;
}

const VW = 600; // internal viewBox width; scales to container via width:100%

/**
 * A width-fluid line chart (one or two series) with a hover crosshair and
 * a tooltip reading the value(s) at that time and how long ago it was.
 * The SVG scales with its card; the stroke stays crisp via non-scaling.
 */
export function MetricChart({ series, intervalSecs, format, height = 74, max }: Props) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = Math.max(...series.map((s) => s.values.length), 0);
  const ceil = max ?? Math.max(1, ...series.flatMap((s) => s.values));

  function path(vals: number[], close: boolean): string {
    if (vals.length < 2) return "";
    const pts = vals.map((v, i) => {
      const x = (i / (n - 1)) * VW;
      const y = height - (v / ceil) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    let d = pts.join(" ");
    if (close) d += ` L${VW},${height} L0,${height} Z`;
    return d;
  }

  function onMove(e: React.MouseEvent) {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || n < 2) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHoverIdx(Math.round(frac * (n - 1)));
  }

  const hoverX = hoverIdx != null && n > 1 ? (hoverIdx / (n - 1)) * 100 : 0;
  const secsAgo = hoverIdx != null ? (n - 1 - hoverIdx) * intervalSecs : 0;

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${VW} ${height}`}
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height }}
      >
        {series.map((s, i) => (
          <g key={i}>
            {s.fill && <path d={path(s.values, true)} fill={s.fill} stroke="none" />}
            <path
              d={path(s.values, false)}
              fill="none"
              stroke={s.color}
              strokeWidth={1.8}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>
      {hoverIdx != null && n > 1 && (
        <>
          <div style={{
            position: "absolute", top: 0, bottom: 0, width: 1,
            left: `${hoverX}%`, background: "var(--text-3)", opacity: 0.6,
            pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", top: -2,
            left: `clamp(0px, ${hoverX}% , 100%)`,
            transform: "translateX(-50%)",
            background: "var(--text-1)", color: "var(--panel-1)",
            fontSize: 10, fontFamily: "var(--font-mono)",
            padding: "3px 7px", borderRadius: 5, whiteSpace: "nowrap",
            pointerEvents: "none", zIndex: 5,
          }}>
            {series.map((s, i) => (
              <span key={i} style={{ marginRight: i < series.length - 1 ? 6 : 0 }}>
                <span style={{ color: s.color }}>■</span> {format(s.values[hoverIdx] ?? 0)}
              </span>
            ))}
            <span style={{ opacity: 0.6 }}> · {secsAgo === 0 ? t("now") : `${secsAgo}s ${t("ago")}`}</span>
          </div>
        </>
      )}
    </div>
  );
}
