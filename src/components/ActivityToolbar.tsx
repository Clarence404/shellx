import { Monitor, Folder, Network } from "lucide-react";
import type { ActivityKind } from "../types/connection";
import { useT } from "../i18n";

const ACTIVITY_ICONS: Record<ActivityKind, React.ReactNode> = {
  terminal: <Monitor size={12} />,
  files: <Folder size={12} />,
  tunnel: <Network size={12} />,
};

const DEFAULT_TABS: { id: ActivityKind; label: string }[] = [
  { id: "terminal", label: "Terminal" },
  { id: "files", label: "Files" },
];

interface Props {
  activity: ActivityKind;
  onChange: (a: ActivityKind) => void;
  tabs?: { id: ActivityKind; label: string }[];
}

export function ActivityToolbar({ activity, onChange, tabs = DEFAULT_TABS }: Props) {
  const t = useT();
  return (
    <div style={{
      height: 32, padding: "0 10px", display: "flex", alignItems: "center",
      background: "var(--panel-1)", borderBottom: "1px solid var(--border)",
    }}>
      <div style={{
        display: "inline-flex", background: "var(--border)",
        borderRadius: 6, padding: 2, gap: 2,
      }}>
        {tabs.map((tab) => (
          <SegButton
            key={tab.id}
            icon={ACTIVITY_ICONS[tab.id]}
            label={t(tab.label)}
            active={activity === tab.id}
            onClick={() => onChange(tab.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SegButton({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      padding: "4px 10px", borderRadius: 4, fontSize: "var(--font-ui-size)",
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
