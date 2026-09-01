import { Palette, Info, Wrench, Shield, Keyboard, FileText, PackageOpen, type LucideIcon } from "lucide-react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { useSettingsStore, useIconSizes } from "../../state/settings";
import { useUpdater } from "../../state/updater";
import { SectionHeader } from "../SectionHeader";
import { useT } from "../../i18n";

type Section = "appearance" | "shortcuts" | "about" | "trusted-servers" | "logs" | "advanced" | "backup";

interface Props {
  active: Section;
  onSelect: (s: Section) => void;
}

export function SettingsSidebar({ active, onSelect }: Props) {
  const t = useT();
  const iconSizes = useIconSizes();
  const reset = () => useSettingsStore.getState().reset();
  const updateAvailable = useUpdater((s) => s.status === "available");

  function Row({ id, label, Icon, onClick, showDot }: {
    id: string; label: string; Icon: LucideIcon; onClick?: () => void;
    /** Same red dot the rail's gear carries — it has to keep pointing
     *  the way once the user is inside Settings, or the trail goes
     *  cold at the sidebar. */
    showDot?: boolean;
  }) {
    return (
      <div
        role="option"
        aria-selected={active === id}
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px", margin: "0 4px", borderRadius: 4,
          fontSize: "var(--font-ui-size)", color: "var(--text-1)",
          background: active === id ? "var(--border)" : "transparent",
          cursor: "pointer",
        }}
      >
        <Icon size={iconSizes.md} strokeWidth={1.8} style={{ flexShrink: 0 }} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {showDot && (
          <span data-testid="update-dot" style={{
            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            marginLeft: "auto", background: "var(--error)",
          }} />
        )}
      </div>
    );
  }

  return (
    <div style={{
      width: 172, background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", padding: "12px 8px",
      display: "flex", flexDirection: "column",
    }}>
      <SectionHeader label={t("Settings")} />
      <Row id="appearance" label={t("Appearance")} Icon={Palette}
        onClick={() => onSelect("appearance")} />
      <Row id="shortcuts" label={t("Shortcuts")} Icon={Keyboard}
        onClick={() => onSelect("shortcuts")} />
      <Row id="trusted-servers" label={t("Known hosts")} Icon={Shield}
        onClick={() => onSelect("trusted-servers")} />
      <Row id="logs" label={t("Logs")} Icon={FileText}
        onClick={() => onSelect("logs")} />
      <Row id="advanced" label={t("Advanced")} Icon={Wrench}
        onClick={() => onSelect("advanced")} />
      <Row id="backup" label={t("Import & export")} Icon={PackageOpen}
        onClick={() => onSelect("backup")} />
      <Row id="about" label={t("About")} Icon={Info} showDot={updateAvailable}
        onClick={() => onSelect("about")} />
      <div style={{ flex: 1 }} />
      <button
        onClick={() => {
          // window.confirm is async here (dialog plugin shim) — unawaited
          // it is always truthy and the reset fired unconditionally.
          void confirmDialog(t("Reset all settings to defaults?")).then((ok) => {
            if (ok) reset();
          });
        }}
        style={{
          margin: 4, padding: "6px 8px",
          background: "transparent", color: "var(--text-2)",
          border: "1px solid var(--border-hi)", borderRadius: 5,
          fontSize: "var(--font-ui-size)", cursor: "pointer",
        }}
      >{t("Reset to defaults")}</button>
    </div>
  );
}
