import { useEffect, useState } from "react";
import { Plus, Plug, Unplug, Loader2 } from "lucide-react";
import { LocalPane } from "./LocalPane";
import { PaneSplitter } from "./PaneSplitter";
import { FtpRemotePane } from "./FtpRemotePane";
import { FtpHostForm } from "./FtpHostForm";
import { ConfirmDeleteHosts } from "./ConfirmDeleteHosts";
import { HostContextMenu } from "./HostContextMenu";
import { SectionHeader } from "./SectionHeader";
import { useFtpStore } from "../state/ftp";
import { useRailFiles } from "../state/railFiles";
import type { FtpHost } from "../types/ftp";
import type { HostInfo } from "../types/host";
import { useT } from "../i18n";

/**
 * The FTP view: its own connection list on the left, then the same
 * local-pane / splitter / remote-pane shape the Files view uses. Only
 * the remote side is new — the local half, the splitter and its
 * remembered position are the components that already exist.
 */
export function FtpView() {
  const t = useT();
  const hosts = useFtpStore((s) => s.hosts);
  const loaded = useFtpStore((s) => s.loaded);
  const activeId = useFtpStore((s) => s.activeId);
  const connected = useFtpStore((s) => s.connected);
  const connecting = useFtpStore((s) => s.connecting);
  const splitterPercent = useRailFiles((s) => s.splitterPercent);
  const setSplitterDraft = useRailFiles((s) => s.setSplitterDraft);
  const setSplitter = useRailFiles((s) => s.setSplitter);

  const [form, setForm] = useState<{ initial: FtpHost | null } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; host: FtpHost } | null>(null);
  const [pending, setPending] = useState<FtpHost | null>(null);

  useEffect(() => { if (!loaded) void useFtpStore.getState().load(); }, [loaded]);

  function open(host: FtpHost) {
    if (connected.includes(host.id)) {
      useFtpStore.getState().setActive(host.id);
      void useFtpStore.getState().refresh();
    } else {
      void useFtpStore.getState().connect(host.id);
    }
  }

  return (
    <div data-testid="ftp-view" style={{
      height: "100%", minHeight: 0, display: "flex", background: "var(--panel-2)",
    }}>
      <aside aria-label="ftp connections" style={{
        width: "var(--drawer-w)", flexShrink: 0, background: "var(--panel-1)",
        borderRight: "1px solid var(--border)", padding: "10px 12px",
        display: "flex", flexDirection: "column",
      }}>
        <SectionHeader label={t("FTP")} />
        <div style={{ flex: 1, overflow: "auto", marginBottom: 8 }}>
          {hosts.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-3)", padding: "8px 4px", lineHeight: 1.7 }}>
              {t("No FTP connections yet")}
            </div>
          )}
          {hosts.map((h) => {
            const live = connected.includes(h.id);
            const busy = connecting.includes(h.id);
            return (
              <button
                key={h.id}
                aria-label={h.label}
                onClick={() => open(h)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, host: h });
                }}
                style={{
                  width: "100%", textAlign: "left", padding: "6px 8px",
                  borderRadius: 4, border: "none", marginBottom: 1,
                  background: h.id === activeId ? "var(--accent-fade)" : "transparent",
                  color: h.id === activeId ? "var(--accent)" : "var(--text-1)",
                  fontSize: "var(--font-ui-size)",
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {busy
                    ? <Loader2 size={10} className="shellx-spin" style={{ flexShrink: 0 }} />
                    : <span style={{
                        width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                        background: live ? "var(--success)" : "var(--text-3)",
                        opacity: live ? 1 : 0.4,
                      }} />}
                  <span style={{
                    flex: 1, minWidth: 0, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{h.label}</span>
                  <span style={{
                    fontSize: 9, lineHeight: "15px", padding: "0 4px", borderRadius: 3,
                    flexShrink: 0,
                    border: `1px solid ${h.protocol === "ftp" ? "var(--warn)" : "var(--success)"}`,
                    background: h.protocol === "ftp" ? "var(--warn-fade)" : "var(--success-fade)",
                    color: h.protocol === "ftp" ? "var(--warn)" : "var(--success)",
                  }}>{h.protocol.toUpperCase()}</span>
                </span>
                <span style={{
                  display: "block", marginLeft: 11, marginTop: 1,
                  fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{h.host}:{h.port}</span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setForm({ initial: null })}
          style={{
            padding: "6px 8px", borderRadius: 5,
            background: "var(--accent-fade)", color: "var(--text-1)",
            border: "1px solid var(--accent)", fontSize: "var(--font-ui-size)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
          <Plus size={12} strokeWidth={2.5} />
          {t("New FTP connection")}
        </button>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", minHeight: 0 }}>
        <div style={{
          flexBasis: `${splitterPercent}%`, minWidth: 0,
          borderRight: "0.5px solid var(--border)",
        }}>
          <LocalPane />
        </div>
        <PaneSplitter percent={splitterPercent} onChange={setSplitterDraft} onCommit={setSplitter} />
        <div style={{ flexBasis: `${100 - splitterPercent}%`, minWidth: 0 }}>
          <FtpRemotePane />
        </div>
      </div>

      {menu && (
        <HostContextMenu
          x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            connected.includes(menu.host.id)
              ? {
                  label: t("Disconnect"),
                  onClick: () => void useFtpStore.getState().disconnect(menu.host.id),
                  icon: <Unplug size={12} />,
                }
              : {
                  label: t("Connect"),
                  onClick: () => open(menu.host),
                  icon: <Plug size={12} />,
                },
            { kind: "separator" as const },
            { label: t("Edit"), onClick: () => setForm({ initial: menu.host }) },
            {
              label: t("Delete"),
              onClick: () => setPending(menu.host),
              variant: "danger" as const,
            },
          ]}
        />
      )}

      {form && (
        <div
          role="dialog"
          aria-label="ftp connection form"
          onClick={() => setForm(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          <FtpHostForm
            initial={form.initial}
            onCancel={() => setForm(null)}
            onDone={() => setForm(null)}
          />
        </div>
      )}

      <ConfirmDeleteHosts
        // The dialog speaks HostInfo; only the label and id are read.
        hosts={pending ? ([{ id: pending.id, label: pending.label }] as HostInfo[]) : null}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const doomed = pending;
          setPending(null);
          if (doomed) void useFtpStore.getState().deleteHost(doomed.id);
        }}
      />
    </div>
  );
}
