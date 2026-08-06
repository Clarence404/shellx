import type { ReactNode } from "react";
import { useSettingsStore } from "../../state/settings";
import {
  THEME_META, DENSITY_META, FONT_MAP, SYSTEM_FONT_META,
  SYSTEM_FONT_SIZE_MIN, SYSTEM_FONT_SIZE_MAX,
} from "../../types/settings";
import type { Settings } from "../../types/settings";

// v0.5.4: every visible text size in this panel is derived from
// var(--font-ui-size) so the System-font-size slider scales the whole
// Appearance surface coherently. Three tiers relative to the base:
const FS_HEADING = "calc(var(--font-ui-size) + 2px)";  // h3
const FS_BODY    = "var(--font-ui-size)";              // labels, controls
const FS_META    = "calc(var(--font-ui-size) - 2px)";  // hints, section markers, subtitle

export function AppearancePanel() {
  const themeId = useSettingsStore((s) => s.themeId);
  const density = useSettingsStore((s) => s.density);
  const systemFont = useSettingsStore((s) => s.systemFont);
  const systemFontSize = useSettingsStore((s) => s.systemFontSize);
  const terminal = useSettingsStore((s) => s.terminal);

  const setTheme = (id: Settings["themeId"]) => useSettingsStore.getState().setTheme(id);
  const setDensity = (id: Settings["density"]) => useSettingsStore.getState().setDensity(id);
  const setSystemFont = (id: Settings["systemFont"]) =>
    useSettingsStore.getState().setSystemFont(id);
  const setSystemFontSize = (n: number) => useSettingsStore.getState().setSystemFontSize(n);
  const setFontFamily = (id: Settings["terminal"]["fontFamily"]) =>
    useSettingsStore.getState().setTerminalFontFamily(id);
  const setFontSize = (n: number) => useSettingsStore.getState().setTerminalFontSize(n);
  const setCursorStyle = (s: Settings["terminal"]["cursorStyle"]) =>
    useSettingsStore.getState().setTerminalCursorStyle(s);

  return (
    <div style={{ padding: "20px 24px", overflowY: "auto", color: "var(--text-1)", flex: 1 }}>
      <h3 style={{ fontSize: FS_HEADING, fontWeight: 500, margin: "0 0 6px" }}>Appearance</h3>
      <div style={{ fontSize: FS_META, color: "var(--text-3)", marginBottom: 20 }}>
        Changes apply live · saved to settings.json in your config directory
      </div>

      <SectionHeader>Interface</SectionHeader>

      <Field label="Theme">
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 10, maxWidth: 620,
        }}>
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
              <div style={{ fontSize: FS_BODY, color: "var(--text-1)" }}>{t.label}</div>
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

      <Field
        label="System font"
        hint="Controls sans UI — tabs, buttons, section headers."
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <select
            value={systemFont}
            onChange={(e) => setSystemFont(e.target.value as Settings["systemFont"])}
            aria-label="System font"
            style={{
              padding: "6px 10px", fontSize: FS_BODY, color: "var(--text-1)",
              background: "var(--panel-1)", border: "1px solid var(--border)",
              borderRadius: 5, minWidth: 180,
            }}
          >
            {SYSTEM_FONT_META.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <SizeSlider
            aria-label="System font size"
            min={SYSTEM_FONT_SIZE_MIN} max={SYSTEM_FONT_SIZE_MAX}
            value={systemFontSize}
            onChange={setSystemFontSize}
          />
        </div>
      </Field>

      <SectionHeader>Terminal</SectionHeader>

      <Field label="Terminal font">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <select
            value={terminal.fontFamily}
            onChange={(e) => setFontFamily(e.target.value as Settings["terminal"]["fontFamily"])}
            aria-label="Terminal font"
            style={{
              padding: "6px 10px", fontSize: FS_BODY, color: "var(--text-1)",
              background: "var(--panel-1)", border: "1px solid var(--border)",
              borderRadius: 5, minWidth: 180,
              fontFamily: '"JetBrains Mono", var(--font-mono)',
            }}
          >
            {(Object.keys(FONT_MAP) as Array<Settings["terminal"]["fontFamily"]>).map((k) => (
              <option key={k} value={k}>{humanFont(k)}</option>
            ))}
          </select>
          <SizeSlider
            aria-label="Terminal font size"
            min={10} max={20}
            value={terminal.fontSize}
            onChange={setFontSize}
          />
        </div>
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

      <Field label="Preview" hint="Live sample using the selected font, size, and cursor style.">
        <TerminalPreview
          fontFamily={terminal.fontFamily}
          fontSize={terminal.fontSize}
          cursorStyle={terminal.cursorStyle}
        />
      </Field>
    </div>
  );
}

// Mini terminal mock — kept intentionally static (no xterm, no PTY) so it
// costs nothing to render and can't leak resources. Colours match the
// TerminalView theme (`#1e1c24` bg / muted-sage green prompt / cyan path /
// pastel text) so what you see here is what you get in the real tab.
function TerminalPreview({
  fontFamily, fontSize, cursorStyle,
}: {
  fontFamily: Settings["terminal"]["fontFamily"];
  fontSize: number;
  cursorStyle: Settings["terminal"]["cursorStyle"];
}) {
  const cursorStyleMap: Record<Settings["terminal"]["cursorStyle"], {
    width: string; height: string; verticalAlign: string; borderBottom?: string;
    background: string;
  }> = {
    block: {
      width: "0.55em", height: "1em", verticalAlign: "text-bottom",
      background: "#7c5cff",
    },
    underline: {
      width: "0.55em", height: "0.12em", verticalAlign: "baseline",
      background: "#7c5cff",
    },
    bar: {
      width: "0.14em", height: "1em", verticalAlign: "text-bottom",
      background: "#7c5cff",
    },
  };
  return (
    <div style={{
      background: "#1e1c24", borderRadius: 4,
      padding: "10px 12px",
      fontFamily: FONT_MAP[fontFamily],
      fontSize, lineHeight: 1.4,
      color: "#d4d0dc",
      maxWidth: 460,
      border: "0.5px solid var(--border)",
      overflow: "hidden",
    }}>
      <div>
        <span style={{ color: "#7c9c80" }}>root@host</span>
        <span style={{ color: "#8b869a" }}>:</span>
        <span style={{ color: "#58d3fc" }}>~</span>
        <span style={{ color: "#d4d0dc" }}>$ </span>
        <span style={{ color: "#d4d0dc" }}>echo hi | grep hi</span>
      </div>
      <div>
        <span style={{ color: "#d4d0dc" }}>hi</span>
      </div>
      <div>
        <span style={{ color: "#7c9c80" }}>root@host</span>
        <span style={{ color: "#8b869a" }}>:</span>
        <span style={{ color: "#58d3fc" }}>~</span>
        <span style={{ color: "#d4d0dc" }}>$ </span>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            ...cursorStyleMap[cursorStyle],
          }}
        />
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: FS_META, textTransform: "uppercase", letterSpacing: 1.2,
      color: "var(--text-3)", fontWeight: 500,
      marginTop: 4, marginBottom: 12, paddingBottom: 6,
      borderBottom: "1px solid var(--border)",
    }}>{children}</div>
  );
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: FS_BODY, color: "var(--text-2)", marginBottom: 8 }}>{label}</div>
      {children}
      {hint && (
        <div style={{ fontSize: FS_META, color: "var(--text-3)", marginTop: 6 }}>{hint}</div>
      )}
    </div>
  );
}

function SizeSlider({ min, max, value, onChange, ...aria }: {
  min: number; max: number; value: number;
  onChange: (n: number) => void;
  "aria-label": string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, maxWidth: 260 }}>
      <input
        type="range" min={min} max={max} step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={aria["aria-label"]}
        style={{ flex: 1, accentColor: "var(--accent)" }}
      />
      <span style={{
        fontSize: FS_BODY, fontFamily: '"JetBrains Mono", var(--font-mono)',
        color: "var(--text-1)", minWidth: 42, textAlign: "right",
      }}>{value}px</span>
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
            padding: "5px 12px", fontSize: FS_BODY, borderRadius: 3,
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
