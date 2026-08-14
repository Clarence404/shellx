interface SparklineProps {
  data: number[];
  color?: string;
  fill?: string;
  height?: number;
  width?: number;
  fillContainer?: boolean;
  max?: number;
}

export function Sparkline({
  data,
  color = "var(--accent)",
  fill = "transparent",
  height = 40,
  width = 200,
  fillContainer = false,
  max: maxOverride,
}: SparklineProps) {
  const outerStyle = { display: "block" as const };
  const outerAttrs = fillContainer
    ? { width: "100%", height: "100%", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" }
    : { width, height };

  if (data.length < 2) {
    return <svg {...(outerAttrs as any)} style={outerStyle} />;
  }
  const min = 0;
  const max = maxOverride ?? Math.max(...data, 0.001);
  const coords = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - ((v - min) / (max - min)) * (height - 2) - 1,
  }));
  const linePoints = coords.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath =
    `M 0,${height} ` +
    coords.map((p) => `L ${p.x},${p.y}`).join(" ") +
    ` L ${width},${height} Z`;
  return (
    <svg {...(outerAttrs as any)} style={outerStyle}>
      <path d={areaPath} fill={fill} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        {...(fillContainer && { vectorEffect: "non-scaling-stroke" })}
      />
    </svg>
  );
}
