import type { ReactNode } from "react";

interface Props {
  label: string;
  action?: ReactNode;
}

export function SectionHeader({ label, action }: Props) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      paddingBottom: 8, marginBottom: 6,
      borderBottom: "1px solid var(--border)",
    }}>
      <span style={{
        // One step above body text: a real title, not a small-caps tag.
        fontSize: "calc(var(--font-ui-size) + 1px)", fontWeight: 600,
        letterSpacing: 0.2, color: "var(--text-1)", paddingLeft: 2,
      }}>{label}</span>
      {action}
    </div>
  );
}
