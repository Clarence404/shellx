import { useEffect, useState } from "react";
import { useSessions } from "../state/sessions";
import { listTunnelsForHost, openTunnel, closeTunnel, updateTunnel, addTunnel } from "../ipc/tunnels";
import type { TunnelRule, TunnelStatus } from "../types/tunnel";

const EMPTY_STATUSES: TunnelStatus[] = [];

interface Props {
  sessionId: string;
  hostId: string | null;
  connectionMode: string;
}

export function TunnelsPanel({ sessionId, hostId, connectionMode: _connectionMode }: Props) {
  const tunnelStatuses = useSessions((s) => s.tunnelStatuses[sessionId] ?? EMPTY_STATUSES);
  const rulesVersion = useSessions((s) => hostId ? (s.rulesVersion[hostId] ?? 0) : 0);
  const [rules, setRules] = useState<TunnelRule[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addLocalPort, setAddLocalPort] = useState("");
  const [addRemoteHost, setAddRemoteHost] = useState("");
  const [addRemotePort, setAddRemotePort] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);
  const [toggleErrId, setToggleErrId] = useState<string | null>(null);
  const [toggleErrMsg, setToggleErrMsg] = useState<string | null>(null);

  // Re-fetch rules whenever hostId changes or rules are modified (rulesVersion bump)
  useEffect(() => {
    if (hostId) {
      listTunnelsForHost(hostId).then(setRules).catch(() => {});
    }
  }, [hostId, rulesVersion]);

  function statusFor(ruleId: string) {
    return tunnelStatuses.find((s) => s.rule_id === ruleId);
  }

  async function handleToggle(rule: TunnelRule) {
    setToggleErrId(null);
    setToggleErrMsg(null);
    try {
      const s = statusFor(rule.id);
      const isActive = s?.status === "active";
      if (isActive) {
        await closeTunnel(sessionId, rule.id);
        await updateTunnel({ id: rule.id, enabled: false });
        setRules((r) => r.map((x) => x.id === rule.id ? { ...x, enabled: false } : x));
      } else {
        await openTunnel({ session_id: sessionId, rule_id: rule.id, local_port: rule.local_port, remote_host: rule.remote_host, remote_port: rule.remote_port });
        await updateTunnel({ id: rule.id, enabled: true });
        setRules((r) => r.map((x) => x.id === rule.id ? { ...x, enabled: true } : x));
      }
    } catch (e) {
      setToggleErrId(rule.id);
      setToggleErrMsg(String(e));
    }
  }

  async function handleAdd() {
    setAddErr(null);
    const local = parseInt(addLocalPort, 10);
    const rport = parseInt(addRemotePort, 10);
    const rhost = addRemoteHost.trim();
    if (!rhost || isNaN(local) || isNaN(rport)) {
      setAddErr("Fill all fields");
      return;
    }
    if (!hostId) { setAddErr("No host"); return; }
    try {
      const rule = await addTunnel({ host_id: hostId, label: addLabel.trim(), local_port: local, remote_host: rhost, remote_port: rport });
      // Open the tunnel immediately in the current session
      await openTunnel({ session_id: sessionId, rule_id: rule.id, local_port: rule.local_port, remote_host: rule.remote_host, remote_port: rule.remote_port });
      setRules((r) => [...r, rule]);
      setAddOpen(false);
      setAddLabel(""); setAddLocalPort(""); setAddRemoteHost(""); setAddRemotePort("");
    } catch (e) {
      setAddErr(String(e));
    }
  }

  function handleCancelAdd() {
    setAddOpen(false);
    setAddErr(null);
    setAddLabel(""); setAddLocalPort(""); setAddRemoteHost(""); setAddRemotePort("");
  }

  const activeCount = tunnelStatuses.filter((s) => s.status === "active").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px" }}>
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>
            {rules.length} rules · {activeCount} active
          </span>
          {!addOpen && (
            <button
              onClick={() => setAddOpen(true)}
              style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
            >
              + Add
            </button>
          )}
        </div>
      </div>

      {/* Rule list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {rules.map((rule) => {
          const s = statusFor(rule.id);
          const active = s?.status === "active";
          const hasError = s?.status === "error" || toggleErrId === rule.id;
          const errMsg = toggleErrId === rule.id ? toggleErrMsg : (s?.error ?? null);
          const dotColor = hasError ? "var(--error)" : active ? "var(--success)" : "var(--text-3)";
          return (
            <div key={rule.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)" }}>{rule.label || `Port ${rule.local_port}`}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
                    localhost:{rule.local_port} → {rule.remote_host}:{rule.remote_port}
                  </div>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(String(rule.local_port))}
                  style={{ fontSize: 10, color: "var(--text-2)", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
                >
                  Copy port
                </button>
                <div
                  onClick={() => handleToggle(rule)}
                  role="switch"
                  aria-checked={active}
                  style={{ width: 28, height: 16, borderRadius: 8, background: active ? "var(--accent)" : "var(--text-3)", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}
                >
                  <span style={{ position: "absolute", top: 2, ...(active ? { right: 2 } : { left: 2 }), width: 12, height: 12, borderRadius: "50%", background: "var(--text-on-accent)", transition: "left .15s, right .15s" }} />
                </div>
              </div>
              {hasError && errMsg && (
                <div style={{ fontSize: 10, color: "var(--error)", padding: "0 12px 6px 27px", wordBreak: "break-all" }}>
                  {errMsg}
                </div>
              )}
            </div>
          );
        })}

        {/* Two-row inline add form */}
        {addOpen && (
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4 }}>
            {addErr && <div style={{ fontSize: 10, color: "var(--error)" }}>{addErr}</div>}
            <div style={{ display: "flex", gap: 4 }}>
              <input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Label"
                style={{ flex: 1, fontSize: 11, padding: "3px 6px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)" }} />
              <input value={addLocalPort} onChange={(e) => setAddLocalPort(e.target.value)} placeholder="Local port"
                style={{ width: 76, fontSize: 11, padding: "3px 6px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)", fontFamily: "var(--font-mono)" }} />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <input value={addRemoteHost} onChange={(e) => setAddRemoteHost(e.target.value)} placeholder="Remote host"
                style={{ flex: 1, fontSize: 11, padding: "3px 6px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)", fontFamily: "var(--font-mono)" }} />
              <input value={addRemotePort} onChange={(e) => setAddRemotePort(e.target.value)} placeholder="Port"
                style={{ width: 52, fontSize: 11, padding: "3px 6px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)", fontFamily: "var(--font-mono)" }} />
              <button onClick={handleAdd}
                style={{ padding: "3px 8px", fontSize: 11, background: "var(--accent)", color: "var(--text-on-accent)", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>✓</button>
              <button onClick={handleCancelAdd}
                style={{ padding: "3px 6px", fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text-2)" }}>✕</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
