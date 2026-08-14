interface SparklineProps {
  data: number[];
  color: string;
  fill: string;
  height: number;
  width?: number;
}

export function Sparkline({ data, color, fill, height, width = 120 }: SparklineProps) {
  if (data.length < 2) {
    return <svg width={width} height={height} />;
  }
  const min = 0;
  const max = Math.max(...data, 0.001);
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
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <path d={areaPath} fill={fill} />
      <polyline points={linePoints} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
