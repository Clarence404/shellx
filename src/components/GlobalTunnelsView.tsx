import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Waypoints, Play, Square, Copy, Search, Plus, X, Database, Monitor, Server,
  GripVertical, Trash2, Check, Terminal, ChevronDown,
} from "lucide-react";
import { useT } from "../i18n";
import { useHostsStore } from "../state/hosts";
import { useSessions } from "../state/sessions";
import {
  listTunnelsForHost, openTunnelViaHost, closeTunnel,
  addTunnel, updateTunnel, deleteTunnel, reorderTunnels,
} from "../ipc/tunnels";
import type { TunnelRule, TunnelStatus } from "../types/tunnel";
import type { HostInfo } from "../types/host";

type EditingState =
  | { mode: "new"; presetHostId?: string }
  | { mode: "edit"; rule: TunnelRule }
  | null;

type ImportParsed = {
  local_port: number;
  remote_host: string;
  remote_port: number;
  bind_all: boolean;
};

type Props = Record<string, never>;

const EMPTY_STATUSES: TunnelStatus[] = [];

function parseSSHImport(cmd: string): ImportParsed[] {
  const results: ImportParsed[] = [];
  // Matches both 3-part (-L port:host:port) and 4-part (-L bind:port:host:port).
  const re = /-L\s+(?:([^:\s]+):)?(\d+):([^:\s]+):(\d+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    results.push({
      local_port: parseInt(m[2], 10),
      remote_host: m[3],
      remote_port: parseInt(m[4], 10),
      bind_all: m[1] === "0.0.0.0",
    });
  }
  return results;
}

export function GlobalTunnelsView(_props: Props = {} as Props) {
  void _props;
  const t = useT();
  const hosts = useHostsStore((s) => s.hosts);
  const sessions = useSessions((s) => s.sessions);
  const tunnelStatusesAll = useSessions((s) => s.tunnelStatuses);
  const rulesVersion = useSessions((s) => s.rulesVersion);
  const bumpRulesVersion = useSessions((s) => s.bumpRulesVersion);
  const [tunnelsByHost, setTunnelsByHost] = useState<Record<string, TunnelRule[]>>({});
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<EditingState>(null);
  const [importOpen, setImportOpen] = useState(false);
  // rule_id → session_id returned by tunnel_open_via_host.
  const [ruleSessions, setRuleSessions] = useState<Record<string, string>>({});
  const registerRuleSession = (ruleId: string, sid: string) =>
    setRuleSessions((s) => (s[ruleId] === sid ? s : { ...s, [ruleId]: sid }));
  const forgetRuleSession = (ruleId: string) =>
    setRuleSessions((s) => {
      if (!(ruleId in s)) return s;
      const { [ruleId]: _drop, ...rest } = s;
      return rest;
    });

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const out: Record<string, TunnelRule[]> = {};
      for (const h of hosts) {
        try {
          out[h.id] = await listTunnelsForHost(h.id);
        } catch { out[h.id] = []; }
      }
      if (!cancelled) setTunnelsByHost(out);
    }
    void loadAll();
    return () => { cancelled = true; };
  }, [hosts, rulesVersion]);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return hosts
      .map((h) => {
        const rules = (tunnelsByHost[h.id] ?? []).filter((r) => {
          if (!f) return true;
          return r.label.toLowerCase().includes(f)
            || r.remote_host.toLowerCase().includes(f)
            || String(r.local_port).includes(f);
        });
        const session = sessions.find(
          (s) => s.host_id === h.id && s.kind === "ssh" && s.state === "active"
        );
        return { host: h, rules, sessionId: session?.id ?? null };
      })
      .filter((g) => g.rules.length > 0);
  }, [hosts, tunnelsByHost, sessions, filter]);

  const totalCount = useMemo(() =>
    Object.values(tunnelsByHost).reduce((n, arr) => n + arr.length, 0),
    [tunnelsByHost],
  );
  const activeCount = useMemo(() => {
    let n = 0;
    for (const list of Object.values(tunnelStatusesAll)) {
      for (const st of list) if (st.status === "active") n += 1;
    }
    return n;
  }, [tunnelStatusesAll]);

  const drawerOpen = editing !== null;
  return (
    <div style={{
      height: "100%",
      display: "grid",
      gridTemplateColumns: drawerOpen ? "1fr 420px" : "1fr",
      transition: "grid-template-columns 180ms ease",
      background: "var(--bg)", overflow: "hidden",
    }}>
    <div style={{
      display: "flex", flexDirection: "column",
      overflow: "hidden", minWidth: 0,
    }}>
      {/* Header — every child sets flexShrink: 0 + whiteSpace: nowrap so
          Chinese labels don't wrap. flexWrap: "wrap" lets the whole
          header reflow to a second line at very narrow widths instead
          of clipping the New button off-screen. */}
      <div style={{
        padding: "10px 16px", borderBottom: "1px solid var(--border)",
        background: "var(--panel-1)",
        display: "flex", alignItems: "center", gap: 10,
        rowGap: 8, flexWrap: "wrap", flexShrink: 0,
        minWidth: 0,
      }}>
        <Waypoints size={16} style={{ color: "var(--text-2)", flexShrink: 0 }} />
        <h1 style={{
          fontSize: 15, fontWeight: 600, color: "var(--text-1)",
          flexShrink: 0, whiteSpace: "nowrap",
        }}>
          {t("Tunnels")}
        </h1>
        <span style={{
          fontSize: 11, color: "var(--text-3)",
          background: "var(--panel-2)", padding: "2px 8px", borderRadius: 999,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0, whiteSpace: "nowrap",
        }}>
          {activeCount} {t("active")} · {t("Total")} {totalCount}
        </span>
        <div style={{ flex: 1, minWidth: 8 }} />
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          height: 28, padding: "0 10px",
          border: "1px solid var(--border)", borderRadius: 6,
          background: "var(--panel-2)", color: "var(--text-3)",
          minWidth: 0,
        }}>
          <Search size={12} style={{ flexShrink: 0 }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("Search")}
            style={{
              border: "none", outline: "none", background: "transparent",
              color: "var(--text-1)", fontSize: 12, width: 140, minWidth: 60,
            }}
          />
        </div>
        <button
          onClick={() => setImportOpen((v) => !v)}
          title={t("Import from SSH command")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 28, padding: "0 12px",
            background: importOpen ? "var(--panel-2)" : "transparent",
            color: "var(--text-2)",
            border: "1px solid var(--border)", borderRadius: 6,
            cursor: "pointer", fontSize: 12,
            flexShrink: 0, whiteSpace: "nowrap",
          }}
        >
          <Terminal size={12} />
          {t("Import")}
        </button>
        <button
          onClick={() => setEditing({ mode: "new" })}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 28, padding: "0 12px",
            background: "var(--accent)", color: "var(--text-on-accent)",
            border: "none", borderRadius: 6, cursor: "pointer",
            fontSize: 12, fontWeight: 500,
            flexShrink: 0, whiteSpace: "nowrap",
          }}
        >
          <Plus size={12} strokeWidth={2.5} />
          {t("New")}
        </button>
      </div>

      {/* Import bar */}
      {importOpen && (
        <ImportBar
          hosts={hosts}
          onClose={() => setImportOpen(false)}
          onAdded={(hostId) => {
            bumpRulesVersion(hostId);
            setImportOpen(false);
          }}
        />
      )}

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 16px 24px" }}>
        {groups.length === 0 && (
          <EmptyState hasAnyTunnel={totalCount > 0} />
        )}
        {groups.map((g) => (
          <HostGroup
            key={g.host.id}
            host={g.host}
            rules={g.rules}
            sessionId={g.sessionId}
            statusesBySession={tunnelStatusesAll}
            ruleSessions={ruleSessions}
            onEditRule={(rule) => setEditing({ mode: "edit", rule })}
            onRegisterRuleSession={registerRuleSession}
            onForgetRuleSession={forgetRuleSession}
            onDeletedRule={() => bumpRulesVersion(g.host.id)}
            onLocalReorder={(nextRules) =>
              setTunnelsByHost((prev) => ({ ...prev, [g.host.id]: nextRules }))
            }
          />
        ))}
      </div>
    </div>

    {editing && (
      <EditDrawer
        state={editing}
        hosts={hosts}
        onClose={() => setEditing(null)}
        onSaved={(hostId) => {
          bumpRulesVersion(hostId);
          setEditing(null);
        }}
      />
    )}
    </div>
  );
}

function EmptyState({ hasAnyTunnel }: { hasAnyTunnel: boolean }) {
  const t = useT();
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "80px 20px", color: "var(--text-3)", fontSize: 13,
      gap: 8,
    }}>
      <Waypoints size={32} style={{ color: "var(--text-4)" }} />
      <div style={{ marginTop: 4 }}>
        {hasAnyTunnel
          ? t("No tunnels match your search")
          : t("No tunnels yet · click New to add one")}
      </div>
    </div>
  );
}

// ─── Import bar ─────────────────────────────────────────────────────────
// Lifted from the old per-host TunnelsPanel. Paste an `ssh -L …` command,
// parse it, pick a target host, add the rules in one shot.
function ImportBar({
  hosts, onClose, onAdded,
}: {
  hosts: HostInfo[];
  onClose: () => void;
  onAdded: (hostId: string) => void;
}) {
  const t = useT();
  const [cmd, setCmd] = useState("");
  const [parsed, setParsed] = useState<ImportParsed[] | null>(null);
  const [hostId, setHostId] = useState(hosts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function handleParse() {
    const p = parseSSHImport(cmd);
    setParsed(p);
    if (p.length === 0) setErr(t("No -L rules found"));
    else setErr(null);
  }

  async function handleAdd() {
    if (!parsed || parsed.length === 0 || !hostId) return;
    setBusy(true); setErr(null);
    try {
      for (const p of parsed) {
        await addTunnel({
          host_id: hostId,
          label: "",
          local_port: p.local_port,
          remote_host: p.remote_host,
          remote_port: p.remote_port,
          bind_all: p.bind_all,
        });
      }
      onAdded(hostId);
      setCmd("");
      setParsed(null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      padding: "10px 20px",
      borderBottom: "1px solid var(--border)",
      background: "var(--panel-2)",
      display: "flex", flexDirection: "column", gap: 8, flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Terminal size={12} style={{ color: "var(--text-3)" }} />
        <input
          value={cmd}
          onChange={(e) => { setCmd(e.target.value); setParsed(null); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleParse(); }}
          placeholder={t("Paste SSH command to import rules…")}
          style={{
            flex: 1, background: "var(--panel-1)",
            border: "1px solid var(--border)", borderRadius: 6,
            padding: "6px 10px", fontSize: 12, color: "var(--text-1)",
            fontFamily: "var(--font-mono)", outline: "none",
          }}
        />
        <button
          onClick={handleParse}
          disabled={!cmd.trim()}
          style={{
            padding: "6px 12px", fontSize: 12,
            background: "var(--panel-1)", color: "var(--text-2)",
            border: "1px solid var(--border)", borderRadius: 6,
            cursor: cmd.trim() ? "pointer" : "not-allowed",
            opacity: cmd.trim() ? 1 : 0.5,
          }}
        >{t("Parse")}</button>
        <button
          onClick={onClose}
          title={t("Close")}
          style={{
            width: 28, height: 28,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent", color: "var(--text-3)",
            border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer",
          }}
        ><X size={12} /></button>
      </div>
      {parsed && parsed.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 10px",
          background: "color-mix(in srgb, var(--success) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--success) 30%, transparent)",
          borderRadius: 6, fontSize: 12,
        }}>
          <span style={{ flex: 1, color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>
            {parsed.map((p) => `${p.bind_all ? "0.0.0.0:" : ""}${p.local_port}→${p.remote_host}:${p.remote_port}`).join(", ")}
          </span>
          <span style={{ color: "var(--text-3)", flexShrink: 0 }}>{t("Add to")}</span>
          <HostPicker
            hosts={hosts}
            value={hostId}
            onChange={setHostId}
            style={{ minWidth: 120, maxWidth: 220, flexShrink: 0 }}
          />
          <button
            onClick={handleAdd}
            disabled={busy || !hostId}
            style={{
              padding: "6px 12px", fontSize: 12, fontWeight: 500,
              background: "var(--success)", color: "white",
              border: "none", borderRadius: 6,
              cursor: busy ? "wait" : "pointer",
            }}
          >{busy ? t("Adding…") : `${t("Add")} ${parsed.length > 1 ? `${parsed.length} ${t("rules")}` : t("rule")}`}</button>
        </div>
      )}
      {err && (
        <div style={{
          padding: "6px 10px", fontSize: 11, color: "var(--error)",
          background: "color-mix(in srgb, var(--error) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)",
          borderRadius: 6,
        }}>{err}</div>
      )}
    </div>
  );
}

// ─── Host group with drag reorder ───────────────────────────────────────
function HostGroup({
  host, rules, sessionId, statusesBySession, ruleSessions,
  onEditRule, onRegisterRuleSession, onForgetRuleSession,
  onDeletedRule, onLocalReorder,
}: {
  host: HostInfo;
  rules: TunnelRule[];
  sessionId: string | null;
  statusesBySession: Record<string, TunnelStatus[]>;
  ruleSessions: Record<string, string>;
  onEditRule: (rule: TunnelRule) => void;
  onRegisterRuleSession: (ruleId: string, sessionId: string) => void;
  onForgetRuleSession: (ruleId: string) => void;
  onDeletedRule: () => void;
  onLocalReorder: (rules: TunnelRule[]) => void;
}) {
  const t = useT();
  const connected = sessionId !== null;
  const label = host.label || `${host.username}@${host.host}`;

  // Pointer-based drag reorder (mirrors TunnelsPanel — HTML5 DnD is
  // unreliable in WebView2 with Tauri's dragDrop enabled).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const lastDragTarget = useRef<string | null>(null);
  const rowEls = useRef<Map<string, HTMLElement>>(new Map());
  const snapshots = useRef<Map<string, number>>(new Map());
  const rulesRef = useRef<TunnelRule[]>(rules);
  rulesRef.current = rules;

  useLayoutEffect(() => {
    if (!snapshots.current.size) return;
    rowEls.current.forEach((el, id) => {
      const oldTop = snapshots.current.get(id);
      if (oldTop === undefined) return;
      const dy = oldTop - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      void el.offsetHeight;
      el.style.transition = "transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)";
      el.style.transform = "";
    });
    snapshots.current.clear();
  }, [rules]);

  function onGripPointerDown(e: React.PointerEvent, srcId: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    setDraggingId(srcId);
    lastDragTarget.current = null;

    function onMove(ev: PointerEvent) {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const row = hit?.closest<HTMLElement>("[data-rule-id]");
      const targetId = row?.dataset.ruleId ?? null;
      if (!targetId) return;
      // Only allow reordering within the same host group.
      if (!rulesRef.current.some((r) => r.id === targetId)) return;
      if (targetId === srcId) {
        lastDragTarget.current = null;
        setDragOverId(null);
        return;
      }
      if (targetId === lastDragTarget.current) return;
      lastDragTarget.current = targetId;
      setDragOverId(targetId);
      snapshots.current.clear();
      rowEls.current.forEach((el, id) => {
        snapshots.current.set(id, el.getBoundingClientRect().top);
      });
      const prev = rulesRef.current;
      const si = prev.findIndex((r) => r.id === srcId);
      const ti = prev.findIndex((r) => r.id === targetId);
      if (si === -1 || ti === -1) return;
      const next = [...prev];
      const [item] = next.splice(si, 1);
      next.splice(ti, 0, item);
      onLocalReorder(next);
    }

    async function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDraggingId(null);
      setDragOverId(null);
      lastDragTarget.current = null;
      try {
        await reorderTunnels(host.id, rulesRef.current.map((r) => r.id));
      } catch { /* non-fatal */ }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px 8px",
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: connected ? "var(--success)" : "var(--text-4)",
          boxShadow: connected ? "0 0 0 2px color-mix(in srgb, var(--success) 25%, transparent)" : "none",
        }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
          · {rules.length} {t("tunnel")}
          {!connected && ` · ${t("host offline")}`}
        </span>
      </div>
      <div>
        {rules.map((rule) => {
          const attachedSid = ruleSessions[rule.id] ?? sessionId;
          const status = attachedSid
            ? statusesBySession[attachedSid]?.find((st) => st.rule_id === rule.id)
            : undefined;
          return (
            <TunnelCard
              key={rule.id}
              rule={rule}
              host={host}
              sessionId={attachedSid}
              status={status}
              isDragging={draggingId === rule.id}
              isDragOver={dragOverId === rule.id && draggingId !== rule.id}
              onGripPointerDown={(e) => onGripPointerDown(e, rule.id)}
              rowRef={(el) => {
                if (el) rowEls.current.set(rule.id, el);
                else rowEls.current.delete(rule.id);
              }}
              onEdit={() => onEditRule(rule)}
              onRegisterRuleSession={onRegisterRuleSession}
              onForgetRuleSession={onForgetRuleSession}
              onDeleted={() => onDeletedRule()}
            />
          );
        })}
      </div>
    </div>
  );
}

// Deterministic badge colour so each rule keeps a stable identity as the
// list is filtered / re-sorted. Hash the rule id to a small palette.
const BADGE_COLORS = ["#4C7CFF", "#EC4899", "#14B8A6", "#F97316", "#8B5CF6", "#F59E0B"];
function badgeColorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return BADGE_COLORS[Math.abs(h) % BADGE_COLORS.length];
}

function TunnelCard({
  rule, host, sessionId, status, isDragging, isDragOver,
  onGripPointerDown, rowRef,
  onEdit, onRegisterRuleSession, onForgetRuleSession, onDeleted,
}: {
  rule: TunnelRule;
  host: HostInfo;
  sessionId: string | null;
  status: TunnelStatus | undefined;
  isDragging: boolean;
  isDragOver: boolean;
  onGripPointerDown: (e: React.PointerEvent) => void;
  rowRef: (el: HTMLElement | null) => void;
  onEdit: () => void;
  onRegisterRuleSession: (ruleId: string, sessionId: string) => void;
  onForgetRuleSession: (ruleId: string) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const isRunning = status?.status === "active";
  const isError = status?.status === "error";
  const badgeColor = badgeColorFor(rule.id);
  const bind = rule.bind_all ? "0.0.0.0" : "127.0.0.1";
  const via = host.label || host.host;
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
  }, []);

  function armDelete() {
    setConfirmDelete(true);
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => {
      setConfirmDelete(false);
      confirmTimer.current = null;
    }, 3000);
  }
  function disarmDelete() {
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
    setConfirmDelete(false);
  }

  async function handleStart() {
    setLocalErr(null);
    setBusy(true);
    try {
      const { session_id } = await openTunnelViaHost({
        host_id: rule.host_id,
        rule_id: rule.id,
        local_port: rule.local_port,
        remote_host: rule.remote_host,
        remote_port: rule.remote_port,
        bind_all: rule.bind_all,
      });
      onRegisterRuleSession(rule.id, session_id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalErr(msg);
      console.error("Failed to start tunnel:", e);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (!sessionId) return;
    setLocalErr(null);
    setBusy(true);
    try {
      await closeTunnel(sessionId, rule.id);
      onForgetRuleSession(rule.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalErr(msg);
      console.error("Failed to stop tunnel:", e);
    }
    finally { setBusy(false); }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(`${bind}:${rule.local_port}`);
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimer.current = null;
    }, 1400);
  }

  async function handleConfirmDelete() {
    disarmDelete();
    setBusy(true);
    try {
      if (isRunning && sessionId) {
        try { await closeTunnel(sessionId, rule.id); } catch { /* best-effort */ }
        onForgetRuleSession(rule.id);
      }
      await deleteTunnel(rule.id);
      onDeleted();
    } catch (e: unknown) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div
      ref={rowRef}
      data-rule-id={rule.id}
      onClick={onEdit}
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12,
        padding: "12px 14px", margin: "4px 0",
        background: "var(--panel-1)",
        border: `1px solid ${(isRunning || isError) ? (isRunning ? "var(--success)" : "var(--error)") : (isDragOver ? "var(--accent)" : "var(--border)")}`,
        borderRadius: 10, cursor: "pointer",
        userSelect: "none",
        transition: "opacity 0.18s ease, box-shadow 0.18s ease, background 0.18s ease",
        ...(isDragging ? {
          opacity: 0.55,
          boxShadow: "0 6px 24px rgba(0,0,0,0.32), 0 1px 6px rgba(0,0,0,0.18)",
          zIndex: 10,
        } : isDragOver ? {
          background: "color-mix(in srgb, var(--accent) 6%, var(--panel-1))",
        } : {}),
      }}
    >
      {/* Grip */}
      <div
        onPointerDown={onGripPointerDown}
        onClick={(e) => e.stopPropagation()}
        title={t("Drag to reorder")}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-4)", cursor: "grab", touchAction: "none",
          padding: "0 2px", flexShrink: 0,
        }}
      >
        <GripVertical size={14} />
      </div>

      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: badgeColor, color: "white",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 14, flexShrink: 0,
      }}>L</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 13, fontWeight: 600, color: "var(--text-1)",
          marginBottom: 4, minWidth: 0,
        }}>
          <span style={{
            flex: 1, minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{rule.label || `${rule.remote_host}:${rule.remote_port}`}</span>
          <StatusPill status={status} />
        </div>
        <div style={{
          fontSize: 11, color: "var(--text-3)",
          fontFamily: "var(--font-mono)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          <span style={{ color: "var(--text-2)" }}>{bind}:{rule.local_port}</span>
          <span style={{ color: "var(--text-4)" }}> → </span>
          <span style={{ color: "var(--accent)" }}>via {via}</span>
          <span style={{ color: "var(--text-4)" }}> → </span>
          <span style={{ color: "var(--text-2)" }}>{rule.remote_host}:{rule.remote_port}</span>
        </div>
      </div>
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseLeave={disarmDelete}
        style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
      >
        {isRunning ? (
          <IconButton primary onClick={handleStop} disabled={busy} title={t("Stop")}>
            <Square size={12} fill="currentColor" />
          </IconButton>
        ) : (
          <IconButton
            onClick={handleStart}
            disabled={busy}
            title={t("Start")}
          >
            <Play size={12} fill="currentColor" />
          </IconButton>
        )}
        <IconButton
          onClick={handleCopy}
          title={copied ? t("Copied") : t("Copy local address")}
          tone={copied ? "success" : undefined}
        >
          {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} />}
        </IconButton>
        {confirmDelete && (
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={busy}
            style={{
              height: 30, padding: "0 10px",
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "var(--error)", color: "white",
              border: "1px solid var(--error)", borderRadius: 6,
              fontSize: 12, fontWeight: 500,
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {t("Confirm delete")}
          </button>
        )}
        <IconButton
          onClick={confirmDelete ? disarmDelete : armDelete}
          disabled={busy}
          title={confirmDelete ? t("Cancel") : t("Delete")}
          tone={confirmDelete ? "danger" : undefined}
        >
          {confirmDelete ? <X size={12} /> : <Trash2 size={12} />}
        </IconButton>
      </div>
      {(localErr || (isError && status?.error)) && (
        <div style={{
          flexBasis: "100%",
          fontSize: 11, color: "var(--error)",
          marginTop: 6, padding: "6px 10px",
          background: "color-mix(in srgb, var(--error) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)",
          borderRadius: 6,
        }}>
          {localErr || status?.error}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: TunnelStatus | undefined }) {
  const t = useT();
  const base = {
    padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 500,
    display: "inline-flex", alignItems: "center", gap: 4,
    whiteSpace: "nowrap", flexShrink: 0,
  } as const;
  if (!status) {
    return (
      <span style={{ ...base, background: "var(--panel-2)", color: "var(--text-3)" }}>
        <Dot color="var(--text-4)" />
        {t("Stopped")}
      </span>
    );
  }
  if (status.status === "active") {
    return (
      <span style={{ ...base, background: "color-mix(in srgb, var(--success) 15%, transparent)", color: "var(--success)" }}>
        <Dot color="var(--success)" />
        {t("Running")}
      </span>
    );
  }
  if (status.status === "error") {
    return (
      <span style={{ ...base, background: "color-mix(in srgb, var(--error) 15%, transparent)", color: "var(--error)" }}>
        <Dot color="var(--error)" />
        {t("Failed")}
      </span>
    );
  }
  return (
    <span style={{ ...base, background: "var(--panel-2)", color: "var(--text-3)" }}>
      <Dot color="var(--text-4)" />
      {t("Stopped")}
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />;
}

function IconButton({
  children, onClick, title, disabled, primary, tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  primary?: boolean;
  tone?: "success" | "danger";
}) {
  const borderColor = tone === "success" ? "var(--success)"
    : tone === "danger" ? "var(--error)"
    : primary ? "var(--accent)" : "var(--border)";
  const background = tone === "success"
    ? "color-mix(in srgb, var(--success) 12%, var(--panel-1))"
    : tone === "danger"
    ? "color-mix(in srgb, var(--error) 12%, var(--panel-1))"
    : primary ? "var(--accent)" : "var(--panel-1)";
  const color = tone === "success" ? "var(--success)"
    : tone === "danger" ? "var(--error)"
    : primary ? "var(--text-on-accent)" : "var(--text-2)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 30, height: 30,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${borderColor}`,
        background, color,
        borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

// ─── Edit drawer ─────────────────────────────────────────────────────────
function EditDrawer({
  state, hosts, onClose, onSaved,
}: {
  state: NonNullable<EditingState>;
  hosts: HostInfo[];
  onClose: () => void;
  onSaved: (hostId: string) => void;
}) {
  const t = useT();
  const isEdit = state.mode === "edit";
  const initial = isEdit ? state.rule : null;

  const [label, setLabel] = useState(initial?.label ?? "");
  const [localPort, setLocalPort] = useState(String(initial?.local_port ?? ""));
  const [bindAll, setBindAll] = useState(initial?.bind_all ?? false);
  const [hostId, setHostId] = useState<string>(() => {
    if (initial?.host_id) return initial.host_id;
    if (state.mode === "new" && state.presetHostId) return state.presetHostId;
    return hosts[0]?.id ?? "";
  });
  const [remoteHost, setRemoteHost] = useState(initial?.remote_host ?? "");
  const [remotePort, setRemotePort] = useState(String(initial?.remote_port ?? ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const viaHost = hosts.find((h) => h.id === hostId) ?? null;

  function validate(): string | null {
    if (!hostId) return t("Please select an SSH host");
    const lp = parseInt(localPort, 10);
    if (Number.isNaN(lp) || lp <= 0 || lp > 65535) return t("Invalid local port");
    if (!remoteHost.trim()) return t("Destination host is required");
    const rp = parseInt(remotePort, 10);
    if (Number.isNaN(rp) || rp <= 0 || rp > 65535) return t("Invalid destination port");
    return null;
  }

  async function handleSave() {
    const problem = validate();
    if (problem) { setErr(problem); return; }
    setErr(null); setBusy(true);
    try {
      if (state.mode === "new") {
        await addTunnel({
          host_id: hostId,
          label: label.trim() || `${remoteHost}:${remotePort}`,
          local_port: parseInt(localPort, 10),
          remote_host: remoteHost.trim(),
          remote_port: parseInt(remotePort, 10),
          bind_all: bindAll,
        });
      } else {
        const hostChanged = hostId !== state.rule.host_id;
        await updateTunnel({
          id: state.rule.id,
          host_id: hostChanged ? hostId : undefined,
          label: label.trim() || undefined,
          local_port: parseInt(localPort, 10),
          remote_host: remoteHost.trim(),
          remote_port: parseInt(remotePort, 10),
          bind_all: bindAll,
        });
        // If the rule moved to a different host, the previous host's
        // rule list also needs to be refetched.
        if (hostChanged) onSaved(state.rule.host_id);
      }
      onSaved(hostId);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      background: "var(--panel-1)",
      borderLeft: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 18px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 10,
        flexShrink: 0,
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 6,
          background: "var(--accent)", color: "white",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 12,
        }}>L</div>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", flex: 1 }}>
          {isEdit ? t("Edit tunnel") : t("New tunnel")}
        </h2>
        <button
          onClick={onClose}
          style={{
            width: 26, height: 26, borderRadius: 6,
            background: "transparent", border: "none",
            color: "var(--text-3)", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "18px 20px 24px" }}>
        <FlowDiagram
          localPort={localPort}
          viaLabel={viaHost ? (viaHost.label || viaHost.host) : ""}
          viaSelected={viaHost !== null}
          remoteHost={remoteHost}
          remotePort={remotePort}
        />

        <Section title={t("Basic")} />
        <Field label={t("Label")}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("e.g. RDS Postgres")}
            style={inputStyle}
          />
        </Field>

        <Section title={t("Local")} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label={t("Local port")}>
            <input
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              placeholder="e.g. 15432"
              style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
            />
          </Field>
          <Field label={t("Bind address")}>
            <select
              value={bindAll ? "0.0.0.0" : "127.0.0.1"}
              onChange={(e) => setBindAll(e.target.value === "0.0.0.0")}
              style={inputStyle}
            >
              <option value="127.0.0.1">127.0.0.1 · {t("localhost only")}</option>
              <option value="0.0.0.0">0.0.0.0 · {t("share on LAN")}</option>
            </select>
          </Field>
        </div>

        <Section title={t("Via SSH host")} />
        <Field label="">
          <HostPicker
            hosts={hosts}
            value={hostId}
            onChange={setHostId}
          />
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
            {t("Pick which SSH host this tunnel forwards through")}
          </div>
        </Field>

        <Section title={t("Destination")} />
        <Field label={t("Destination host")}>
          <input
            value={remoteHost}
            onChange={(e) => setRemoteHost(e.target.value)}
            placeholder="e.g. rds-internal.example.com"
            style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
          />
        </Field>
        <Field label={t("Destination port")}>
          <input
            value={remotePort}
            onChange={(e) => setRemotePort(e.target.value)}
            placeholder="e.g. 5432"
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", maxWidth: 160 }}
          />
        </Field>

        {err && (
          <div style={{
            marginTop: 14, padding: "8px 10px",
            background: "color-mix(in srgb, var(--error) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 40%, transparent)",
            color: "var(--error)", borderRadius: 6, fontSize: 12,
          }}>{err}</div>
        )}

        <div style={{
          display: "flex", gap: 10, marginTop: 22,
          paddingTop: 18, borderTop: "1px solid var(--border)",
        }}>
          <button
            onClick={handleSave}
            disabled={busy}
            style={{
              flex: 1, padding: "8px 14px",
              background: "var(--accent)", color: "var(--text-on-accent)",
              border: "none", borderRadius: 6, fontSize: 13, fontWeight: 500,
              cursor: busy ? "wait" : "pointer",
            }}
          >{busy ? t("Saving…") : t("Save")}</button>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              padding: "8px 14px",
              background: "var(--panel-2)", color: "var(--text-2)",
              border: "1px solid var(--border)", borderRadius: 6, fontSize: 13,
              cursor: "pointer",
            }}
          >{t("Cancel")}</button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: 13,
  background: "var(--panel-2)", color: "var(--text-1)",
  border: "1px solid var(--border)", borderRadius: 6,
  outline: "none", fontFamily: "inherit",
};

function Section({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 11, color: "var(--text-3)",
      textTransform: "uppercase", letterSpacing: 0.4,
      margin: "18px 0 8px", fontWeight: 500,
    }}>{title}</div>
  );
}

// Custom dropdown for SSH host selection. Native <select> popups always
// expand to fit the longest option — a 60-char host label would blow
// the dropdown out of the 420 px drawer. This one anchors the popup to
// the trigger's width and ellipsizes long labels with a hover title
// for the full text.
function HostPicker({
  hosts, value, onChange, style,
}: {
  hosts: HostInfo[];
  value: string;
  onChange: (id: string) => void;
  style?: React.CSSProperties;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = hosts.find((h) => h.id === value) ?? null;
  const displayFor = (h: HostInfo | null): string =>
    h ? (h.label || `${h.username}@${h.host}`) : t("Pick SSH host");

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={selected ? displayFor(selected) : undefined}
        style={{
          width: "100%", boxSizing: "border-box",
          display: "flex", alignItems: "center", gap: 6,
          padding: "7px 10px", fontSize: 13,
          background: "var(--panel-2)", color: "var(--text-1)",
          border: "1px solid var(--border)", borderRadius: 6,
          outline: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{
          flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{displayFor(selected)}</span>
        <ChevronDown size={14} style={{
          color: "var(--text-3)", flexShrink: 0,
          transform: open ? "rotate(180deg)" : undefined,
          transition: "transform 0.15s ease",
        }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", zIndex: 20, top: "calc(100% + 4px)",
          left: 0, right: 0,
          background: "var(--panel-1)",
          border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
          maxHeight: 240, overflowY: "auto",
        }}>
          {hosts.length === 0 && (
            <div style={{
              padding: "10px 12px", fontSize: 12, color: "var(--text-3)",
            }}>{t("No hosts")}</div>
          )}
          {hosts.map((h) => {
            const raw = displayFor(h);
            const isActive = h.id === value;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => { onChange(h.id); setOpen(false); }}
                title={raw}
                style={{
                  display: "block", width: "100%", boxSizing: "border-box",
                  padding: "7px 10px", fontSize: 12,
                  background: isActive ? "var(--accent)" : "transparent",
                  color: isActive ? "var(--text-on-accent)" : "var(--text-1)",
                  border: "none", cursor: "pointer", textAlign: "left",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >{raw}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      {label && (
        <label style={{
          display: "block", fontSize: 11, color: "var(--text-3)",
          marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4,
        }}>{label}</label>
      )}
      {children}
    </div>
  );
}

function FlowDiagram({
  localPort, viaLabel, viaSelected, remoteHost, remotePort,
}: {
  localPort: string;
  /** Display label for the SSH via-host — shown in the middle node.
   *  When `viaSelected` is false this is treated as a placeholder. */
  viaLabel: string;
  viaSelected: boolean;
  remoteHost: string;
  remotePort: string;
}) {
  const t = useT();
  const truncate = (s: string, n = 14) => s.length > n ? s.slice(0, n - 2) + "…" : s;
  return (
    <div style={{
      background: "var(--panel-2)", borderRadius: 10,
      padding: "16px 12px 12px", marginBottom: 16,
      display: "flex", flexDirection: "column", gap: 12,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", position: "relative",
      }}>
        <FlowNode
          icon={<Monitor size={20} />}
          label={t("Local")}
          sub={localPort ? `:${localPort}` : "…"}
          tint="var(--accent-fade)"
          color="var(--accent)"
        />
        <FlowNode
          icon={<Server size={20} />}
          label={viaSelected ? truncate(viaLabel) : t("Pick SSH host")}
          sub=""
          tint={viaSelected
            ? "color-mix(in srgb, var(--accent) 12%, transparent)"
            : "var(--panel-1)"}
          color={viaSelected ? "var(--accent)" : "var(--text-3)"}
        />
        <FlowNode
          icon={<Database size={20} />}
          label={remoteHost ? truncate(remoteHost) : t("Target")}
          sub={remotePort ? `:${remotePort}` : "…"}
          tint="var(--panel-1)"
          color="var(--text-2)"
        />
        <svg
          viewBox="0 0 320 100"
          preserveAspectRatio="none"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            pointerEvents: "none",
          }}
        >
          {/* Encrypted tunnel arc: local → via → target */}
          <path d="M 42 42 C 42 88, 100 96, 160 96 C 220 96, 278 88, 278 42"
            stroke="var(--success)" strokeWidth="1.75" fill="none" strokeDasharray="4 3" />
        </svg>
      </div>
      <div style={{
        fontSize: 10, color: "var(--text-3)",
        fontFamily: "var(--font-mono)", textAlign: "center",
        paddingTop: 4,
      }}>
        {t("SSH encrypted tunnel")}
      </div>
    </div>
  );
}

function FlowNode({
  icon, label, sub, tint, color,
}: {
  icon: React.ReactNode; label: string; sub: string;
  tint: string; color: string;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", gap: 4, zIndex: 2,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: tint, color, display: "inline-flex",
        alignItems: "center", justifyContent: "center",
        border: "1px solid color-mix(in srgb, currentColor 15%, transparent)",
      }}>{icon}</div>
      <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
        {label}{sub}
      </span>
    </div>
  );
}
