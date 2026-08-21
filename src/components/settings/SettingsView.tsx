import { useState } from "react";
import { SettingsSidebar } from "./SettingsSidebar";
import { AppearancePanel } from "./AppearancePanel";
import { AboutPanel } from "./AboutPanel";
import { TrustedServersPanel } from "./TrustedServersPanel";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { LogsPanel } from "./LogsPanel";
import { AdvancedPanel } from "./AdvancedPanel";

type Section = "appearance" | "shortcuts" | "about" | "trusted-servers" | "logs" | "advanced";

export function SettingsView() {
  const [section, setSection] = useState<Section>("appearance");
  return (
    <div data-testid="settings-view"
      style={{ height: "100%", display: "flex", background: "var(--panel-2)" }}>
      <SettingsSidebar active={section} onSelect={setSection} />
      {section === "appearance" && <AppearancePanel />}
      {section === "shortcuts" && <ShortcutsPanel />}
      {section === "about" && <AboutPanel />}
      {section === "trusted-servers" && <TrustedServersPanel />}
      {section === "logs" && <LogsPanel />}
      {section === "advanced" && <AdvancedPanel />}
    </div>
  );
}
