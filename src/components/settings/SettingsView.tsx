import { useState } from "react";
import { SettingsSidebar } from "./SettingsSidebar";
import { AppearancePanel } from "./AppearancePanel";
import { AboutPanel } from "./AboutPanel";
import { TrustedServersPanel } from "./TrustedServersPanel";

type Section = "appearance" | "about" | "trusted-servers";

export function SettingsView() {
  const [section, setSection] = useState<Section>("appearance");
  return (
    <div data-testid="settings-view"
      style={{ height: "100%", display: "flex", background: "var(--panel-2)" }}>
      <SettingsSidebar active={section} onSelect={setSection} />
      {section === "appearance" && <AppearancePanel />}
      {section === "about" && <AboutPanel />}
      {section === "trusted-servers" && <TrustedServersPanel />}
    </div>
  );
}
