import { useEffect, useState } from "react";
import {
  Plus, ChevronsLeft, RefreshCw, Usb, Cable, Plug, Unplug, X, RotateCw, List,
} from "lucide-react";
import { SectionHeader } from "./SectionHeader";
import { HostContextMenu } from "./HostContextMenu";
import { ErrorDialog } from "./ErrorDialog";
import { TerminalView } from "./TerminalView";
import { useSessions } from "../state/sessions";
import { useSerialStore, loadSerialOnce } from "../state/serial";
import type { NewSerialProfile } from "../ipc/serial";
import { DEFAULT_LINE, lineSummary, type SerialLineSettings, type SerialProfile } from "../types/serial";
import { useT } from "../i18n";

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

/**
 * The Serial rail view, self-contained like the FTP view: saved profiles
 * in the sidebar, and the main pane is either the live COM-port scan or
 * the embedded terminal of the selected serial session. Serial sessions
 * never join the global tab strip — they live and die here.
 */
export function SerialView() {
  const t = useT();
  const profiles = useSerialStore((s) => s.profiles);
  const ports = useSerialStore((s) => s.ports);
  const open = useSerialStore((s) => s.open);
  const activeId = useSerialStore((s) => s.activeId);
  const scanning = useSerialStore((s) => s.scanning);
  const lastScan = useSerialStore((s) => s.lastScan);
  const drawerCollapsed = useSessions((s) => s.drawerCollapsed);
  const toggleDrawer = useSessions((s) => s.toggleDrawer);

  const [form, setForm] = useState<{ initial: SerialProfile | null; presetPort?: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; profile: SerialProfile } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SerialProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPort, setBusyPort] = useState<string | null>(null);

  useEffect(() => { loadSerialOnce(); }, []);

  const livePorts = new Set(open.filter((s) => s.state === "active").map((s) => s.port));
  const active = open.find((s) => s.id === activeId) ?? null;

  async function connect(spec: SerialLineSettings & { label: string; port: string }) {
    setBusyPort(spec.port);
    try {
      await useSerialStore.getState().connect(spec);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyPort(null);
    }
  }

  function connectProfile(p: SerialProfile) {
    void connect({
      label: p.label,
      port: p.port,
      baud: p.baud,
      data_bits: p.data_bits,
      stop_bits: p.stop_bits,
      parity: p.parity,
      flow: p.flow,
    });
  }

  return (
    <div data-testid="serial-view" style={{
      height: "100%", minHeight: 0, display: "flex", background: "var(--panel-2)",
    }}>
      {!drawerCollapsed && (
      <aside aria-label="serial profiles" style={{
        width: "var(--drawer-w)", flexShrink: 0, background: "var(--panel-1)",
        borderRight: "1px solid var(--border)", padding: "10px 12px",
        display: "flex", flexDirection: "column",
      }}>
        <SectionHeader
          label={t("Serial")}
          action={
            <button
              aria-label="Collapse drawer"
              title={navigator.userAgent.includes("Mac") ? "Collapse (⌘+B)" : "Collapse (Ctrl+Shift+B)"}
              onClick={toggleDrawer}
              style={{
                color: "var(--text-2)", width: 26, height: 26, borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.color = "var(--text-1)"; el.style.background = "var(--panel-2)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.color = "var(--text-2)"; el.style.background = "transparent";
              }}
            >
              <ChevronsLeft size={16} strokeWidth={2} />
            </button>
          }
        />
        <div style={{ flex: 1, overflow: "auto", marginBottom: 8 }}>
          {/* Open terminals first — the working set. */}
          {open.map((s) => (
            <button
              key={s.id}
              aria-label={s.label}
              onClick={() => useSerialStore.getState().select(s.id)}
              style={{
                width: "100%", textAlign: "left", padding: "6px 8px",
                borderRadius: 4, border: "none", marginBottom: 1,
                background: s.id === activeId ? "var(--accent-fade)" : "transparent",
                color: s.id === activeId ? "var(--accent)" : "var(--text-1)",
                fontSize: "var(--font-ui-size)",
              }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: s.state === "active" ? "var(--success)" : "var(--text-3)",
                }} />
                <span style={{
                  flex: 1, minWidth: 0, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{s.label}</span>
              </span>
              <span style={{
                display: "block", marginLeft: 11, marginTop: 1,
                fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)",
              }}>{s.port} · {s.line}{s.state === "closed" ? ` · ${t("closed")}` : ""}</span>
            </button>
          ))}
          {open.length > 0 && (
            <button
              onClick={() => useSerialStore.getState().select(null)}
              style={{
                width: "100%", textAlign: "left", padding: "6px 8px",
                borderRadius: 4, border: "none", margin: "2px 0 8px",
                background: activeId === null ? "var(--accent-fade)" : "transparent",
                color: "var(--text-2)", fontSize: 11,
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <List size={12} /> {t("Detected ports")}
            </button>
          )}

          {profiles.length === 0 && open.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-3)", padding: "8px 4px", lineHeight: 1.7 }}>
              {t("No serial connections yet")}
            </div>
          )}
          {profiles.map((p) => {
            const live = livePorts.has(p.port);
            return (
              <button
                key={p.id}
                aria-label={p.label}
                onClick={() => connectProfile(p)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, profile: p });
                }}
                style={{
                  width: "100%", textAlign: "left", padding: "6px 8px",
                  borderRadius: 4, border: "none", marginBottom: 1,
                  background: "transparent", color: "var(--text-1)",
                  fontSize: "var(--font-ui-size)",
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: live ? "var(--success)" : "var(--accent)",
                    opacity: live ? 1 : 0.3,
                  }} />
                  <span style={{
                    flex: 1, minWidth: 0, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{p.label}</span>
                </span>
                <span style={{
                  display: "block", marginLeft: 11, marginTop: 1,
                  fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{p.port} · {lineSummary(p)}</span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setForm({ initial: null })}
          style={{
            height: 34, borderRadius: 6,
            background: "var(--accent-fade)", color: "var(--text-1)",
            border: "1px solid var(--accent)", fontSize: "var(--font-ui-size)",
            fontWeight: 500,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          }}>
          <Plus size={15} strokeWidth={2.2} />
          {t("New serial connection")}
        </button>
      </aside>
      )}

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {/* Terminal panel: every open session stays mounted so scrollback
            survives switching; only the active one is displayed. */}
        {active && (
          <div style={{
            height: 34, flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
            padding: "0 10px", borderBottom: "1px solid var(--border)",
            background: "var(--panel-1)",
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: active.state === "active" ? "var(--success)" : "var(--text-3)",
            }} />
            <span style={{ fontSize: "var(--font-ui-size)", fontWeight: 600, color: "var(--text-1)" }}>
              {active.label}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
              {active.port} · {active.line}{active.state === "closed" ? ` · ${t("closed")}` : ""}
            </span>
            <span style={{ flex: 1 }} />
            {active.state === "active" ? (
              <button
                onClick={() => void useSerialStore.getState().disconnect(active.id)}
                title={t("Disconnect")}
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
                  borderRadius: 5, fontSize: 11, background: "transparent",
                  color: "var(--text-2)", border: "1px solid var(--border)",
                }}>
                <Unplug size={12} /> {t("Disconnect")}
              </button>
            ) : (
              <button
                onClick={() => void connect(active.spec)}
                title={t("Reconnect")}
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
                  borderRadius: 5, fontSize: 11, background: "var(--accent-fade)",
                  color: "var(--text-1)", border: "1px solid var(--accent)",
                }}>
                <RotateCw size={12} /> {t("Reconnect")}
              </button>
            )}
            <button
              onClick={() => void useSerialStore.getState().dismiss(active.id)}
              aria-label={t("Close")}
              title={t("Close")}
              style={{
                width: 24, height: 24, display: "flex", alignItems: "center",
                justifyContent: "center", borderRadius: 5,
                color: "var(--text-3)", background: "transparent", border: "none",
              }}>
              <X size={14} />
            </button>
          </div>
        )}
        {open.map((s) => (
          <div key={s.id} style={{
            flex: 1, minHeight: 0,
            display: s.id === activeId ? "block" : "none",
          }}>
            <TerminalView sessionId={s.id} />
          </div>
        ))}

        {/* Ports page when no terminal is selected. */}
        {!active && (
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 16 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
          }}>
            <span style={{ fontSize: "calc(var(--font-ui-size) + 1px)", fontWeight: 600, color: "var(--text-1)" }}>
              {t("Detected ports")}
            </span>
            {lastScan > 0 && !scanning && (
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                {ports.length} · {new Date(lastScan).toLocaleTimeString()}
              </span>
            )}
            {scanning && (
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("Scanning…")}</span>
            )}
            <span style={{ flex: 1 }} />
            <button
              onClick={() => void useSerialStore.getState().refreshPorts()}
              disabled={scanning}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "5px 12px",
                borderRadius: 6, background: "var(--panel-1)", color: "var(--text-2)",
                border: "1px solid var(--border)", fontSize: "var(--font-ui-size)",
                opacity: scanning ? 0.7 : 1,
              }}>
              <RefreshCw size={13} strokeWidth={2} className={scanning ? "shellx-spin" : undefined} />
              {t("Refresh")}
            </button>
          </div>

          {ports.length === 0 ? (
            <div style={{
              padding: "28px 16px", textAlign: "center", color: "var(--text-3)",
              fontSize: "var(--font-ui-size)", lineHeight: 1.8,
              border: "1px dashed var(--border)", borderRadius: 8,
            }}>
              {t("No serial ports detected — plug in a USB-serial adapter and refresh.")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ports.map((port) => {
                const live = livePorts.has(port.name);
                const busy = busyPort === port.name;
                return (
                  <div key={port.name} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", borderRadius: 8,
                    background: "var(--panel-1)", border: "1px solid var(--border)",
                  }}>
                    {port.kind === "usb"
                      ? <Usb size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      : <Cable size={16} style={{ color: "var(--text-3)", flexShrink: 0 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: "var(--font-ui-size)", fontWeight: 600, color: "var(--text-1)",
                        fontFamily: "var(--font-mono)",
                        display: "flex", alignItems: "center", gap: 8,
                      }}>
                        {port.name}
                        {live && (
                          <span style={{
                            fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 999,
                            background: "var(--success-fade)", color: "var(--success)",
                            border: "1px solid var(--success)",
                          }}>{t("connected")}</span>
                        )}
                      </div>
                      {port.product && (
                        <div style={{
                          fontSize: 11, color: "var(--text-3)", marginTop: 1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{port.product}</div>
                      )}
                    </div>
                    <button
                      onClick={() => setForm({ initial: null, presetPort: port.name })}
                      style={{
                        padding: "5px 12px", borderRadius: 6, fontSize: "var(--font-ui-size)",
                        background: "var(--panel-2)", color: "var(--text-2)",
                        border: "1px solid var(--border)",
                      }}>
                      {t("Save as connection")}
                    </button>
                    <button
                      onClick={() => void connect({ label: port.name, port: port.name, ...DEFAULT_LINE })}
                      disabled={busy}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "5px 14px", borderRadius: 6, fontSize: "var(--font-ui-size)",
                        background: "var(--accent-fade)", color: "var(--text-1)",
                        border: "1px solid var(--accent)", opacity: busy ? 0.6 : 1,
                      }}>
                      <Plug size={13} strokeWidth={2} />
                      {live ? t("Open") : `${t("Connect")} · ${DEFAULT_LINE.baud}`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 12, lineHeight: 1.7 }}>
            {t("Quick connect uses 115200 · 8N1. Save a connection to pick another line setting.")}
          </div>
        </div>
        )}
      </div>

      {menu && (
        <HostContextMenu
          x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            livePorts.has(menu.profile.port)
              ? {
                  label: t("Disconnect"),
                  onClick: () => {
                    const s = useSerialStore.getState().open
                      .find((x) => x.port === menu.profile.port && x.state === "active");
                    if (s) void useSerialStore.getState().disconnect(s.id);
                  },
                  icon: <Unplug size={12} />,
                }
              : {
                  label: t("Connect"),
                  onClick: () => connectProfile(menu.profile),
                  icon: <Plug size={12} />,
                },
            { kind: "separator" as const },
            { label: t("Edit"), onClick: () => setForm({ initial: menu.profile }) },
            {
              label: t("Delete"),
              onClick: () => setPendingDelete(menu.profile),
              variant: "danger" as const,
            },
          ]}
        />
      )}

      {form && (
        <SerialProfileForm
          initial={form.initial}
          presetPort={form.presetPort}
          knownPorts={ports.map((p) => p.name)}
          onClose={() => setForm(null)}
        />
      )}

      {pendingDelete && (
        <div
          role="dialog"
          aria-label="confirm delete serial profile"
          onClick={() => setPendingDelete(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 340, background: "var(--panel-2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 8 }}>
              {t("Delete")} “{pendingDelete.label}”?
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button
                onClick={() => setPendingDelete(null)}
                style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: "var(--font-ui-size)",
                  background: "var(--panel-1)", color: "var(--text-2)",
                  border: "1px solid var(--border)",
                }}>
                {t("Cancel")}
              </button>
              <button
                onClick={() => {
                  void useSerialStore.getState().remove(pendingDelete.id);
                  setPendingDelete(null);
                }}
                style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: "var(--font-ui-size)",
                  background: "var(--error-fade)", color: "var(--error)",
                  border: "1px solid var(--error)",
                }}>
                {t("Delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <ErrorDialog message={error} onClose={() => setError(null)} />}
    </div>
  );
}

// --- form ------------------------------------------------------------------

function SerialProfileForm({
  initial, presetPort, knownPorts, onClose,
}: {
  initial: SerialProfile | null;
  presetPort?: string;
  knownPorts: string[];
  onClose: () => void;
}) {
  const t = useT();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [port, setPort] = useState(initial?.port ?? presetPort ?? knownPorts[0] ?? "");
  // Manual entry: for ports the scan can't see (odd virtual-port drivers,
  // a device that will be plugged in later).
  const [manualPort, setManualPort] = useState(false);
  const [baud, setBaud] = useState(initial?.baud ?? DEFAULT_LINE.baud);
  const [dataBits, setDataBits] = useState(initial?.data_bits ?? DEFAULT_LINE.data_bits);
  const [stopBits, setStopBits] = useState(initial?.stop_bits ?? DEFAULT_LINE.stop_bits);
  const [parity, setParity] = useState(initial?.parity ?? DEFAULT_LINE.parity);
  const [flow, setFlow] = useState(initial?.flow ?? DEFAULT_LINE.flow);
  const [saving, setSaving] = useState(false);

  // The saved port may have been unplugged: keep it selectable so editing
  // a profile doesn't silently retarget it.
  const portOptions = Array.from(new Set([...knownPorts, ...(port ? [port] : [])]));

  const fallbackLabel = port ? `${port} · ${baud}` : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!port.trim()) return;
    const payload: NewSerialProfile = {
      label: label.trim() || fallbackLabel,
      port: port.trim(),
      baud,
      data_bits: dataBits,
      stop_bits: stopBits,
      parity,
      flow,
    };
    setSaving(true);
    try {
      if (initial) await useSerialStore.getState().update(initial.id, payload);
      else await useSerialStore.getState().add(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%", background: "var(--panel-1)", color: "var(--text-1)",
    border: "1px solid var(--border)", borderRadius: 6,
    padding: "6px 8px", fontSize: "var(--font-ui-size)",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 11, color: "var(--text-3)", margin: "10px 0 4px",
  };

  return (
    <div
      role="dialog"
      aria-label="serial connection form"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <form onSubmit={(e) => void submit(e)} onClick={(e) => e.stopPropagation()} style={{
        width: 380, background: "var(--panel-2)", border: "1px solid var(--border)",
        borderRadius: 8, padding: "16px 18px",
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
          {initial ? t("Edit serial connection") : t("New serial connection")}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={labelStyle}>{t("Port")}</label>
            {manualPort ? (
              <input
                autoFocus
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="COM9"
                style={fieldStyle}
                aria-label={t("Port")}
              />
            ) : (
              <select
                value={port}
                onChange={(e) => {
                  if (e.target.value === "__manual__") { setManualPort(true); setPort(""); }
                  else setPort(e.target.value);
                }}
                style={fieldStyle}
                aria-label={t("Port")}
              >
                {portOptions.length === 0 && <option value="">—</option>}
                {portOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                <option value="__manual__">{t("Type manually…")}</option>
              </select>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={labelStyle}>{t("Baud rate")}</label>
            <select value={baud} onChange={(e) => setBaud(Number(e.target.value))} style={fieldStyle} aria-label={t("Baud rate")}>
              {BAUD_RATES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={labelStyle}>{t("Data bits")}</label>
            <select value={dataBits} onChange={(e) => setDataBits(Number(e.target.value))} style={fieldStyle} aria-label={t("Data bits")}>
              {[8, 7, 6, 5].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={labelStyle}>{t("Stop bits")}</label>
            <select value={stopBits} onChange={(e) => setStopBits(Number(e.target.value))} style={fieldStyle} aria-label={t("Stop bits")}>
              {[1, 2].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={labelStyle}>{t("Parity")}</label>
            <select value={parity} onChange={(e) => setParity(e.target.value)} style={fieldStyle} aria-label={t("Parity")}>
              <option value="none">{t("None")}</option>
              <option value="even">{t("Even")}</option>
              <option value="odd">{t("Odd")}</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={labelStyle}>{t("Flow control")}</label>
            <select value={flow} onChange={(e) => setFlow(e.target.value)} style={fieldStyle} aria-label={t("Flow control")}>
              <option value="none">{t("None")}</option>
              <option value="rtscts">RTS/CTS</option>
              <option value="xonxoff">XON/XOFF</option>
            </select>
          </div>
        </div>

        <label style={labelStyle}>{t("Name")}</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={fallbackLabel || t("Optional")}
          style={fieldStyle}
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 16px", borderRadius: 6, fontSize: "var(--font-ui-size)",
              background: "var(--panel-1)", color: "var(--text-2)",
              border: "1px solid var(--border)",
            }}>
            {t("Cancel")}
          </button>
          <button
            type="submit"
            disabled={saving || !port.trim()}
            style={{
              padding: "7px 16px", borderRadius: 6, fontSize: "var(--font-ui-size)",
              background: "var(--accent-fade)", color: "var(--text-1)",
              border: "1px solid var(--accent)",
              opacity: saving || !port.trim() ? 0.6 : 1,
            }}>
            {t("Save")}
          </button>
        </div>
      </form>
    </div>
  );
}
