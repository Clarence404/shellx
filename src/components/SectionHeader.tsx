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
        color: "var(--text-2)", fontWeight: 500,
      }}>{label}</span>
      {action}
    </div>
  );
}
