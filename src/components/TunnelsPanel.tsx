import { useEffect, useState } from "react";
import { useSessions } from "../state/sessions";
import {
  listTunnelsForHost, openTunnel, closeTunnel, updateTunnel, addSessionTunnel,
} from "../ipc/tunnels";
import type { TunnelRule, TunnelStatus } from "../types/tunnel";

// Stable empty array to avoid creating a new reference on every render,
// which would cause an infinite re-render loop in zustand's selector.
const EMPTY_STATUSES: TunnelStatus[] = [];

interface Props {
  sessionId: string;
  hostId: string | null;
  connectionMode: string;
}

export function TunnelsPanel({ sessionId, hostId, connectionMode: _connectionMode }: Props) {
  const tunnelStatuses = useSessions((s) => s.tunnelStatuses[sessionId] ?? EMPTY_STATUSES);
  const setTunnelStatus = useSessions((s) => s.setTunnelStatus);
  const [rules, setRules] = useState<TunnelRule[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addLocalPort, setAddLocalPort] = useState("");
  const [addRemote, setAddRemote] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);

  useEffect(() => {
    if (hostId) {
      listTunnelsForHost(hostId).then(setRules).catch(() => {});
    }
  }, [hostId]);

  function statusFor(ruleId: string) {
    return tunnelStatuses.find((s) => s.rule_id === ruleId);
  }

  async function handleToggle(rule: TunnelRule) {
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
  }

  // Session-only tunnels (not in rules list)
  const sessionOnlyStatuses = tunnelStatuses.filter((s) => s.session_only);

  async function handleAddSession() {
    setAddErr(null);
    const local = parseInt(addLocalPort, 10);
    const [rhost, rportStr] = addRemote.split(":");
    const rport = parseInt(rportStr, 10);
    if (!addLabel || isNaN(local) || !rhost || isNaN(rport)) {
      setAddErr("Fill all fields: Label, Local port, Remote host:port");
      return;
    }
    try {
      const info = await addSessionTunnel({ session_id: sessionId, label: addLabel, local_port: local, remote_host: rhost, remote_port: rport });
      setTunnelStatus(sessionId, { rule_id: info.rule_id, session_id: sessionId, status: "active", session_only: true, label: info.label, local_port: info.local_port, remote_host: info.remote_host, remote_port: info.remote_port });
      setAddOpen(false);
      setAddLabel(""); setAddLocalPort(""); setAddRemote("");
    } catch (e) {
      setAddErr(String(e));
    }
  }

  const activeCount = tunnelStatuses.filter((s) => s.status === "active").length;
  const totalCount = rules.length + sessionOnlyStatuses.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>
          {totalCount} rules · {activeCount} active
        </span>
        <button
          onClick={() => setAddOpen((v) => !v)}
          style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
        >
          + Add
        </button>
      </div>

      {/* Rule list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {rules.map((rule) => {
          const s = statusFor(rule.id);
          const active = s?.status === "active";
          const dotColor = s?.status === "error" ? "var(--error)" : active ? "var(--success)" : "var(--text-3)";
          return (
            <div key={rule.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)" }}>
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
              {/* Toggle switch */}
              <div
                onClick={() => handleToggle(rule)}
                role="switch"
                aria-checked={active}
                style={{ width: 28, height: 16, borderRadius: 8, background: active ? "var(--accent)" : "var(--text-3)", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}
              >
                <span style={{ position: "absolute", top: 2, ...(active ? { right: 2 } : { left: 2 }), width: 12, height: 12, borderRadius: "50%", background: "var(--text-on-accent)", transition: "left .15s, right .15s" }} />
              </div>
            </div>
          );
        })}

        {/* Session-only tunnels */}
        {sessionOnlyStatuses.map((s) => {
          const active = s.status === "active";
          const dotColor = s.status === "error" ? "var(--error)" : active ? "var(--success)" : "var(--text-3)";
          return (
            <div key={s.rule_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)" }}>{s.label}</span>
                  <span style={{ fontSize: 10, background: "var(--accent-fade)", color: "var(--accent)", padding: "1px 5px", borderRadius: 8, fontWeight: 500 }}>SESSION</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
                  localhost:{s.local_port} → {s.remote_host}:{s.remote_port}
                </div>
              </div>
              <button
                onClick={() => s.local_port && navigator.clipboard.writeText(String(s.local_port))}
                style={{ fontSize: 10, color: "var(--text-2)", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
              >
                Copy port
              </button>
              <div
                onClick={async () => { await closeTunnel(sessionId, s.rule_id); }}
                role="switch"
                aria-checked={active}
                style={{ width: 28, height: 16, borderRadius: 8, background: active ? "var(--accent)" : "var(--text-3)", position: "relative", cursor: "pointer", flexShrink: 0 }}
              >
                <span style={{ position: "absolute", top: 2, ...(active ? { right: 2 } : { left: 2 }), width: 12, height: 12, borderRadius: "50%", background: "var(--text-on-accent)" }} />
              </div>
            </div>
          );
        })}

        {/* Inline Add row */}
        {addOpen && (
          <div style={{ display: "flex", gap: 4, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            {addErr && <div style={{ width: "100%", fontSize: 10, color: "var(--error)", marginBottom: 4 }}>{addErr}</div>}
            <input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Label" style={{ flex: "0 0 80px", fontSize: 11, padding: "3px 6px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)", fontFamily: "var(--font-mono)" }} />
            <input value={addLocalPort} onChange={(e) => setAddLocalPort(e.target.value)} placeholder="Local port" style={{ flex: "0 0 72px", fontSize: 11, padding: "3px 6px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)", fontFamily: "var(--font-mono)" }} />
            <input value={addRemote} onChange={(e) => setAddRemote(e.target.value)} placeholder="host:port" style={{ flex: 1, fontSize: 11, padding: "3px 6px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-1)", fontFamily: "var(--font-mono)" }} />
            <button onClick={handleAddSession} style={{ padding: "3px 8px", fontSize: 11, background: "var(--accent)", color: "var(--text-on-accent)", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>✓</button>
            <button onClick={() => { setAddOpen(false); setAddErr(null); }} style={{ padding: "3px 6px", fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text-2)" }}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
}
