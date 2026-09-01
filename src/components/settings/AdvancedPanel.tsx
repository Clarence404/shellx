import { type ReactNode, useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import { useSettingsStore } from "../../state/settings";
import { historyClear } from "../../ipc/history";
import { ADVANCED_RANGES, LOG_LEVEL_META } from "../../types/settings";
import type { AdvancedSettings } from "../../types/settings";
import { useT } from "../../i18n";

// Same three tiers Appearance uses, so both panels scale together with
// the System-font-size slider.
const FS_BODY = "var(--font-ui-size)";
const FS_META = "calc(var(--font-ui-size) - 2px)";
const FS_HEADING = "calc(var(--font-ui-size) + 2px)";

// The rows are label-left / control-right, so they need a ceiling: across
// a maximised window a full-width row would park the control a hand-span
// away from the label it belongs to.
const LIST_WIDTH = 560;

/** Preset stops offered per field. Every value sits inside the field's
 *  range in ADVANCED_RANGES; a stored value that isn't a preset (hand-
 *  edited settings.json) gets its own stop appended at render time rather
 *  than leaving the row with nothing selected. */
const KEEPALIVE_STOPS = [0, 30, 60, 120, 300];
const CONCURRENCY_STOPS = [1, 2, 4, 8, 16];
const RETRY_DELAY_STOPS = [2, 5, 15, 30];

export function AdvancedPanel() {
  const t = useT();
  const a = useSettingsStore((s) => s.advanced);
  const commandSuggest = useSettingsStore((s) => s.terminal.commandSuggest);
  const [clearedCount, setClearedCount] = useState<number | null>(null);
  const set = <K extends keyof AdvancedSettings>(key: K, value: AdvancedSettings[K]) =>
    useSettingsStore.getState().setAdvanced(key, value);

  const keepaliveOn = a.keepaliveIntervalSecs > 0;

  return (
    <div style={{ padding: "20px 24px", overflowY: "auto", color: "var(--text-1)", flex: 1 }}>
      <h3 style={{ fontSize: FS_HEADING, fontWeight: 500, margin: "0 0 3px" }}>{t("Advanced")}</h3>
      <div style={{ fontSize: FS_META, color: "var(--text-3)", marginBottom: 16 }}>
        {t("Applies to new connections and transfers · saved to settings.json")}
      </div>

      <div style={{ maxWidth: LIST_WIDTH }}>
        <Section label={t("SSH connection")} first />
        <Row label={t("Connect timeout")}>
          <Stepper
            range={ADVANCED_RANGES.connectTimeoutSecs}
            value={a.connectTimeoutSecs}
            onChange={(n) => set("connectTimeoutSecs", n)}
            unit="s"
            aria-label="Connect timeout"
          />
        </Row>
        <Row
          label={t("Keepalive interval")}
          help={keepaliveOn ? undefined : t("No keepalive probes are sent")}
        >
          <Presets
            stops={KEEPALIVE_STOPS}
            value={a.keepaliveIntervalSecs}
            onChange={(n) => set("keepaliveIntervalSecs", n)}
            // Minutes only when they divide evenly — a hand-edited 90
            // reads as "90s", not "1.5m".
            format={(n) => (
              n === 0 ? t("Off") : n >= 60 && n % 60 === 0 ? `${n / 60}m` : `${n}s`
            )}
            groupLabel="Keepalive interval"
          />
        </Row>
        {keepaliveOn && (
          <Row
            label={t("Keepalive limit")}
            help={t("Unanswered probes before the transport is dropped")}
          >
            <Stepper
              range={ADVANCED_RANGES.keepaliveMax}
              value={a.keepaliveMax}
              onChange={(n) => set("keepaliveMax", n)}
              aria-label="Keepalive limit"
            />
          </Row>
        )}

        <Section label={t("File transfers")} />
        <Row label={t("Concurrency")} help={t("Transfers past the limit wait in the queue")}>
          <Presets
            stops={CONCURRENCY_STOPS}
            value={a.sftpConcurrency}
            onChange={(n) => set("sftpConcurrency", n)}
            format={(n) => `${n}`}
            mono
            groupLabel="SFTP concurrency"
          />
        </Row>

        <Section label={t("Terminal")} />
        <Row label={t("Scrollback")} help={t("Applies to terminals opened from now on")}>
          <NumberField
            range={ADVANCED_RANGES.terminalScrollback}
            value={a.terminalScrollback}
            onCommit={(n) => set("terminalScrollback", n)}
            unit={t("lines")}
            aria-label="Scrollback lines"
          />
        </Row>
        <Row
          label={t("Command suggestions")}
          help={t("Typed commands are recorded locally per host and offered as ghost text; → accepts. Lines that look like they carry secrets are never stored.")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FS_BODY }}>
              <input
                type="checkbox"
                aria-label="Command suggestions"
                checked={commandSuggest}
                onChange={(e) => useSettingsStore.getState().setCommandSuggest(e.target.checked)}
              />
              {commandSuggest ? t("On") : t("Off")}
            </label>
            <button
              type="button"
              onClick={() => {
                void historyClear().then((n) => setClearedCount(n));
              }}
              style={{
                padding: "3px 10px", borderRadius: 4, fontSize: FS_META,
                border: "1px solid var(--border-hi)", background: "transparent",
                color: "var(--text-2)", cursor: "pointer",
              }}>
              {clearedCount === null
                ? t("Clear history")
                : `${t("Cleared")} ${clearedCount}`}
            </button>
          </div>
        </Row>

        <Section label={t("Tunnel reconnect")} />
        <Row label={t("First retry after")} help={t("Later attempts back off from here")}>
          <Presets
            stops={RETRY_DELAY_STOPS}
            value={a.reconnectIntervalSecs}
            onChange={(n) => set("reconnectIntervalSecs", n)}
            format={(n) => `${n}s`}
            groupLabel="First retry after"
          />
        </Row>
        <Row label={t("Retry limit")}>
          <Stepper
            range={ADVANCED_RANGES.reconnectMaxAttempts}
            value={a.reconnectMaxAttempts}
            onChange={(n) => set("reconnectMaxAttempts", n)}
            zeroLabel={t("No limit")}
            aria-label="Retry limit"
          />
        </Row>

        <Section label={t("Diagnostics")} />
        <Row label={t("Log level")} hint={t("Takes effect after a restart")}>
          <Segmented
            options={LOG_LEVEL_META.map((l) => ({ id: l.id, label: t(l.label) }))}
            value={a.logLevel}
            onChange={(id) => set("logLevel", id as AdvancedSettings["logLevel"])}
            groupLabel="Log level"
          />
        </Row>
      </div>
    </div>
  );
}

function Section({ label, first }: { label: string; first?: boolean }) {
  return (
    <div style={{
      fontSize: FS_META, color: "var(--text-3)",
      textTransform: "uppercase", letterSpacing: "0.07em",
      padding: first ? "0 2px 6px" : "16px 2px 6px",
      borderTop: first ? "none" : "1px solid var(--border)",
      marginTop: first ? 0 : 4,
    }}>{label}</div>
  );
}

/** One hairline-separated line: label (plus an optional `?` carrying the
 *  explanation on hover) on the left, control on the right. `hint` is for
 *  the one caveat worth reading without hovering. */
function Row({ label, help, hint, children }: {
  label: string; help?: string; hint?: string; children: ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 18, padding: "8px 2px", borderTop: "1px solid var(--border)",
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: FS_BODY, color: "var(--text-1)" }}>{label}</span>
          {help && (
            <span title={help} style={{ display: "flex", color: "var(--text-3)", cursor: "help" }}>
              <HelpCircle size={12} strokeWidth={1.8} />
            </span>
          )}
        </div>
        {hint && (
          <div style={{ fontSize: FS_META, color: "var(--text-3)", marginTop: 1 }}>{hint}</div>
        )}
      </div>
      {children}
    </div>
  );
}

/** − / value / + with a typable middle: these are exact numbers people
 *  want to land on, which a slider makes needlessly fiddly. */
function Stepper({ range, value, onChange, unit, zeroLabel, ...aria }: {
  range: readonly [number, number];
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  /** Rendered in place of the number at 0 (e.g. "No limit"). */
  zeroLabel?: string;
  "aria-label": string;
}) {
  const [min, max] = range;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    onChange(clamp(n));
  };
  const nudge = (delta: number) => onChange(clamp(value + delta));

  const showZeroLabel = zeroLabel !== undefined && value === 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, flex: "none" }}>
      <div style={{
        display: "flex", alignItems: "center",
        border: "1px solid var(--border-hi)", borderRadius: 6, overflow: "hidden",
      }}>
        <StepButton label="−" disabled={value <= min} onClick={() => nudge(-1)} />
        {showZeroLabel ? (
          <div style={{
            width: 62, textAlign: "center", fontSize: FS_META, color: "var(--text-2)",
          }}>{zeroLabel}</div>
        ) : (
          <input
            type="number" min={min} max={max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
            aria-label={aria["aria-label"]}
            style={{
              width: 62, height: 26, padding: 0, textAlign: "center",
              background: "transparent", color: "var(--text-1)", border: "none",
              fontSize: FS_BODY, fontFamily: '"JetBrains Mono", var(--font-mono)',
              fontVariantNumeric: "tabular-nums",
            }}
          />
        )}
        <StepButton label="+" disabled={value >= max} onClick={() => nudge(1)} />
      </div>
      {unit && <span style={{ fontSize: FS_META, color: "var(--text-3)" }}>{unit}</span>}
    </div>
  );
}

function StepButton({ label, disabled, onClick }: {
  label: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label === "+" ? "increase" : "decrease"}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 24, height: 26, border: "none", background: "transparent",
        color: disabled ? "var(--text-3)" : "var(--text-2)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
        fontSize: FS_BODY, lineHeight: 1,
        borderRight: label === "−" ? "1px solid var(--border)" : "none",
        borderLeft: label === "+" ? "1px solid var(--border)" : "none",
      }}
    >{label}</button>
  );
}

/** Segmented control over numeric stops. A stored value outside the stops
 *  (hand-edited settings.json) is appended as its own stop, so the row
 *  shows what is actually in effect instead of nothing selected. */
function Presets({ stops, value, onChange, format, mono, groupLabel }: {
  stops: number[];
  value: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
  mono?: boolean;
  groupLabel: string;
}) {
  const all = stops.includes(value) ? stops : [...stops, value].sort((x, y) => x - y);
  return (
    <Segmented
      options={all.map((n) => ({ id: String(n), label: format(n) }))}
      value={String(value)}
      onChange={(id) => onChange(Number(id))}
      mono={mono}
      groupLabel={groupLabel}
    />
  );
}

function Segmented({ options, value, onChange, mono, groupLabel }: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  mono?: boolean;
  groupLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={groupLabel}
      style={{
        display: "inline-flex", flex: "none", background: "var(--panel-1)",
        border: "1px solid var(--border)", borderRadius: 6, padding: 2,
      }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: "3px 9px", fontSize: FS_META, borderRadius: 4, border: "none",
            whiteSpace: "nowrap", cursor: "pointer",
            fontFamily: mono ? '"JetBrains Mono", var(--font-mono)' : "inherit",
            background: value === o.id ? "var(--accent)" : "transparent",
            color: value === o.id ? "var(--text-on-accent)" : "var(--text-2)",
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}

/** Free-typed number, committed on blur or Enter. 500..50000 spans two
 *  orders of magnitude — too wide for stops, and scrollback is a value
 *  people want to type exactly. */
function NumberField({ range, value, onCommit, unit, ...aria }: {
  range: readonly [number, number];
  value: number;
  onCommit: (n: number) => void;
  unit: string;
  "aria-label": string;
}) {
  const [min, max] = range;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    onCommit(Math.max(min, Math.min(max, Math.round(n))));
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, flex: "none" }}>
      <input
        type="number" min={min} max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        aria-label={aria["aria-label"]}
        style={{
          width: 84, height: 26, padding: "0 8px",
          background: "var(--panel-1)", color: "var(--text-1)",
          border: "1px solid var(--border-hi)", borderRadius: 6,
          fontSize: FS_BODY, fontFamily: '"JetBrains Mono", var(--font-mono)',
          fontVariantNumeric: "tabular-nums",
        }}
      />
      <span style={{ fontSize: FS_META, color: "var(--text-3)" }}>{unit}</span>
    </div>
  );
}
