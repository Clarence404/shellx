import { Palette, Info, Wrench, type LucideIcon } from "lucide-react";
import { useSettingsStore, useIconSizes } from "../../state/settings";

type Section = "appearance" | "about";

interface Props {
  active: Section;
  onSelect: (s: Section) => void;
}

export function SettingsSidebar({ active, onSelect }: Props) {
  const iconSizes = useIconSizes();
  const reset = () => useSettingsStore.getState().reset();

  function Row({ id, label, Icon, dim, onClick }: {
    id: string; label: string; Icon: LucideIcon; dim?: boolean; onClick?: () => void;
  }) {
    return (
      <div
        role="option"
        aria-selected={active === id}
        onClick={dim ? undefined : onClick}
        title={dim ? "Coming in v0.6" : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px", margin: "0 4px", borderRadius: 4,
          fontSize: "var(--font-ui-size)", color: dim ? "var(--text-3)" : "var(--text-1)",
          background: active === id ? "var(--border)" : "transparent",
          cursor: dim ? "not-allowed" : "pointer",
          opacity: dim ? 0.4 : 1,
        }}
      >
        <Icon size={iconSizes.md} strokeWidth={1.8} />{label}
      </div>
    );
  }

  return (
    <div style={{
      width: 150, background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", padding: "12px 0",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        fontSize: 10, letterSpacing: 1, color: "var(--text-3)",
        textTransform: "uppercase", padding: "0 12px", marginBottom: 8,
      }}>Settings</div>
      <Row id="appearance" label="Appearance" Icon={Palette}
        onClick={() => onSelect("appearance")} />
      <Row id="about" label="About" Icon={Info}
        onClick={() => onSelect("about")} />
      <Row id="advanced" label="Advanced" Icon={Wrench} dim />
      <div style={{ flex: 1 }} />
      <button
        onClick={() => {
          if (confirm("Reset all settings to defaults?")) reset();
        }}
        style={{
          margin: 4, padding: "6px 8px",
          background: "transparent", color: "var(--text-2)",
          border: "1px solid var(--border-hi)", borderRadius: 5,
          fontSize: "var(--font-ui-size)", cursor: "pointer",
        }}
      >Reset to defaults</button>
    </div>
  );
}
