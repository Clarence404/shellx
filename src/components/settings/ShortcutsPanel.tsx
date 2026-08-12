import { useT } from "../../i18n";

// Read-only reference of the app's fixed shortcuts. When configurable
// keybindings land, this panel becomes the editing surface.
const SHORTCUTS: Array<{ action: string; keys: string[] }> = [
  { action: "New tab", keys: ["Ctrl", "Shift", "T"] },
  { action: "Close tab", keys: ["Ctrl", "Shift", "W"] },
  { action: "Next tab", keys: ["Ctrl", "Tab"] },
  { action: "Previous tab", keys: ["Ctrl", "Shift", "Tab"] },
  { action: "Command palette", keys: ["Ctrl", "K"] },
  { action: "Toggle sidebar", keys: ["Ctrl", "Shift", "B"] },
  { action: "Search in terminal", keys: ["Ctrl", "Shift", "F"] },
];

const kbdStyle: React.CSSProperties = {
  padding: "2px 7px", borderRadius: 4, fontSize: 11,
  background: "var(--panel-1)", border: "1px solid var(--border)",
  color: "var(--text-1)", fontFamily: "var(--font-mono)",
};

export function ShortcutsPanel() {
  const t = useT();
  return (
    <div style={{ flex: 1, minHeight: 0, padding: "20px 24px", overflowY: "auto", color: "var(--text-1)" }}>
      <h3 style={{ fontSize: "calc(var(--font-ui-size) + 2px)", fontWeight: 500, margin: "0 0 6px" }}>
        {t("Keyboard shortcuts")}
      </h3>
      <div style={{ fontSize: "calc(var(--font-ui-size) - 2px)", color: "var(--text-3)", marginBottom: 18 }}>
        {t("Shortcuts are fixed in this version — customization is planned.")}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", maxWidth: 520 }}>
        {SHORTCUTS.map((s, i) => (
          <div key={s.action} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "9px 14px",
            borderBottom: i < SHORTCUTS.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <span style={{ fontSize: "var(--font-ui-size)", color: "var(--text-1)" }}>{t(s.action)}</span>
            <span style={{ display: "flex", gap: 4 }}>
              {s.keys.map((k) => <kbd key={k} style={kbdStyle}>{k}</kbd>)}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: "calc(var(--font-ui-size) - 2px)", color: "var(--text-3)", marginTop: 12 }}>
        {t("On macOS, Cmd+T / Cmd+W also work for tabs.")}
      </div>
    </div>
  );
}
