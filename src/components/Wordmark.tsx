type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { box: number; icon: number; font: number; gap: number }> = {
  sm: { box: 20, icon: 12, font: 14, gap: 6 },
  md: { box: 28, icon: 16, font: 20, gap: 8 },
  lg: { box: 36, icon: 20, font: 28, gap: 10 },
};

export function Wordmark({ size = "md" }: { size?: Size }) {
  const s = SIZES[size];
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: s.gap }}>
      <div style={{
        width: s.box, height: s.box, borderRadius: s.box * 0.22,
        border: "1.5px solid var(--accent)",
        background: "var(--accent-fade)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--accent)",
      }}>
        <svg width={s.icon} height={s.icon} viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </div>
      <span style={{
        fontFamily: '"JetBrains Mono", var(--font-mono)',
        fontWeight: 700, fontSize: s.font,
        letterSpacing: "-0.5px", color: "var(--text-1)",
      }}>ShellX</span>
    </div>
  );
}
