import { type ReactNode, useEffect, useState } from "react";
import { Folder, File as FileIcon, FileCode, FileJson } from "lucide-react";
import { useSettingsStore } from "../../state/settings";
import { listAvailableShells, type ShellOption } from "../../ipc/local_pty";
import {
  THEME_META, DENSITY_META, FONT_MAP, SYSTEM_FONT_META, LANGUAGE_META,
  SYSTEM_FONT_SIZE_MIN, SYSTEM_FONT_SIZE_MAX,
  FILES_FONT_SIZE_MIN, FILES_FONT_SIZE_MAX,
} from "../../types/settings";
import type { Settings } from "../../types/settings";
import { useT } from "../../i18n";

// v0.5.4: every visible text size in this panel is derived from
// var(--font-ui-size) so the System-font-size slider scales the whole
// Appearance surface coherently. Three tiers relative to the base:
const FS_HEADING = "calc(var(--font-ui-size) + 2px)";  // h3
const FS_BODY    = "var(--font-ui-size)";              // labels, controls
const FS_META    = "calc(var(--font-ui-size) - 2px)";  // hints, section markers, subtitle

export function AppearancePanel() {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const themeId = useSettingsStore((s) => s.themeId);
  const density = useSettingsStore((s) => s.density);
  const systemFont = useSettingsStore((s) => s.systemFont);
  const systemFontSize = useSettingsStore((s) => s.systemFontSize);
  const filesFontSize = useSettingsStore((s) => s.filesFontSize);
  const terminal = useSettingsStore((s) => s.terminal);
  const localShell = useSettingsStore((s) => s.localShell);

  const setTheme = (id: Settings["themeId"]) => useSettingsStore.getState().setTheme(id);
  const setDensity = (id: Settings["density"]) => useSettingsStore.getState().setDensity(id);
  const setSystemFont = (id: Settings["systemFont"]) =>
    useSettingsStore.getState().setSystemFont(id);
  const setSystemFontSize = (n: number) => useSettingsStore.getState().setSystemFontSize(n);
  const setFilesFontSize = (n: number) => useSettingsStore.getState().setFilesFontSize(n);
  const setFontFamily = (id: Settings["terminal"]["fontFamily"]) =>
    useSettingsStore.getState().setTerminalFontFamily(id);
  const setFontSize = (n: number) => useSettingsStore.getState().setTerminalFontSize(n);
  const setCursorStyle = (s: Settings["terminal"]["cursorStyle"]) =>
    useSettingsStore.getState().setTerminalCursorStyle(s);
  const setLocalShell = (v: string) => useSettingsStore.getState().setLocalShell(v);
  const setLanguage = (v: Settings["language"]) => useSettingsStore.getState().setLanguage(v);

  return (
    <div style={{ padding: "20px 24px", overflowY: "auto", color: "var(--text-1)", flex: 1 }}>
      <h3 style={{ fontSize: FS_HEADING, fontWeight: 500, margin: "0 0 6px" }}>{t("Appearance")}</h3>
      <div style={{ fontSize: FS_META, color: "var(--text-3)", marginBottom: 18 }}>
        {t("Changes apply live · saved to settings.json in your config directory")}
      </div>

      <SectionHeader>{t("Language")}</SectionHeader>

      <TwoColField label={t("UI language")}>
        <Segmented
          options={LANGUAGE_META.map((l) => ({ id: l.id, label: l.label }))}
          value={language}
          onChange={(id) => setLanguage(id as Settings["language"])}
        />
      </TwoColField>

      <SectionHeader>{t("Interface")}</SectionHeader>

      <TwoColField label={t("Theme")}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
          gap: 8, maxWidth: 420,
        }}>
          {THEME_META.map((th) => (
            <div
              key={th.id}
              role="button"
              aria-pressed={themeId === th.id}
              onClick={() => setTheme(th.id)}
              style={{
                padding: "8px 8px", cursor: "pointer",
                border: themeId === th.id
                  ? "1px solid var(--accent)" : "1px solid var(--border)",
                boxShadow: themeId === th.id
                  ? "0 0 0 2px var(--accent-fade)" : undefined,
                borderRadius: 5, background: "var(--panel-1)",
              }}
            >
              <div style={{ display: "flex", gap: 3, marginBottom: 6, height: 10 }}>
                {th.swatch.map((c, i) => (
                  <span key={i} style={{ flex: 1, borderRadius: 2, background: c }} />
                ))}
              </div>
              <div style={{ fontSize: FS_META, color: "var(--text-1)", textAlign: "center" }}>{t(th.label)}</div>
            </div>
          ))}
        </div>
      </TwoColField>

      <TwoColField label={t("Density")}>
        <Segmented
          options={DENSITY_META.map((d) => ({ id: d.id, label: t(d.label) }))}
          value={density}
          onChange={(id) => setDensity(id as Settings["density"])}
        />
      </TwoColField>

      <SectionHeader>{t("System font")}</SectionHeader>

      <TwoColField
        label={t("Family")}
        hint={t("Sans UI — tabs, buttons, section headers.")}
      >
        <select
          value={systemFont}
          onChange={(e) => setSystemFont(e.target.value as Settings["systemFont"])}
          aria-label="System font"
          style={{
            padding: "5px 10px", fontSize: FS_BODY, color: "var(--text-1)",
            background: "var(--panel-1)", border: "1px solid var(--border)",
            borderRadius: 5, width: 320, maxWidth: "100%",
          }}
        >
          {SYSTEM_FONT_META.map((f) => (
            <option key={f.id} value={f.id}>{t(f.label)}</option>
          ))}
        </select>
      </TwoColField>

      <TwoColField label={t("Size")}>
        <SizeSlider
          aria-label="System font size"
          min={SYSTEM_FONT_SIZE_MIN} max={SYSTEM_FONT_SIZE_MAX}
          value={systemFontSize}
          onChange={setSystemFontSize}
        />
      </TwoColField>

      <SectionHeader>{t("Files")}</SectionHeader>

      <TwoColField
        label={t("Size")}
        hint={t("Filename + meta text in the Files panes. Independent of System font.")}
      >
        <SizeSlider
          aria-label="Files font size"
          min={FILES_FONT_SIZE_MIN} max={FILES_FONT_SIZE_MAX}
          value={filesFontSize}
          onChange={setFilesFontSize}
        />
      </TwoColField>

      <TwoColField label={t("Preview")}>
        <FilesPreview fontSize={filesFontSize} />
      </TwoColField>

      <SectionHeader>{t("Terminal")}</SectionHeader>

      <TwoColField label={t("Family")}>
        <select
          value={terminal.fontFamily}
          onChange={(e) => setFontFamily(e.target.value as Settings["terminal"]["fontFamily"])}
          aria-label="Terminal font"
          style={{
            padding: "5px 10px", fontSize: FS_BODY, color: "var(--text-1)",
            background: "var(--panel-1)", border: "1px solid var(--border)",
            borderRadius: 5, width: 320, maxWidth: "100%",
            fontFamily: '"JetBrains Mono", var(--font-mono)',
          }}
        >
          {(Object.keys(FONT_MAP) as Array<Settings["terminal"]["fontFamily"]>).map((k) => (
            <option key={k} value={k}>{humanFont(k)}</option>
          ))}
        </select>
      </TwoColField>

      <TwoColField label={t("Size")}>
        <SizeSlider
          aria-label="Terminal font size"
          min={10} max={20}
          value={terminal.fontSize}
          onChange={setFontSize}
        />
      </TwoColField>

      <TwoColField label={t("Cursor")}>
        <Segmented
          options={[
            { id: "block", label: t("Block") },
            { id: "underline", label: t("Underline") },
            { id: "bar", label: t("Bar") },
          ]}
          value={terminal.cursorStyle}
          onChange={(id) => setCursorStyle(id as Settings["terminal"]["cursorStyle"])}
        />
      </TwoColField>

      <TwoColField label={t("Preview")}>
        <TerminalPreview
          fontFamily={terminal.fontFamily}
          fontSize={terminal.fontSize}
          cursorStyle={terminal.cursorStyle}
        />
      </TwoColField>

      <SectionHeader>{t("Local terminal")}</SectionHeader>

      <TwoColField label={t("Shell")}>
        <LocalShellPicker value={localShell} onChange={setLocalShell} />
      </TwoColField>
    </div>
  );
}

const CUSTOM_OPTION: ShellOption = { label: "Custom path…", value: "__custom__" };

function LocalShellPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const [presets, setPresets] = useState<ShellOption[]>([]);

  useEffect(() => {
    listAvailableShells().then((shells) => {
      setPresets([{ label: "Default (system shell)", value: "" }, ...shells, CUSTOM_OPTION]);
    });
  }, []);

  const isPreset = presets.some((p) => p.value === value);
  const selectValue = isPreset ? value : (presets.length > 0 ? "__custom__" : "");
  const isCustom = selectValue === "__custom__";

  const inputStyle = {
    width: "100%", padding: "4px 8px",
    background: "var(--panel-3, var(--panel-2))",
    border: "0.5px solid var(--border)",
    borderRadius: 4, color: "var(--text-1)",
    fontSize: "var(--font-ui-size)",
    fontFamily: "var(--font-ui)",
  } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <select
        value={selectValue}
        onChange={(e) => {
          if (e.target.value !== "__custom__") onChange(e.target.value);
          else onChange(value && !isPreset ? value : "");
        }}
        style={{ ...inputStyle, cursor: "pointer", appearance: "auto" }}
        disabled={presets.length === 0}
      >
        {presets.map((p) => (
          <option key={p.value} value={p.value}>{t(p.label)}</option>
        ))}
      </select>
      {isCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/usr/bin/zsh or C:\path\to\shell.exe"
          style={inputStyle}
        />
      )}
      <div style={{ fontSize: FS_META, color: "var(--text-3)" }}>
        {isCustom
          ? t("Enter the full path to your shell executable.")
          : t("Applies to all new local terminal tabs.")}
      </div>
    </div>
  );
}

// Mini file list mock — mirrors FileRow's layout (icon + monospace name +
// right-aligned size) so what you see here is what you get in the panes.
// Static rows, no store reads — the fontSize prop tracks the slider live.
function FilesPreview({ fontSize }: { fontSize: number }) {
  const rows: Array<{ name: string; Icon: typeof Folder; color: string; size: string | null }> = [
    { name: "documents",  Icon: Folder,   color: "var(--text-2)", size: null },
    { name: "server.log", Icon: FileIcon, color: "var(--text-3)", size: "128 KB" },
    { name: "config.json", Icon: FileJson, color: "#a6e3a1", size: "4.2 KB" },
    { name: "main.rs",    Icon: FileCode, color: "#f2c8a2", size: "9.8 KB" },
  ];
  return (
    <div style={{
      background: "var(--panel-1)", borderRadius: 4,
      border: "0.5px solid var(--border)",
      padding: "4px 0", maxWidth: 460, overflow: "hidden",
    }}>
      {rows.map((r) => (
        <div key={r.name} style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "5px 12px", fontSize,
          fontFamily: '"JetBrains Mono", var(--font-mono)',
          color: "var(--text-1)",
        }}>
          <r.Icon size={fontSize + 2} color={r.color} />
          <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {r.name}
          </span>
          {r.size && (
            <span style={{
              color: "var(--text-3)",
              fontSize: Math.max(9, fontSize - 3),
              minWidth: 56, textAlign: "right",
            }}>{r.size}</span>
          )}
        </div>
      ))}
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
      fontSize: FS_BODY, textTransform: "uppercase", letterSpacing: 1.4,
      color: "var(--text-1)", fontWeight: 600,
      marginTop: 20, marginBottom: 12, paddingBottom: 6,
      borderBottom: "1px solid var(--border-hi)",
    }}>{children}</div>
  );
}

// Two-column row: fixed-width left label, control on the right. Keeps
// everything aligned in a tidy grid instead of the old stacked layout
// where each Field's label sat above its control on its own line —
// which made the panel feel long and jumpy.
function TwoColField({ label, hint, children }: {
  label: string; hint?: string; children: ReactNode;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "110px 1fr",
      alignItems: "center",
      gap: 16, marginBottom: 10,
    }}>
      <div style={{ fontSize: FS_BODY, color: "var(--text-2)" }}>{label}</div>
      <div>
        {children}
        {hint && (
          <div style={{ fontSize: FS_META, color: "var(--text-3)", marginTop: 4 }}>{hint}</div>
        )}
      </div>
    </div>
  );
}

// Every inline control (select, slider, segmented) uses this width so
// their right edges line up across the panel. Previews are wider by design.
const CONTROL_WIDTH = 320;

function SizeSlider({ min, max, value, onChange, ...aria }: {
  min: number; max: number; value: number;
  onChange: (n: number) => void;
  "aria-label": string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      width: CONTROL_WIDTH, maxWidth: "100%",
    }}>
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
            padding: "4px 12px", fontSize: FS_BODY, borderRadius: 3,
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
