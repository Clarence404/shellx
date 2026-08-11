import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { useSessions } from "../state/sessions";
import { useHostsStore } from "../state/hosts";
import {
  listTunnelsForHost, openTunnel, closeTunnel, updateTunnel,
  addTunnel, deleteTunnel, reorderTunnels,
} from "../ipc/tunnels";
import type { TunnelRule, TunnelStatus } from "../types/tunnel";

const EMPTY_STATUSES: TunnelStatus[] = [];

interface Props {
  sessionId: string;
  hostId: string | null;
  connectionMode: string;
}

function parseSSHImport(cmd: string): Array<{ local_port: number; remote_host: string; remote_port: number }> {
  const results: Array<{ local_port: number; remote_host: string; remote_port: number }> = [];
  const re = /-L\s+(\d+):([^:\s]+):(\d+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    results.push({ local_port: parseInt(m[1], 10), remote_host: m[2], remote_port: parseInt(m[3], 10) });
  }
  return results;
}

export function TunnelsPanel({ sessionId, hostId, connectionMode: _connectionMode }: Props) {
  const tunnelStatuses = useSessions((s) => s.tunnelStatuses[sessionId] ?? EMPTY_STATUSES);
  const rulesVersion = useSessions((s) => hostId ? (s.rulesVersion[hostId] ?? 0) : 0);
  const hostInfo = useHostsStore((s) => hostId ? (s.hosts.find((h) => h.id === hostId) ?? null) : null);
  const [rules, setRules] = useState<TunnelRule[]>([]);

  // Keep a ref so DnD end-handler always reads the committed order.
  const rulesRef = useRef<TunnelRule[]>([]);
  rulesRef.current = rules;

  // Add form state
  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addLocalPort, setAddLocalPort] = useState("");
  const [addRemoteHost, setAddRemoteHost] = useState("");
  const [addRemotePort, setAddRemotePort] = useState("");
  const [addBindAll, setAddBindAll] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editLocalPort, setEditLocalPort] = useState("");
  const [editRemoteHost, setEditRemoteHost] = useState("");
  const [editRemotePort, setEditRemotePort] = useState("");
  const [editErr, setEditErr] = useState<string | null>(null);

  // Expand state
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Toggle error state
  const [toggleErrId, setToggleErrId] = useState<string | null>(null);
  const [toggleErrMsg, setToggleErrMsg] = useState<string | null>(null);

  // Delete two-click confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
  }, []);

  // Import state
  const [importCmd, setImportCmd] = useState("");
  const [importParsed, setImportParsed] = useState<Array<{ local_port: number; remote_host: string; remote_port: number }> | null>(null);

  // Pointer-based DnD state (HTML5 drag-and-drop is unreliable in WebView2)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const lastDragTarget = useRef<string | null>(null);
  // FLIP animation support
  const rowEls = useRef<Map<string, HTMLElement>>(new Map());
  const snapshots = useRef<Map<string, number>>(new Map());

  // After rules reorder, animate rows from their old positions to new ones (FLIP).
  useLayoutEffect(() => {
    if (!snapshots.current.size) return;
    rowEls.current.forEach((el, id) => {
      const oldTop = snapshots.current.get(id);
      if (oldTop === undefined) return;
      const dy = oldTop - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      void el.offsetHeight; // flush reflow so next frame sees the transform
      el.style.transition = "transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)";
      el.style.transform = "";
    });
    snapshots.current.clear();
  }, [rules]);

  useEffect(() => {
    if (hostId) {
      listTunnelsForHost(hostId).then(setRules).catch(() => {});
    }
  }, [hostId, rulesVersion]);

  function statusFor(ruleId: string) {
    return tunnelStatuses.find((s) => s.rule_id === ruleId);
  }

  // ---- Toggle ---------------------------------------------------------------

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
        await openTunnel({ session_id: sessionId, rule_id: rule.id, local_port: rule.local_port, remote_host: rule.remote_host, remote_port: rule.remote_port, bind_all: rule.bind_all });
        await updateTunnel({ id: rule.id, enabled: true });
        setRules((r) => r.map((x) => x.id === rule.id ? { ...x, enabled: true } : x));
      }
    } catch (e) {
      setToggleErrId(rule.id);
      setToggleErrMsg(String(e));
    }
  }

  // ---- Add ------------------------------------------------------------------

  async function handleAdd() {
    setAddErr(null);
    const local = parseInt(addLocalPort, 10);
    const rport = parseInt(addRemotePort, 10);
    const rhost = addRemoteHost.trim();
    if (!rhost || isNaN(local) || isNaN(rport)) { setAddErr("Fill all fields"); return; }
    if (!hostId) { setAddErr("No host"); return; }
    try {
      const rule = await addTunnel({ host_id: hostId, label: addLabel.trim(), local_port: local, remote_host: rhost, remote_port: rport, bind_all: addBindAll });
      await openTunnel({ session_id: sessionId, rule_id: rule.id, local_port: rule.local_port, remote_host: rule.remote_host, remote_port: rule.remote_port, bind_all: rule.bind_all });
      setRules((r) => [...r, rule]);
      setAddOpen(false);
      setAddLabel(""); setAddLocalPort(""); setAddRemoteHost(""); setAddRemotePort(""); setAddBindAll(false);
    } catch (e) {
      setAddErr(String(e));
    }
  }

  function handleCancelAdd() {
    setAddOpen(false);
    setAddErr(null);
    setAddLabel(""); setAddLocalPort(""); setAddRemoteHost(""); setAddRemotePort(""); setAddBindAll(false);
  }

  // ---- Edit -----------------------------------------------------------------

  function startEdit(rule: TunnelRule) {
    setEditingId(rule.id);
    setEditLabel(rule.label ?? "");
    setEditLocalPort(String(rule.local_port));
    setEditRemoteHost(rule.remote_host);
    setEditRemotePort(String(rule.remote_port));
    setEditErr(null);
    setToggleErrId(null);
    setToggleErrMsg(null);
    setExpandedId(null);
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    const local = parseInt(editLocalPort, 10);
    const rport = parseInt(editRemotePort, 10);
    const rhost = editRemoteHost.trim();
    if (!rhost || isNaN(local) || isNaN(rport)) { setEditErr("Fill all fields"); return; }
    try {
      await updateTunnel({ id: editingId, label: editLabel.trim(), local_port: local, remote_host: rhost, remote_port: rport });
      setRules((r) => r.map((x) => x.id === editingId ? { ...x, label: editLabel.trim(), local_port: local, remote_host: rhost, remote_port: rport } : x));
      setEditingId(null);
    } catch (e) {
      setEditErr(String(e));
    }
  }

  // ---- Delete ---------------------------------------------------------------

  // Two-click confirm: first click arms the button, second click deletes.
  function armDelete(rule: TunnelRule) {
    if (confirmTimer.current !== null) {
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
    if (confirmDeleteId === rule.id) {
      setConfirmDeleteId(null);
      void handleDelete(rule);
      return;
    }
    setConfirmDeleteId(rule.id);
    confirmTimer.current = window.setTimeout(() => {
      setConfirmDeleteId(null);
      confirmTimer.current = null;
    }, 3000);
  }

  function disarmDelete() {
    if (confirmTimer.current !== null) {
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
    setConfirmDeleteId(null);
  }

  async function handleDelete(rule: TunnelRule) {
    try {
      const s = statusFor(rule.id);
      if (s?.status === "active") await closeTunnel(sessionId, rule.id);
      await deleteTunnel(rule.id);
      setRules((r) => r.filter((x) => x.id !== rule.id));
      if (expandedId === rule.id) setExpandedId(null);
    } catch (e) {
      setToggleErrId(rule.id);
      setToggleErrMsg(String(e));
    }
  }

  // ---- Bind-all toggle in expand pane ---------------------------------------

  async function handleToggleBindAll(rule: TunnelRule) {
    const newVal = !rule.bind_all;
    await updateTunnel({ id: rule.id, bind_all: newVal });
    setRules((r) => r.map((x) => x.id === rule.id ? { ...x, bind_all: newVal } : x));
  }

  // ---- Import ---------------------------------------------------------------

  function handleParseImport() {
    const parsed = parseSSHImport(importCmd);
    setImportParsed(parsed.length > 0 ? parsed : []);
  }

  async function handleImportAdd() {
    if (!importParsed || importParsed.length === 0 || !hostId) return;
    for (const p of importParsed) {
      try {
        const rule = await addTunnel({ host_id: hostId, label: "", local_port: p.local_port, remote_host: p.remote_host, remote_port: p.remote_port });
        await openTunnel({ session_id: sessionId, rule_id: rule.id, local_port: rule.local_port, remote_host: rule.remote_host, remote_port: rule.remote_port, bind_all: rule.bind_all });
        setRules((r) => [...r, rule]);
      } catch { /* skip failed rules */ }
    }
    setImportCmd("");
    setImportParsed(null);
  }

  // ---- SSH cmd helper -------------------------------------------------------

  function buildSSHCmd(rule: TunnelRule) {
    const userHost = hostInfo ? `${hostInfo.username}@${hostInfo.host}` : "<user@host>";
    return `ssh -L ${rule.local_port}:${rule.remote_host}:${rule.remote_port} ${userHost}`;
  }

  // ---- Pointer-based drag-and-drop ------------------------------------------
  // HTML5 DnD is unreliable in Tauri/WebView2; pointer events work everywhere.

  function onGripPointerDown(e: React.PointerEvent, srcId: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    setDraggingId(srcId);
    lastDragTarget.current = null;

    function onMove(ev: PointerEvent) {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const row = hit?.closest<HTMLElement>("[data-rule-id]");
      const targetId = row?.dataset.ruleId ?? null;
      if (!targetId || targetId === srcId || targetId === lastDragTarget.current) return;
      lastDragTarget.current = targetId;
      setDragOverId(targetId);
      // Snapshot current positions before React reorders the DOM (for FLIP).
      snapshots.current.clear();
      rowEls.current.forEach((el, id) => {
        snapshots.current.set(id, el.getBoundingClientRect().top);
      });
      setRules((prev) => {
        const si = prev.findIndex((r) => r.id === srcId);
        const ti = prev.findIndex((r) => r.id === targetId);
        if (si === -1 || ti === -1) return prev;
        const next = [...prev];
        const [item] = next.splice(si, 1);
        next.splice(ti, 0, item);
        return next;
      });
    }

    async function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDraggingId(null);
      setDragOverId(null);
      lastDragTarget.current = null;
      if (!hostId) return;
      try {
        await reorderTunnels(hostId, rulesRef.current.map((r) => r.id));
      } catch { /* non-fatal */ }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // ---- Render ---------------------------------------------------------------

  const activeCount = tunnelStatuses.filter((s) => s.status === "active").length;

  const field: React.CSSProperties = {
    fontSize: 11, padding: "4px 7px",
    background: "var(--panel-1)", border: "1px solid var(--border)",
    borderRadius: 4, color: "var(--text-1)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Import bar */}
      <div style={{ borderBottom: "1px solid var(--border)", padding: "7px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 5, padding: "0 8px", height: 28 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-3)", flexShrink: 0 }}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
          <input
            value={importCmd}
            onChange={(e) => { setImportCmd(e.target.value); setImportParsed(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleParseImport(); }}
            placeholder="Paste SSH command to import rules…"
            style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 11, color: "var(--text-1)", fontFamily: "var(--font-mono)" }}
          />
          {importCmd.trim() && (
            <button onClick={handleParseImport} style={{ background: "none", border: "none", fontSize: 10, color: "var(--accent)", cursor: "pointer", padding: 0, whiteSpace: "nowrap", fontWeight: 500 }}>Parse</button>
          )}
        </div>
        {importParsed !== null && (
          <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", background: importParsed.length > 0 ? "rgba(var(--success-rgb,166,227,161),.08)" : "rgba(var(--error-rgb,243,139,168),.08)", border: `1px solid ${importParsed.length > 0 ? "var(--success)" : "var(--error)"}`, borderRadius: 4, opacity: 0.85 }}>
            <span style={{ fontSize: 10, color: importParsed.length > 0 ? "var(--success)" : "var(--error)", flex: 1, fontFamily: "var(--font-mono)" }}>
              {importParsed.length > 0
                ? importParsed.map((p) => `${p.local_port}→${p.remote_host}:${p.remote_port}`).join(", ")
                : "No -L rules found"}
            </span>
            {importParsed.length > 0 && (
              <button onClick={handleImportAdd} style={{ background: "none", border: "1px solid var(--success)", borderRadius: 3, color: "var(--success)", fontSize: 10, padding: "2px 8px", cursor: "pointer", fontWeight: 500 }}>
                Add {importParsed.length > 1 ? `${importParsed.length} rules` : "rule"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>{rules.length} rules</span>
          {activeCount > 0 && (
            <>
              <span style={{ width: 1, height: 10, background: "var(--border-hi)" }} />
              <span style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, color: "var(--success)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", display: "inline-block" }} />
                {activeCount} active
              </span>
            </>
          )}
        </div>
        {!addOpen && (
          <button onClick={() => setAddOpen(true)} style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}>+ Add</button>
        )}
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* Add form */}
        {addOpen && (
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4, background: "rgba(124,92,255,0.03)" }}>
            {addErr && <div style={{ fontSize: 10, color: "var(--error)" }}>{addErr}</div>}
            <div style={{ display: "flex", gap: 4 }}>
              <input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Label" style={{ ...field, flex: 1 }} />
              <input value={addLocalPort} onChange={(e) => setAddLocalPort(e.target.value)} placeholder="Local port" style={{ ...field, width: 76, fontFamily: "var(--font-mono)" }} />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <input value={addRemoteHost} onChange={(e) => setAddRemoteHost(e.target.value)} placeholder="Remote host" style={{ ...field, flex: 1, fontFamily: "var(--font-mono)" }} />
              <input value={addRemotePort} onChange={(e) => setAddRemotePort(e.target.value)} placeholder="Port" style={{ ...field, width: 52, fontFamily: "var(--font-mono)" }} />
              <button onClick={handleAdd} style={{ padding: "3px 8px", fontSize: 11, background: "var(--accent)", color: "var(--text-on-accent)", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>✓</button>
              <button onClick={handleCancelAdd} style={{ padding: "3px 6px", fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text-2)" }}>✕</button>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={addBindAll} onChange={(e) => setAddBindAll(e.target.checked)} />
              LAN sharing (0.0.0.0)
            </label>
          </div>
        )}

        {/* Rules */}
        {rules.map((rule) => {
          const s = statusFor(rule.id);
          const active = s?.status === "active";
          const hasError = s?.status === "error" || toggleErrId === rule.id;
          const errMsg = toggleErrId === rule.id ? toggleErrMsg : (s?.error ?? null);
          const isEditing = editingId === rule.id;
          const isExpanded = expandedId === rule.id && !isEditing;
          const isDragging = draggingId === rule.id;
          const isDragOver = dragOverId === rule.id && draggingId !== rule.id;

          const dotColor = hasError
            ? "var(--error)"
            : active
            ? "var(--success)"
            : "var(--text-3)";

          return (
            <div
              key={rule.id}
              data-rule-id={rule.id}
              ref={(el) => { if (el) rowEls.current.set(rule.id, el); else rowEls.current.delete(rule.id); }}
              style={{
                borderBottom: "1px solid var(--border)",
                position: "relative",
                userSelect: "none",
                transition: "opacity 0.18s ease, box-shadow 0.18s ease, background 0.18s ease",
                ...(isDragging ? {
                  opacity: 0.55,
                  boxShadow: "0 6px 24px rgba(0,0,0,0.32), 0 1px 6px rgba(0,0,0,0.18), inset 0 0 0 1.5px rgba(124,92,255,0.35)",
                  background: "var(--panel-1)",
                  zIndex: 10,
                } : isDragOver ? {
                  background: "rgba(124,92,255,0.08)",
                  boxShadow: "inset 3px 0 0 #7c5cff",
                } : {}),
              }}
            >
              {/* Main row */}
              <div style={{ display: "flex", alignItems: "center" }}>
                {/* Grip handle — drag handle for pointer-based reorder */}
                <div
                  onPointerDown={(e) => onGripPointerDown(e, rule.id)}
                  style={{ width: 22, alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "center", cursor: draggingId ? "grabbing" : "grab", color: "var(--text-3)", flexShrink: 0, opacity: 0.35, touchAction: "none" }}
                  title="Drag to reorder"
                >
                  <GripVertical size={13} />
                </div>

                {/* Status dot */}
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />

                {/* Content */}
                <div
                  style={{ flex: 1, minWidth: 0, padding: "9px 10px", cursor: "pointer" }}
                  onClick={() => { if (!isEditing) setExpandedId(isExpanded ? null : rule.id); }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)" }}>
                      {rule.label || `Port ${rule.local_port}`}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 600, letterSpacing: ".4px", textTransform: "uppercase",
                      borderRadius: 3, padding: "1px 5px",
                      background: active ? "rgba(var(--success-rgb,166,227,161),.12)" : "rgba(255,255,255,0.05)",
                      border: `0.5px solid ${active ? "rgba(var(--success-rgb,166,227,161),.3)" : "var(--border)"}`,
                      color: active ? "var(--success)" : "var(--text-3)",
                    }}>
                      {active ? "Active" : "Inactive"}
                    </span>
                    {isExpanded && (
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--accent)" }}>›</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden" }}>
                    <span style={{ color: "var(--text-2)", flexShrink: 0 }}>
                      {rule.bind_all ? "0.0.0.0" : "localhost"}:{rule.local_port}
                    </span>
                    <span style={{ color: "var(--text-3)", flexShrink: 0 }}>→</span>
                    <span style={{ color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {rule.remote_host}:{rule.remote_port}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", alignItems: "center", gap: 2, paddingRight: 10, flexShrink: 0 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); isEditing ? setEditingId(null) : startEdit(rule); }}
                    title="Edit"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 5, borderRadius: 4, color: isEditing ? "var(--accent)" : "var(--text-3)", display: "flex", alignItems: "center" }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); armDelete(rule); }}
                    onMouseLeave={() => { if (confirmDeleteId === rule.id) disarmDelete(); }}
                    title={confirmDeleteId === rule.id ? "再次点击确认删除" : "Delete"}
                    style={{
                      background: confirmDeleteId === rule.id ? "rgba(243,139,168,.12)" : "none",
                      border: "none", cursor: "pointer", padding: 5, borderRadius: 4,
                      color: confirmDeleteId === rule.id ? "var(--error)" : "var(--text-3)",
                      display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {confirmDeleteId === rule.id && <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>确认?</span>}
                    <Trash2 size={13} />
                  </button>
                  {/* Toggle */}
                  <div
                    onClick={(e) => { e.stopPropagation(); void handleToggle(rule); }}
                    role="switch"
                    aria-checked={active}
                    style={{ width: 30, height: 17, borderRadius: 9, background: active ? "var(--accent)" : "var(--text-3)", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s", marginLeft: 4 }}
                  >
                    <span style={{ position: "absolute", top: 2, ...(active ? { right: 2 } : { left: 2 }), width: 13, height: 13, borderRadius: "50%", background: "var(--text-on-accent)", transition: "left .15s, right .15s" }} />
                  </div>
                </div>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div style={{ padding: "0 12px 8px 31px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {editErr && <div style={{ fontSize: 10, color: "var(--error)" }}>{editErr}</div>}
                  <div style={{ display: "flex", gap: 4 }}>
                    <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Label" style={{ ...field, flex: 1 }} />
                    <input value={editLocalPort} onChange={(e) => setEditLocalPort(e.target.value)} placeholder="Local port" style={{ ...field, width: 76, fontFamily: "var(--font-mono)" }} />
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input value={editRemoteHost} onChange={(e) => setEditRemoteHost(e.target.value)} placeholder="Remote host" style={{ ...field, flex: 1, fontFamily: "var(--font-mono)" }} />
                    <input value={editRemotePort} onChange={(e) => setEditRemotePort(e.target.value)} placeholder="Port" style={{ ...field, width: 52, fontFamily: "var(--font-mono)" }} />
                    <button onClick={handleSaveEdit} style={{ padding: "3px 8px", fontSize: 11, background: "var(--accent)", color: "var(--text-on-accent)", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>✓</button>
                    <button onClick={() => setEditingId(null)} style={{ padding: "3px 6px", fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--text-2)" }}>✕</button>
                  </div>
                </div>
              )}

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ padding: "0 12px 10px 12px", borderTop: "1px solid var(--border)", background: "var(--panel-1)" }}>
                  <div style={{ fontSize: 9.5, fontWeight: 600, color: "var(--text-3)", letterSpacing: ".5px", textTransform: "uppercase", paddingTop: 8, marginBottom: 5 }}>
                    SSH command
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "7px 9px" }}>
                    <span style={{ flex: 1, fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text-2)", lineHeight: 1.6, wordBreak: "break-all" }}>
                      {buildSSHCmd(rule)}
                    </span>
                    <button
                      onClick={() => navigator.clipboard.writeText(buildSSHCmd(rule))}
                      style={{ flexShrink: 0, background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-3)", fontSize: 10, padding: "3px 7px", cursor: "pointer" }}
                    >
                      Copy
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-1)", fontWeight: 500 }}>LAN sharing</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)" }}>Bind to 0.0.0.0 — accessible from local network</div>
                    </div>
                    <div
                      onClick={() => void handleToggleBindAll(rule)}
                      role="switch"
                      aria-checked={rule.bind_all}
                      style={{ width: 30, height: 17, borderRadius: 9, background: rule.bind_all ? "var(--accent)" : "var(--text-3)", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}
                    >
                      <span style={{ position: "absolute", top: 2, ...(rule.bind_all ? { right: 2 } : { left: 2 }), width: 13, height: 13, borderRadius: "50%", background: "var(--text-on-accent)", transition: "left .15s, right .15s" }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Inline toggle error */}
              {!isEditing && !isExpanded && hasError && errMsg && (
                <div style={{ fontSize: 10, color: "var(--error)", padding: "0 12px 6px 39px", wordBreak: "break-all" }}>{errMsg}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
