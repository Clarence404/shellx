import { type ReactNode, useEffect, useState } from "react";
import { useSettingsStore } from "../../state/settings";
import { ADVANCED_RANGES, LOG_LEVEL_META } from "../../types/settings";
import type { AdvancedSettings } from "../../types/settings";
import { useT } from "../../i18n";

// Same three tiers Appearance uses, so both panels scale together with
// the System-font-size slider.
const FS_HEADING = "calc(var(--font-ui-size) + 2px)";
const FS_BODY    = "var(--font-ui-size)";
const FS_META    = "calc(var(--font-ui-size) - 2px)";
const CONTROL_WIDTH = 320;

export function AdvancedPanel() {
  const t = useT();
  const advanced = useSettingsStore((s) => s.advanced);
  const set = <K extends keyof AdvancedSettings>(key: K, value: AdvancedSettings[K]) =>
    useSettingsStore.getState().setAdvanced(key, value);

  const keepaliveOn = advanced.keepaliveIntervalSecs > 0;

  return (
    <div style={{ padding: "20px 24px", overflowY: "auto", color: "var(--text-1)", flex: 1 }}>
      <h3 style={{ fontSize: FS_HEADING, fontWeight: 500, margin: "0 0 6px" }}>{t("Advanced")}</h3>
      <div style={{ fontSize: FS_META, color: "var(--text-3)", marginBottom: 18 }}>
        {t("Applies to new connections and transfers · saved to settings.json")}
      </div>

      <SectionHeader>{t("SSH connection")}</SectionHeader>

      <TwoColField label={t("Connect timeout")}>
        <TunedSlider
          range={ADVANCED_RANGES.connectTimeoutSecs}
          value={advanced.connectTimeoutSecs}
          onChange={(n) => set("connectTimeoutSecs", n)}
          format={(n) => `${n}s`}
          aria-label="Connect timeout"
        />
      </TwoColField>

      <TwoColField
        label={t("Keepalive interval")}
        hint={keepaliveOn ? undefined : t("No keepalive probes are sent")}
      >
        <TunedSlider
          range={ADVANCED_RANGES.keepaliveIntervalSecs}
          step={10}
          value={advanced.keepaliveIntervalSecs}
          onChange={(n) => set("keepaliveIntervalSecs", n)}
          format={(n) => (n === 0 ? t("Off") : `${n}s`)}
          aria-label="Keepalive interval"
        />
      </TwoColField>

      {/* Only meaningful while probes are actually being sent. */}
      {keepaliveOn && (
        <TwoColField
          label={t("Keepalive limit")}
          hint={t("Unanswered probes before the transport is dropped")}
        >
          <TunedSlider
            range={ADVANCED_RANGES.keepaliveMax}
            value={advanced.keepaliveMax}
            onChange={(n) => set("keepaliveMax", n)}
            format={(n) => `${n}`}
            aria-label="Keepalive limit"
          />
        </TwoColField>
      )}

      <SectionHeader>{t("File transfers")}</SectionHeader>

      <TwoColField
        label={t("Concurrency")}
        hint={t("Transfers past the limit wait in the queue")}
      >
        <TunedSlider
          range={ADVANCED_RANGES.sftpConcurrency}
          value={advanced.sftpConcurrency}
          onChange={(n) => set("sftpConcurrency", n)}
          format={(n) => `${n}`}
          aria-label="SFTP concurrency"
        />
      </TwoColField>

      <SectionHeader>{t("Terminal")}</SectionHeader>

      <TwoColField label={t("Scrollback")} hint={t("Applies to terminals opened from now on")}>
        <NumberField
          range={ADVANCED_RANGES.terminalScrollback}
          value={advanced.terminalScrollback}
          onCommit={(n) => set("terminalScrollback", n)}
          suffix={t("lines")}
          aria-label="Scrollback lines"
        />
      </TwoColField>

      <SectionHeader>{t("Tunnel reconnect")}</SectionHeader>

      <TwoColField label={t("First retry after")} hint={t("Later attempts back off from here")}>
        <TunedSlider
          range={ADVANCED_RANGES.reconnectIntervalSecs}
          value={advanced.reconnectIntervalSecs}
          onChange={(n) => set("reconnectIntervalSecs", n)}
          format={(n) => `${n}s`}
          aria-label="First retry after"
        />
      </TwoColField>

      <TwoColField label={t("Retry limit")}>
        <TunedSlider
          range={ADVANCED_RANGES.reconnectMaxAttempts}
          value={advanced.reconnectMaxAttempts}
          onChange={(n) => set("reconnectMaxAttempts", n)}
          format={(n) => (n === 0 ? t("No limit") : `${n}`)}
          aria-label="Retry limit"
        />
      </TwoColField>

      <SectionHeader>{t("Diagnostics")}</SectionHeader>

      <TwoColField label={t("Log level")} hint={t("Takes effect after a restart")}>
        <Segmented
          options={LOG_LEVEL_META.map((l) => ({ id: l.id, label: t(l.label) }))}
          value={advanced.logLevel}
          onChange={(id) => set("logLevel", id as AdvancedSettings["logLevel"])}
        />
      </TwoColField>
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: FS_META, color: "var(--text-3)", textTransform: "uppercase",
      letterSpacing: "0.06em", margin: "18px 0 10px",
    }}>{children}</div>
  );
}

function TwoColField({ label, hint, children }: {
  label: string; hint?: string; children: ReactNode;
}) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "110px 1fr",
      alignItems: "center", gap: 16, marginBottom: 10,
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

/** Appearance's SizeSlider, minus the hardcoded "px" — these values are
 *  seconds, counts and lines, and one of them reads "Off" at zero. */
function TunedSlider({ range, step = 1, value, onChange, format, ...aria }: {
  range: readonly [number, number];
  step?: number;
  value: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
  "aria-label": string;
}) {
  const [min, max] = range;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      width: CONTROL_WIDTH, maxWidth: "100%",
    }}>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={aria["aria-label"]}
        style={{ flex: 1, accentColor: "var(--accent)" }}
      />
      <span style={{
        fontSize: FS_BODY, fontFamily: '"JetBrains Mono", var(--font-mono)',
        color: "var(--text-1)", minWidth: 56, textAlign: "right",
      }}>{format(value)}</span>
    </div>
  );
}

/** Free-typed number, committed on blur or Enter. A 500..50000 range is
 *  too wide for a slider to land on a round figure, and scrollback is a
 *  value people want to type exactly. */
function NumberField({ range, value, onCommit, suffix, ...aria }: {
  range: readonly [number, number];
  value: number;
  onCommit: (n: number) => void;
  suffix: string;
  "aria-label": string;
}) {
  const [min, max] = range;
  const [draft, setDraft] = useState(String(value));
  // Re-sync when the store changes underneath (Reset to defaults, or the
  // clamp rejecting what was typed).
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    onCommit(Math.max(min, Math.min(max, Math.round(n))));
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="number" min={min} max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        aria-label={aria["aria-label"]}
        style={{
          width: 110, padding: "5px 8px", fontSize: FS_BODY,
          background: "var(--panel-1)", color: "var(--text-1)",
          border: "1px solid var(--border)", borderRadius: 5,
          fontFamily: '"JetBrains Mono", var(--font-mono)',
        }}
      />
      <span style={{ fontSize: FS_META, color: "var(--text-3)" }}>{suffix}</span>
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
