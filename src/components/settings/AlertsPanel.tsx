import { useSettingsStore } from "../../state/settings";
import { ALERT_RANGES, HYSTERESIS_PCT, type AlertSettings, type AlertThreshold } from "../../types/alerts";
import { useT } from "../../i18n";

type RuleKey = "cpu" | "memory" | "disk" | "swap" | "loadPerCore";

const ROW_GAP = 14;

function Check({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", fontSize: "var(--font-ui-size)" }}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
      />
      <span style={{ color: "var(--text-1)" }}>{label}</span>
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--text-3)", margin: "5px 0 0 24px", maxWidth: 440 }}>{children}</div>;
}

/** One threshold rule: its own on/off, a slider, and the current value.
 *  Disabled rules dim rather than disappear, so the set of things that
 *  can be watched stays visible. */
function Rule({ id, label, unit, disabled }: {
  id: RuleKey; label: string; unit: "%" | "x"; disabled: boolean;
}) {
  const rule = useSettingsStore((s) => s.alerts[id]) as AlertThreshold;
  const set = useSettingsStore((s) => s.setAlerts);
  const [min, max] = ALERT_RANGES[id];
  const off = disabled || !rule.enabled;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: ROW_GAP, opacity: disabled ? 0.45 : 1 }}>
      <input
        type="checkbox"
        checked={rule.enabled}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => set(id, { ...rule, enabled: e.target.checked })}
        style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: disabled ? "default" : "pointer", flexShrink: 0 }}
      />
      <span style={{ width: 118, fontSize: "var(--font-ui-size)", color: "var(--text-2)", flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={unit === "x" ? 0.5 : 1}
        value={rule.value}
        disabled={off}
        aria-label={`${label} threshold`}
        onChange={(e) => set(id, { ...rule, value: Number(e.target.value) })}
        style={{ flex: 1, accentColor: "var(--accent)", opacity: off ? 0.5 : 1, minWidth: 90 }}
      />
      <span style={{
        width: 52, textAlign: "right", fontSize: "var(--font-ui-size)", fontWeight: 600,
        color: off ? "var(--text-3)" : "var(--text-1)", fontVariantNumeric: "tabular-nums", flexShrink: 0,
      }}>{rule.value}{unit}</span>
    </div>
  );
}

function NumberRow({ id, label, suffix, disabled }: {
  id: "sustainSamples" | "cooldownMins"; label: string; suffix: string; disabled: boolean;
}) {
  const value = useSettingsStore((s) => s.alerts[id]) as number;
  const set = useSettingsStore((s) => s.setAlerts);
  const [min, max] = ALERT_RANGES[id];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: ROW_GAP, opacity: disabled ? 0.45 : 1 }}>
      <span style={{ width: 118, fontSize: "var(--font-ui-size)", color: "var(--text-2)", flexShrink: 0 }}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) set(id, n); }}
        style={{
          width: 64, border: "1px solid var(--border)", borderRadius: 5, padding: "4px 7px",
          background: "var(--panel-2)", color: "var(--text-1)", font: "inherit",
          fontSize: "var(--font-ui-size)", textAlign: "right",
        }}
      />
      <span style={{ fontSize: "var(--font-ui-size)", color: "var(--text-2)" }}>{suffix}</span>
    </div>
  );
}

/**
 * Settings → Alerts. One global set of rules, shared by every host:
 * per-host thresholds would need a second place to look when an alert
 * surprises you.
 */
export function AlertsPanel() {
  const t = useT();
  const alerts = useSettingsStore((s) => s.alerts) as AlertSettings;
  const set = useSettingsStore((s) => s.setAlerts);
  const off = !alerts.enabled;

  return (
    <div style={{ padding: "18px 22px", maxWidth: 620, overflowY: "auto" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600, color: "var(--text-1)" }}>{t("Alerts")}</h2>
      <p style={{ margin: "0 0 18px", fontSize: 12, color: "var(--text-2)" }}>
        {t("Watch the hosts you are connected to and say something when a threshold is crossed.")}
      </p>

      <Check checked={alerts.enabled} onChange={(v) => set("enabled", v)} label={t("Enable threshold alerts")} />
      <Hint>{t("Connected hosts keep being sampled in the background, every 10 seconds, even with the monitor closed.")}</Hint>

      <div style={{ marginTop: 12, opacity: off ? 0.45 : 1 }}>
        <Check
          checked={alerts.systemNotifications}
          onChange={(v) => set("systemNotifications", v)}
          label={t("Send system notifications")}
        />
        <Hint>{t("An alert reaches you while shellx is behind another window.")}</Hint>
      </div>

      <div style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div style={{
          fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase",
          color: "var(--text-3)", fontWeight: 700,
        }}>{t("Thresholds")}</div>
        <Rule id="cpu" label="CPU" unit="%" disabled={off} />
        <Rule id="memory" label={t("Memory")} unit="%" disabled={off} />
        <Rule id="disk" label={t("Disk")} unit="%" disabled={off} />
        <Rule id="swap" label={t("Swap")} unit="%" disabled={off} />
        <Rule id="loadPerCore" label={t("Load per core")} unit="x" disabled={off} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: ROW_GAP, opacity: off ? 0.45 : 1 }}>
          <input
            type="checkbox"
            checked={alerts.failedUnits}
            disabled={off}
            aria-label={t("Failed services")}
            onChange={(e) => set("failedUnits", e.target.checked)}
            style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: off ? "default" : "pointer", flexShrink: 0 }}
          />
          <span style={{ width: 118, fontSize: "var(--font-ui-size)", color: "var(--text-2)", flexShrink: 0 }}>{t("Failed services")}</span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("a unit enters systemctl --failed")}</span>
        </div>
      </div>

      <div style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div style={{
          fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase",
          color: "var(--text-3)", fontWeight: 700,
        }}>{t("When to fire")}</div>
        <NumberRow id="sustainSamples" label={t("Sustained for")} suffix={t("samples in a row")} disabled={off} />
        <NumberRow id="cooldownMins" label={t("Then quiet for")} suffix={t("minutes")} disabled={off} />
        <Hint>
          {t("An alert clears once the reading falls")} {HYSTERESIS_PCT}
          {t("% below its threshold, so a metric sitting on the line doesn't alert twice a minute.")}
        </Hint>
      </div>
    </div>
  );
}
