import type { ReactNode } from "react";
import { useSettingsStore } from "../../state/settings";
import { THEME_META, DENSITY_META, FONT_MAP } from "../../types/settings";
import type { Settings } from "../../types/settings";

export function AppearancePanel() {
  const themeId = useSettingsStore((s) => s.themeId);
  const density = useSettingsStore((s) => s.density);
  const terminal = useSettingsStore((s) => s.terminal);

  const setTheme = (id: Settings["themeId"]) => useSettingsStore.getState().setTheme(id);
  const setDensity = (id: Settings["density"]) => useSettingsStore.getState().setDensity(id);
  const setFontFamily = (id: Settings["terminal"]["fontFamily"]) =>
    useSettingsStore.getState().setTerminalFontFamily(id);
  const setFontSize = (n: number) => useSettingsStore.getState().setTerminalFontSize(n);
  const setCursorStyle = (s: Settings["terminal"]["cursorStyle"]) =>
    useSettingsStore.getState().setTerminalCursorStyle(s);

  return (
    <div style={{ padding: "20px 24px", overflowY: "auto", color: "var(--text-1)", flex: 1 }}>
      <h3 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 6px" }}>Appearance</h3>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 20 }}>
        Changes apply live · saved to settings.json in your config directory
      </div>

      <Field label="Theme">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(120px, 1fr))", gap: 10, maxWidth: 460 }}>
          {THEME_META.map((t) => (
            <div
              key={t.id}
              role="button"
              aria-pressed={themeId === t.id}
              onClick={() => setTheme(t.id)}
              style={{
                padding: "10px 8px", cursor: "pointer",
                border: themeId === t.id
                  ? "1px solid var(--accent)" : "1px solid var(--border)",
                boxShadow: themeId === t.id
                  ? "0 0 0 2px var(--accent-fade)" : undefined,
                borderRadius: 6, background: "var(--panel-1)",
              }}
            >
              <div style={{ display: "flex", gap: 3, marginBottom: 8, height: 12 }}>
                {t.swatch.map((c, i) => (
                  <span key={i} style={{ flex: 1, borderRadius: 2, background: c }} />
                ))}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-1)" }}>{t.label}</div>
            </div>
          ))}
        </div>
      </Field>

      <Field label="Density">
        <Segmented
          options={DENSITY_META.map((d) => ({ id: d.id, label: d.label }))}
          value={density}
          onChange={(id) => setDensity(id as Settings["density"])}
        />
      </Field>

      <Field label="Terminal font">
        <select
          value={terminal.fontFamily}
          onChange={(e) => setFontFamily(e.target.value as Settings["terminal"]["fontFamily"])}
          style={{
            padding: "6px 10px", fontSize: 11, color: "var(--text-1)",
            background: "var(--panel-1)", border: "1px solid var(--border)",
            borderRadius: 5, fontFamily: '"JetBrains Mono", var(--font-mono)',
          }}
        >
          {(Object.keys(FONT_MAP) as Array<Settings["terminal"]["fontFamily"]>).map((k) => (
            <option key={k} value={k}>{humanFont(k)}</option>
          ))}
        </select>
      </Field>

      <Field label="Terminal font size">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="range" min={10} max={20} step={1}
            value={terminal.fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            style={{ flex: 1, maxWidth: 240, accentColor: "var(--accent)" }}
          />
          <span style={{
            fontSize: 11, fontFamily: '"JetBrains Mono", var(--font-mono)',
            color: "var(--text-1)", width: 24, textAlign: "right",
          }}>{terminal.fontSize}</span>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>10 – 20 px</div>
      </Field>

      <Field label="Cursor style">
        <Segmented
          options={[
            { id: "block", label: "Block" },
            { id: "underline", label: "Underline" },
            { id: "bar", label: "Bar" },
          ]}
          value={terminal.cursorStyle}
          onChange={(id) => setCursorStyle(id as Settings["terminal"]["cursorStyle"])}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange }: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{
      display: "inline-flex", background: "var(--panel-1)",
      border: "1px solid var(--border)", borderRadius: 5, padding: 2,
    }}>
      {options.map((o) => (
        <button
          key={o.id}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: "5px 12px", fontSize: 11, borderRadius: 3,
            background: value === o.id ? "var(--accent)" : "transparent",
            color: value === o.id ? "var(--text-on-accent)" : "var(--text-2)",
            cursor: "pointer", border: "none",
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}

function humanFont(id: Settings["terminal"]["fontFamily"]): string {
  return {
    "jetbrains-mono": "JetBrains Mono", "sf-mono": "SF Mono",
    "fira-code": "Fira Code", "cascadia-code": "Cascadia Code",
    "consolas": "Consolas",
  }[id];
}
