import type { ReactNode } from "react";

interface Props {
  label: string;
  action?: ReactNode;
}

export function SectionHeader({ label, action }: Props) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      paddingBottom: 6, marginBottom: 6,
      borderBottom: "1px solid var(--border)",
    }}>
      <span style={{
        fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
        // 10px small-caps needs a step brighter than plain --text-2 to stay
        // legible; still dimmer than --text-1 so it reads as a label.
        color: "color-mix(in srgb, var(--text-1) 60%, var(--text-2))", fontWeight: 600,
      }}>{label}</span>
      {action}
    </div>
  );
}
