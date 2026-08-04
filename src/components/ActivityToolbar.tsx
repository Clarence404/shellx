import { Monitor, Folder } from "lucide-react";
import type { ActivityKind } from "../types/connection";

interface Props {
  activity: ActivityKind;
  onChange: (a: ActivityKind) => void;
}

export function ActivityToolbar({ activity, onChange }: Props) {
  return (
    <div style={{
      height: 32, padding: "0 10px", display: "flex", alignItems: "center",
      background: "var(--panel-1)", borderBottom: "1px solid var(--border)",
    }}>
      <div style={{
        display: "inline-flex", background: "var(--border)",
        borderRadius: 6, padding: 2, gap: 2,
      }}>
        <SegButton icon={<Monitor size={12} />} label="Terminal"
          active={activity === "terminal"} onClick={() => onChange("terminal")} />
        <SegButton icon={<Folder size={12} />} label="Files"
          active={activity === "files"} onClick={() => onChange("files")} />
      </div>
    </div>
  );
}

function SegButton({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      padding: "4px 10px", borderRadius: 4, fontSize: 10,
      background: active ? "var(--accent)" : "transparent",
      color: active ? "var(--text-on-accent)" : "var(--text-2)",
      display: "flex", alignItems: "center", gap: 4,
      cursor: "pointer",
    }}>
      {icon}
      {label}
    </button>
  );
}
