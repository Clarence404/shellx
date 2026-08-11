import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useT } from "../i18n";
import { useHostsStore } from "../state/hosts";
import { useSessions } from "../state/sessions";
import { openConnection } from "../ipc/commands";
import { keysDiscover } from "../ipc/keys";
import { listTunnelsForHost, addTunnel, deleteTunnel, updateTunnel } from "../ipc/tunnels";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { HostInfo } from "../types/host";
import type { DiscoveredKey } from "../ipc/keys";
import type { TunnelRule } from "../types/tunnel";

type Mode = "create" | "edit";
type DoneAction = "connected" | "saved";

// Windows paths can arrive with either \ or / depending on whether they came
// from keysDiscover() (forward slashes) or from a stored DB value (whatever
// the file picker produced). Normalise before comparing.
function normPath(p: string) { return p.replace(/\\/g, "/"); }

interface Props {
  mode: Mode;
  initial?: HostInfo;
  onDone: (action: DoneAction, session?: { id: string; label: string; host_id: string | null }) => void;
  onCancel: () => void;
}

export function HostForm({ mode, initial, onDone, onCancel }: Props) {
  const keychainAvailable = useHostsStore((s) => s.keychainAvailable);
  const t = useT();
  const addHost = useHostsStore((s) => s.addHost);
  const updateHostById = useHostsStore((s) => s.updateHostById);
  const bumpRulesVersion = useSessions((s) => s.bumpRulesVersion);

  const [label, setLabel] = useState(initial?.label ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [saveHost, setSaveHost] = useState(true);
  const [rememberPassword, setRememberPassword] = useState(true);
  const [forgetPassword, setForgetPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Tab state
  const [tab, setTab] = useState<"basic" | "tunnels">("basic");

  // Connection mode state
  const [connectionMode, setConnectionMode] = useState<string>(
    initial?.connection_mode ?? "terminal_only"
  );

  // Tunnel rules state
  const [tunnelRules, setTunnelRules] = useState<TunnelRule[]>([]);
  // Pending rules buffered in create mode (written to DB after host is saved)
  const [pendingRules, setPendingRules] = useState<Array<{ id: string; label: string; local_port: number; remote_host: string; remote_port: number; bind_all: boolean }>>([]);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newLocalPort, setNewLocalPort] = useState("");
  const [newRemoteHost, setNewRemoteHost] = useState("");
  const [newRemotePort, setNewRemotePort] = useState("");
  const [newBindAll, setNewBindAll] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRuleLabel, setEditRuleLabel] = useState("");
  const [editRuleLocalPort, setEditRuleLocalPort] = useState("");
  const [editRuleRemoteHost, setEditRuleRemoteHost] = useState("");
  const [editRuleRemotePort, setEditRuleRemotePort] = useState("");
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  // Delete two-click confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  // Copy feedback state
  const [copiedRuleId, setCopiedRuleId] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  function handleCopySshCmd(ruleId: string, cmd: string) {
    void navigator.clipboard.writeText(cmd);
    setCopiedRuleId(ruleId);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setCopiedRuleId(null);
      copiedTimer.current = null;
    }, 1500);
  }
  const [importCmd, setImportCmd] = useState("");
  const [importParsed, setImportParsed] = useState<Array<{ local_port: number; remote_host: string; remote_port: number }> | null>(null);

  // Auth method state
  const [authMode, setAuthMode] = useState<"publickey" | "password">(
    initial?.auth_method === "publickey" ? "publickey" : "password"
  );
  const [selectedKeyPath, setSelectedKeyPath] = useState<string | null>(
    initial?.key_path ?? null
  );
  const [passphrase, setPassphrase] = useState("");
  const [forgetPassphrase, setForgetPassphrase] = useState(false);
  const [discoveredKeys, setDiscoveredKeys] = useState<DiscoveredKey[]>([]);
  const [keyDropdownOpen, setKeyDropdownOpen] = useState(false);
  const [keyFilter, setKeyFilter] = useState("");

  const dropdownRef = useRef<HTMLDivElement>(null);

  const supportedKeys = useMemo(
    () => discoveredKeys.filter((k) => k.kind === "supported"),
    [discoveredKeys]
  );
  const filteredKeys = useMemo(
    () => supportedKeys.filter((k) =>
      k.fileName.toLowerCase().includes(keyFilter.toLowerCase())
    ),
    [supportedKeys, keyFilter]
  );

  // Auto-fill label from username@host in create mode when both are entered
  useEffect(() => {
    if (mode === "create" && !label && username && host) {
      setLabel(`${username}@${host}`);
    }
  }, [mode, username, host, label]);

  // Discover available keys on mount in both create and edit modes.
  // In create mode: auto-switch to publickey and pre-select the best key.
  // In edit mode: just populate the picker so the user can see and change keys.
  useEffect(() => {
    keysDiscover().then((keys) => {
      setDiscoveredKeys(keys);
      if (mode === "create" && keys.length > 0) {
        // Pre-select the best key so the picker is ready if the user switches to key mode,
        // but do NOT auto-switch authMode — password is the default.
        const firstSupported = keys.find((k) => k.kind === "supported");
        if (firstSupported) setSelectedKeyPath(firstSupported.path);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load tunnel rules on mount in edit mode
  useEffect(() => {
    if (mode === "edit" && initial?.id) {
      listTunnelsForHost(initial.id).then(setTunnelRules).catch(() => {});
    }
  }, [mode, initial?.id]);

  // Click-outside to close key dropdown
  useEffect(() => {
    if (!keyDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setKeyDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [keyDropdownOpen]);

  const canRememberPw = keychainAvailable && password.length > 0;

  async function handleBrowse() {
    const p = await openDialog({
      multiple: false,
      filters: [{ name: "SSH Keys", extensions: [] }],
    });
    if (typeof p === "string") setSelectedKeyPath(p);
  }

  function parseSSHImport(cmd: string) {
    const results: Array<{ local_port: number; remote_host: string; remote_port: number }> = [];
    const re = /-L\s+(\d+):([^:\s]+):(\d+)/g;
    let m;
    while ((m = re.exec(cmd)) !== null) {
      results.push({ local_port: parseInt(m[1], 10), remote_host: m[2], remote_port: parseInt(m[3], 10) });
    }
    return results;
  }

  function handleParseImport() {
    const parsed = parseSSHImport(importCmd);
    setImportParsed(parsed.length > 0 ? parsed : []);
  }

  async function handleImportAdd() {
    if (!importParsed || importParsed.length === 0) return;
    for (const p of importParsed) {
      if (!initial?.id) {
        setPendingRules((r) => [...r, { id: `pending-${Date.now()}-${p.local_port}`, label: "", local_port: p.local_port, remote_host: p.remote_host, remote_port: p.remote_port, bind_all: false }]);
      } else {
        try {
          const rule = await addTunnel({ host_id: initial.id, label: "", local_port: p.local_port, remote_host: p.remote_host, remote_port: p.remote_port });
          setTunnelRules((r) => [...r, rule]);
          bumpRulesVersion(initial.id);
        } catch { /* skip */ }
      }
    }
    setImportCmd("");
    setImportParsed(null);
  }

  async function handleAddRule() {
    const local = parseInt(newLocalPort, 10);
    const rport = parseInt(newRemotePort, 10);
    const rhost = newRemoteHost.trim();
    if (isNaN(local) || !rhost || isNaN(rport)) return;
    if (!initial?.id) {
      setPendingRules((r) => [...r, {
        id: `pending-${Date.now()}`,
        label: newLabel.trim(),
        local_port: local,
        remote_host: rhost,
        remote_port: rport,
        bind_all: newBindAll,
      }]);
    } else {
      const rule = await addTunnel({
        host_id: initial.id,
        label: newLabel.trim(),
        local_port: local,
        remote_host: rhost,
        remote_port: rport,
        bind_all: newBindAll,
      });
      setTunnelRules((r) => [...r, rule]);
      bumpRulesVersion(initial.id);
    }
    setAddRuleOpen(false);
    setNewLabel(""); setNewLocalPort(""); setNewRemoteHost(""); setNewRemotePort(""); setNewBindAll(false);
  }

  function handleCancelAddRule() {
    setAddRuleOpen(false);
    setNewLabel(""); setNewLocalPort(""); setNewRemoteHost(""); setNewRemotePort(""); setNewBindAll(false);
  }

  // Two-click confirm: first click arms the button, second click deletes.
  function armDeleteRule(id: string) {
    if (confirmTimer.current !== null) {
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
    if (confirmDeleteId === id) {
      setConfirmDeleteId(null);
      void handleDeleteRule(id);
      return;
    }
    setConfirmDeleteId(id);
    confirmTimer.current = window.setTimeout(() => {
      setConfirmDeleteId(null);
      confirmTimer.current = null;
    }, 3000);
  }

  function disarmDeleteRule() {
    if (confirmTimer.current !== null) {
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
    setConfirmDeleteId(null);
  }

  async function handleDeleteRule(id: string) {
    if (id.startsWith("pending-")) {
      setPendingRules((r) => r.filter((x) => x.id !== id));
    } else {
      await deleteTunnel(id);
      setTunnelRules((r) => r.filter((x) => x.id !== id));
      if (initial?.id) bumpRulesVersion(initial.id);
    }
  }

  function startEditRule(rule: { id: string; label: string; local_port: number; remote_host: string; remote_port: number }) {
    setEditingRuleId(rule.id);
    setEditRuleLabel(rule.label ?? "");
    setEditRuleLocalPort(String(rule.local_port));
    setEditRuleRemoteHost(rule.remote_host);
    setEditRuleRemotePort(String(rule.remote_port));
  }

  async function handleSaveEditRule() {
    if (!editingRuleId) return;
    const local = parseInt(editRuleLocalPort, 10);
    const rport = parseInt(editRuleRemotePort, 10);
    const rhost = editRuleRemoteHost.trim();
    if (isNaN(local) || !rhost || isNaN(rport)) return;
    if (editingRuleId.startsWith("pending-")) {
      setPendingRules((r) => r.map((x) => x.id === editingRuleId
        ? { ...x, label: editRuleLabel.trim(), local_port: local, remote_host: rhost, remote_port: rport }
        : x));
    } else {
      await updateTunnel({ id: editingRuleId, label: editRuleLabel.trim(), local_port: local, remote_host: rhost, remote_port: rport });
      setTunnelRules((r) => r.map((x) => x.id === editingRuleId
        ? { ...x, label: editRuleLabel.trim(), local_port: local, remote_host: rhost, remote_port: rport }
        : x));
      if (initial?.id) bumpRulesVersion(initial.id);
    }
    setEditingRuleId(null);
  }

  async function handleToggleBindAllRule(rule: { id: string; bind_all: boolean; isPending: boolean }) {
    const newVal = !rule.bind_all;
    if (rule.isPending) {
      setPendingRules((r) => r.map((x) => x.id === rule.id ? { ...x, bind_all: newVal } : x));
    } else {
      await updateTunnel({ id: rule.id, bind_all: newVal });
      setTunnelRules((r) => r.map((x) => x.id === rule.id ? { ...x, bind_all: newVal } : x));
      if (initial?.id) bumpRulesVersion(initial.id);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === "edit" && initial) {
        if (authMode === "publickey") {
          const result = await updateHostById({
            id: initial.id,
            label, host, port: Number(port), username,
            auth_method: "publickey",
            key_path: selectedKeyPath,
            passphrase: forgetPassphrase ? null : (passphrase || undefined),
            connection_mode: connectionMode,
          });
          if (!result.password_stored) {
            setErr("Host saved, but credential storage failed. Try again or connect manually.");
            return;
          }
          onDone("saved");
        } else {
          // Password mode edit
          const result = await updateHostById({
            id: initial.id,
            label, host, port: Number(port), username,
            password: forgetPassword ? null : (password.length > 0 ? password : undefined),
            connection_mode: connectionMode,
          });
          if (!result.password_stored) {
            setErr("Host saved, but password storage failed. Try again or connect manually.");
            return;
          }
          onDone("saved");
        }
      } else {
        // Create mode
        const pn = Number(port);
        if (authMode === "publickey") {
          if (saveHost) {
            const inserted = await addHost({
              label, host, port: pn, username,
              auth_method: "publickey",
              key_path: selectedKeyPath ?? undefined,
              passphrase: passphrase || undefined,
              connection_mode: connectionMode,
            });
            if (!inserted.password_stored) {
              setErr("Host saved, but credential storage failed. Try again or connect manually.");
              return;
            }
            for (const r of pendingRules) {
              await addTunnel({ host_id: inserted.id, label: r.label, local_port: r.local_port, remote_host: r.remote_host, remote_port: r.remote_port, bind_all: r.bind_all });
            }
            const info = await openConnection({
              host, port: pn, username, password: "", label,
              host_id: inserted.id,
              auth_method: "publickey",
              key_path: selectedKeyPath ?? undefined,
              passphrase,
            });
            onDone("connected", { id: info.id, label: info.label, host_id: info.host_id });
          } else {
            const info = await openConnection({
              host, port: pn, username, password: "", label,
              auth_method: "publickey",
              key_path: selectedKeyPath ?? undefined,
              passphrase,
            });
            onDone("connected", { id: info.id, label: info.label, host_id: info.host_id });
          }
        } else {
          // Password mode create
          if (saveHost) {
            const inserted = await addHost({
              label, host, port: pn, username,
              password: (rememberPassword && canRememberPw) ? password : undefined,
              connection_mode: connectionMode,
            });
            if (!inserted.password_stored) {
              setErr("Host saved, but password storage failed. Try again or connect manually.");
              return;
            }
            for (const r of pendingRules) {
              await addTunnel({ host_id: inserted.id, label: r.label, local_port: r.local_port, remote_host: r.remote_host, remote_port: r.remote_port, bind_all: r.bind_all });
            }
            const info = await openConnection({
              host, port: pn, username, password, label,
              host_id: inserted.id,
            });
            onDone("connected", { id: info.id, label: info.label, host_id: info.host_id });
          } else {
            const info = await openConnection({
              host, port: pn, username, password, label,
            });
            onDone("connected", { id: info.id, label: info.label, host_id: info.host_id });
          }
        }
      }
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel = mode === "edit"
    ? t("Save")
    : (saveHost ? t("Save & Connect") : t("Connect"));

  const busyLabel = mode === "edit" ? t("Saving…") : t("Connecting…");

  // Render the key picker (chips or dropdown)
  function renderKeyPicker() {
    const unsupportedKeys = discoveredKeys.filter((k) => k.kind !== "supported");
    // If the currently selected path isn't in the discovered list (e.g. was
    // manually browsed or came from initial.key_path), surface it as a
    // standalone chip so the user can see something is selected.
    const selectedInList = selectedKeyPath
      ? supportedKeys.some((k) => normPath(k.path) === normPath(selectedKeyPath))
      : true;
    const externalChip = selectedKeyPath && !selectedInList ? (
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "3px 8px", fontSize: 11, borderRadius: 4,
        border: "1px solid var(--accent)",
        background: "var(--accent)", color: "var(--text-on-accent)",
      }}>
        <span>{selectedKeyPath.split(/[/\\]/).pop()}</span>
        <button
          type="button"
          onClick={() => setSelectedKeyPath(null)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
            color: "inherit", fontSize: 13, lineHeight: 1 }}
          title="取消选择"
        >×</button>
      </div>
    ) : null;

    if (supportedKeys.length >= 5) {
      // Dropdown mode for 5+ supported keys
      const selectedKey = supportedKeys.find((k) => normPath(k.path) === normPath(selectedKeyPath ?? ""));
      return (
        <div ref={dropdownRef} style={{ position: "relative" }}>
          {externalChip && <div style={{ marginBottom: 4 }}>{externalChip}</div>}
          <button
            type="button"
            onClick={() => setKeyDropdownOpen((v) => !v)}
            style={{
              width: "100%", textAlign: "left", padding: "5px 8px", fontSize: 12,
              background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 4,
              color: "var(--text-1)", cursor: "pointer",
            }}
          >
            {selectedKey?.fileName ?? "— choose a key —"}
          </button>
          {keyDropdownOpen && (
            <div style={{
              position: "absolute", zIndex: 10, top: "100%", left: 0, right: 0,
              background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4,
              boxShadow: "0 4px 12px rgba(0,0,0,0.2)", overflow: "hidden",
            }}>
              <input
                type="text"
                value={keyFilter}
                onChange={(e) => setKeyFilter(e.target.value)}
                placeholder="Filter…"
                style={{
                  width: "100%", padding: "6px 8px", fontSize: 12,
                  background: "var(--panel-1)", border: "none",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text-1)", boxSizing: "border-box",
                }}
              />
              <div style={{ maxHeight: 160, overflowY: "auto" }}>
                {filteredKeys.map((k) => (
                  <button
                    key={k.path}
                    type="button"
                    onClick={() => {
                      setSelectedKeyPath(k.path);
                      setKeyDropdownOpen(false);
                      setKeyFilter("");
                    }}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "5px 8px", fontSize: 12, border: "none", cursor: "pointer",
                      background: normPath(k.path) === normPath(selectedKeyPath ?? "") ? "var(--accent)" : "transparent",
                      color: normPath(k.path) === normPath(selectedKeyPath ?? "") ? "var(--text-on-accent)" : "var(--text-1)",
                    }}
                  >
                    {k.fileName}
                    {k.algo && (
                      <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 6 }}>{k.algo}</span>
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={async () => { await handleBrowse(); setKeyDropdownOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "5px 8px", fontSize: 12, border: "none",
                    borderTop: "1px solid var(--border)", cursor: "pointer",
                    background: "transparent", color: "var(--text-2)",
                  }}
                >
                  浏览…
                </button>
              </div>
            </div>
          )}
          {/* Disabled chips for ppk/ssh2 keys */}
          {unsupportedKeys.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {unsupportedKeys.map((k) => (
                <div
                  key={k.path}
                  role="button"
                  aria-disabled="true"
                  title={
                    k.kind === "ppk"
                      ? "PuTTY 格式 — 需转换：puttygen key.ppk -O private-openssh"
                      : "SSH2 格式 — 需转换"
                  }
                  style={{
                    opacity: 0.55, cursor: "not-allowed", padding: "3px 8px",
                    fontSize: 11, borderRadius: 4, border: "1px solid var(--border)",
                    background: "var(--panel-1)",
                  }}
                >
                  {k.fileName}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // Chips row mode for 0–4 supported keys
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {externalChip}
        {supportedKeys.map((k) => (
          <button
            key={k.path}
            type="button"
            onClick={() => setSelectedKeyPath(k.path)}
            style={{
              padding: "3px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
              border: "1px solid var(--border)",
              background: normPath(k.path) === normPath(selectedKeyPath ?? "") ? "var(--accent)" : "var(--panel-1)",
              color: normPath(k.path) === normPath(selectedKeyPath ?? "") ? "var(--text-on-accent)" : "var(--text-1)",
            }}
          >
            {k.fileName}
          </button>
        ))}
        {unsupportedKeys.map((k) => (
          <div
            key={k.path}
            role="button"
            aria-disabled="true"
            title={
              k.kind === "ppk"
                ? "PuTTY 格式 — 需转换：puttygen key.ppk -O private-openssh"
                : "SSH2 格式 — 需转换"
            }
            style={{
              opacity: 0.55, cursor: "not-allowed", padding: "3px 8px",
              fontSize: 11, borderRadius: 4, border: "1px solid var(--border)",
              background: "var(--panel-1)",
            }}
          >
            {k.fileName}
          </div>
        ))}
        <button
          type="button"
          onClick={handleBrowse}
          style={{
            padding: "3px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
            border: "1px solid var(--border)", background: "var(--panel-1)",
            color: "var(--text-2)",
          }}
        >
          浏览…
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={{
      background: "var(--panel-2)", borderRadius: 8,
      border: "1px solid var(--border)", width: 340,
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)" }}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>
          {mode === "edit" ? t("Edit host") : t("New SSH connection")}
        </h3>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["basic", "tunnels"] as const).map((tb) => (
          <button key={tb} type="button" onClick={() => setTab(tb)} style={{
            flex: 1, padding: "7px 0", fontSize: 11, textAlign: "center",
            background: "none", border: "none", cursor: "pointer",
            borderBottom: tab === tb ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === tb ? "var(--text-1)" : "var(--text-2)",
            fontWeight: tab === tb ? 600 : 400,
          }}>
            {tb === "basic" ? t("Basic") : t("Tunnels")}
          </button>
        ))}
      </div>

      {/* Basic tab */}
      {tab === "basic" && (
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <Field label={t("Label")} value={label} onChange={setLabel} placeholder={t("auto-fills as user@host")} />
          <Field label={t("Host")} value={host} onChange={setHost} />
          <Field label={t("Port")} value={port} onChange={setPort} />
          <Field label={t("Username")} value={username} onChange={setUsername} />

          {/* Auth method segmented switch */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              aria-pressed={authMode === "password"}
              onClick={() => setAuthMode("password")}
              style={{
                flex: 1, padding: "5px 8px", fontSize: 12, borderRadius: 4, cursor: "pointer",
                border: "1px solid var(--border)",
                background: authMode === "password" ? "var(--accent)" : "var(--panel-1)",
                color: authMode === "password" ? "var(--text-on-accent)" : "var(--text-2)",
                fontWeight: authMode === "password" ? 600 : 400,
              }}
            >
              密码
            </button>
            <button
              type="button"
              aria-pressed={authMode === "publickey"}
              onClick={() => setAuthMode("publickey")}
              style={{
                flex: 1, padding: "5px 8px", fontSize: 12, borderRadius: 4, cursor: "pointer",
                border: "1px solid var(--border)",
                background: authMode === "publickey" ? "var(--accent)" : "var(--panel-1)",
                color: authMode === "publickey" ? "var(--text-on-accent)" : "var(--text-2)",
                fontWeight: authMode === "publickey" ? 600 : 400,
              }}
            >
              密钥文件
            </button>
          </div>

          {/* Public-key section */}
          {authMode === "publickey" && (
            <>
              {renderKeyPicker()}

              <Field
                label="Passphrase"
                type="password"
                value={passphrase}
                onChange={setPassphrase}
                placeholder={mode === "edit" ? "留空保持不变" : ""}
              />

              {mode === "edit" && keychainAvailable && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-1)" }}>
                  <input
                    type="checkbox"
                    checked={forgetPassphrase}
                    onChange={(e) => setForgetPassphrase(e.target.checked)}
                  />
                  忘掉已保存的 passphrase
                </label>
              )}
            </>
          )}

          {/* Password section */}
          {authMode === "password" && (
            <>
              <Field
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder={mode === "edit" ? "leave blank to keep current" : ""}
              />

              {mode === "edit" && keychainAvailable && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-1)" }}>
                  <input
                    type="checkbox"
                    checked={forgetPassword}
                    onChange={(e) => setForgetPassword(e.target.checked)}
                  />
                  Forget stored password
                  <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                    Removes the saved password. You'll need to type it next connection.
                  </span>
                </label>
              )}
            </>
          )}

          {mode === "create" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-1)" }}>
              <input
                type="checkbox"
                checked={saveHost}
                onChange={(e) => setSaveHost(e.target.checked)}
              />
              Save this host
            </label>
          )}

          {mode === "create" && saveHost && authMode === "password" && (
            <label style={{
              display: "flex", alignItems: "center", gap: 8, fontSize: 11,
              color: canRememberPw ? "var(--text-1)" : "var(--text-3)",
            }}>
              <input
                type="checkbox"
                checked={rememberPassword}
                disabled={!canRememberPw}
                onChange={(e) => setRememberPassword(e.target.checked)}
              />
              Remember password
              {!keychainAvailable && (
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                  (Password storage unavailable on this system)
                </span>
              )}
            </label>
          )}
        </div>
      )}

      {/* Tunnels tab */}
      {tab === "tunnels" && (
        <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Connection mode segmented control */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 8 }}>
              {t("Connection mode")}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["terminal_only", "term_tunnels", "tunnels_only"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setConnectionMode(m)} style={{
                  flex: 1, padding: "8px 6px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                  border: "1px solid var(--border)",
                  background: connectionMode === m ? "var(--accent)" : "var(--panel-1)",
                  color: connectionMode === m ? "var(--text-on-accent)" : "var(--text-2)",
                  fontWeight: connectionMode === m ? 600 : 400,
                  transition: "background .15s, color .15s",
                }}>
                  {m === "term_tunnels" ? t("Term + Tunnels") : m === "tunnels_only" ? t("Tunnels only") : t("Terminal only")}
                </button>
              ))}
            </div>
          </div>

          {/* Port forwarding rules */}
          <div>
            {/* Section header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".7px" }}>
                  {t("Port forwarding")}
                </span>
                {(tunnelRules.length + pendingRules.length) > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-3)" }}>
                    {tunnelRules.length + pendingRules.length} {t("rules")}
                  </span>
                )}
              </div>
              {!addRuleOpen && (
                <button type="button" onClick={() => setAddRuleOpen(true)}
                  style={{ fontSize: 12, fontWeight: 500, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  + {t("Add")}
                </button>
              )}
            </div>

            {/* Import bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 6, padding: "0 10px", height: 32, marginBottom: 8 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-3)", flexShrink: 0 }}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              <input
                type="text"
                value={importCmd}
                onChange={(e) => { setImportCmd(e.target.value); setImportParsed(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleParseImport(); }}
                placeholder="Paste SSH command to import rules…"
                style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 12, color: "var(--text-1)", fontFamily: "var(--font-mono)" }}
              />
              {importCmd.trim() && (
                <button type="button" onClick={handleParseImport}
                  style={{ background: "none", border: "none", fontSize: 11, color: "var(--accent)", cursor: "pointer", padding: 0, whiteSpace: "nowrap", fontWeight: 500 }}>
                  Parse
                </button>
              )}
            </div>
            {importParsed !== null && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 8, background: importParsed.length > 0 ? "rgba(166,227,161,.08)" : "rgba(243,139,168,.08)", border: `1px solid ${importParsed.length > 0 ? "var(--success)" : "var(--error)"}`, borderRadius: 5 }}>
                <span style={{ fontSize: 11, color: importParsed.length > 0 ? "var(--success)" : "var(--error)", flex: 1, fontFamily: "var(--font-mono)" }}>
                  {importParsed.length > 0 ? importParsed.map((p) => `${p.local_port}→${p.remote_host}:${p.remote_port}`).join(", ") : "No -L rules found"}
                </span>
                {importParsed.length > 0 && (
                  <button type="button" onClick={handleImportAdd}
                    style={{ background: "none", border: "1px solid var(--success)", borderRadius: 4, color: "var(--success)", fontSize: 11, padding: "3px 10px", cursor: "pointer", fontWeight: 500 }}>
                    Add {importParsed.length > 1 ? `${importParsed.length} rules` : "rule"}
                  </button>
                )}
              </div>
            )}

            {/* Rules list */}
            {(tunnelRules.length + pendingRules.length) > 0 && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
                {[...tunnelRules.map((r) => ({ ...r, isPending: false })), ...pendingRules.map((r) => ({ ...r, enabled: false, isPending: true }))].map((rule, idx, arr) => {
                  const isEditing = editingRuleId === rule.id;
                  const isExpanded = expandedRuleId === rule.id && !isEditing;
                  const dotColor = rule.bind_all ? "var(--accent)" : ((!rule.isPending && rule.enabled) ? "var(--success)" : "var(--text-3)");
                  const sshCmd = `ssh -L ${rule.local_port}:${rule.remote_host}:${rule.remote_port} ${username || "<user>"}@${host || "<host>"}`;
                  return (
                    <div key={rule.id} style={{ borderBottom: idx < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {/* Main row — two-line layout */}
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer" }}
                        onClick={() => { if (!isEditing) setExpandedRuleId(isExpanded ? null : rule.id); }}
                      >
                        {/* Status dot */}
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 1 }} />
                        {/* Label + route stacked */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {rule.label || `Port ${rule.local_port}`}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {rule.local_port} → {rule.remote_host}:{rule.remote_port}
                          </div>
                        </div>
                        {/* Expand chevron */}
                        <span style={{ fontSize: 12, color: isExpanded ? "var(--accent)" : "var(--text-3)", transition: "transform .15s", display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "none", flexShrink: 0 }}>›</span>
                        {/* Edit button */}
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); isEditing ? setEditingRuleId(null) : startEditRule(rule); setExpandedRuleId(null); }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: isEditing ? "var(--accent)" : "var(--text-2)", flexShrink: 0, padding: "2px 3px", borderRadius: 3, display: "flex", alignItems: "center" }}><Pencil size={14} /></button>
                        {/* Delete button — two-click confirm */}
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); armDeleteRule(rule.id); }}
                          onMouseLeave={() => { if (confirmDeleteId === rule.id) disarmDeleteRule(); }}
                          title={confirmDeleteId === rule.id ? t("Click again to confirm delete") : t("Delete")}
                          style={{
                            background: confirmDeleteId === rule.id ? "rgba(243,139,168,.12)" : "none",
                            border: "none", cursor: "pointer",
                            color: confirmDeleteId === rule.id ? "var(--error)" : "var(--text-2)",
                            flexShrink: 0, padding: "2px 3px", borderRadius: 3,
                            display: "flex", alignItems: "center", gap: 4,
                          }}>
                          {confirmDeleteId === rule.id && <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>{t("Confirm?")}</span>}
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {/* Edit form */}
                      {isEditing && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 12px 10px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input value={editRuleLabel} onChange={(e) => setEditRuleLabel(e.target.value)} placeholder="Label"
                              style={{ flex: 1, fontSize: 12, padding: "5px 8px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-1)", outline: "none" }} />
                            <input value={editRuleLocalPort} onChange={(e) => setEditRuleLocalPort(e.target.value)} placeholder="Local port"
                              style={{ width: 80, fontSize: 12, padding: "5px 8px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-1)", fontFamily: "var(--font-mono)", outline: "none" }} />
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input value={editRuleRemoteHost} onChange={(e) => setEditRuleRemoteHost(e.target.value)} placeholder="Remote host"
                              style={{ flex: 1, fontSize: 12, padding: "5px 8px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-1)", fontFamily: "var(--font-mono)", outline: "none" }} />
                            <input value={editRuleRemotePort} onChange={(e) => setEditRuleRemotePort(e.target.value)} placeholder="Port"
                              style={{ width: 56, fontSize: 12, padding: "5px 8px", background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-1)", fontFamily: "var(--font-mono)", outline: "none" }} />
                            <button type="button" onClick={handleSaveEditRule}
                              style={{ padding: "5px 10px", fontSize: 12, background: "var(--accent)", color: "var(--text-on-accent)", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 600 }}>✓</button>
                            <button type="button" onClick={() => setEditingRuleId(null)}
                              style={{ padding: "5px 8px", fontSize: 12, background: "none", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer", color: "var(--text-2)" }}>✕</button>
                          </div>
                        </div>
                      )}

                      {/* Expand panel */}
                      {isExpanded && (
                        <div
                          ref={(el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
                          style={{ padding: "0 12px 10px", borderTop: "1px solid var(--border)", background: "rgba(0,0,0,.15)" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: ".5px", textTransform: "uppercase", padding: "9px 0 6px" }}>{t("SSH command")}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 5, padding: "8px 10px" }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-2)", lineHeight: 1.55, whiteSpace: "nowrap", overflowX: "auto" }}>{sshCmd}</span>
                            <button type="button" onClick={() => handleCopySshCmd(rule.id, sshCmd)}
                              style={{
                                flexShrink: 0, background: "none", borderRadius: 4, fontSize: 11, padding: "4px 9px", cursor: "pointer",
                                border: `1px solid ${copiedRuleId === rule.id ? "var(--success)" : "var(--border)"}`,
                                color: copiedRuleId === rule.id ? "var(--success)" : "var(--text-2)",
                                transition: "color .15s, border-color .15s",
                              }}>{copiedRuleId === rule.id ? "Copied" : "Copy"}</button>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                            <span style={{ fontSize: 12, color: "var(--text-2)" }}>{t("LAN sharing (0.0.0.0)")}</span>
                            <div
                              onClick={() => handleToggleBindAllRule(rule)}
                              role="switch" aria-checked={rule.bind_all}
                              style={{ width: 28, height: 16, borderRadius: 8, background: rule.bind_all ? "var(--accent)" : "var(--text-3)", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}
                            >
                              <span style={{ position: "absolute", top: 2, ...(rule.bind_all ? { right: 2 } : { left: 2 }), width: 12, height: 12, borderRadius: "50%", background: "var(--text-on-accent)", transition: "left .15s, right .15s" }} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add rule form */}
            {addRuleOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, padding: 12, background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 6 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label"
                    style={{ flex: 1, fontSize: 12, padding: "5px 8px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-1)", outline: "none" }} />
                  <input value={newLocalPort} onChange={(e) => setNewLocalPort(e.target.value)} placeholder="Local port"
                    style={{ width: 80, fontSize: 12, padding: "5px 8px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-1)", fontFamily: "var(--font-mono)", outline: "none" }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={newRemoteHost} onChange={(e) => setNewRemoteHost(e.target.value)} placeholder="Remote host"
                    style={{ flex: 1, fontSize: 12, padding: "5px 8px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-1)", fontFamily: "var(--font-mono)", outline: "none" }} />
                  <input value={newRemotePort} onChange={(e) => setNewRemotePort(e.target.value)} placeholder="Port"
                    style={{ width: 56, fontSize: 12, padding: "5px 8px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-1)", fontFamily: "var(--font-mono)", outline: "none" }} />
                  <button type="button" onClick={handleAddRule}
                    style={{ padding: "5px 10px", fontSize: 12, background: "var(--accent)", color: "var(--text-on-accent)", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 600 }}>✓</button>
                  <button type="button" onClick={handleCancelAddRule}
                    style={{ padding: "5px 8px", fontSize: 12, background: "none", color: "var(--text-3)", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer" }}>✕</button>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
                  <input type="checkbox" checked={newBindAll} onChange={(e) => setNewBindAll(e.target.checked)} />
                  {t("LAN sharing (0.0.0.0)")}
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shared footer */}
      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
        {err && <div style={{ color: "var(--error)", fontSize: 11 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ flex: 1, padding: "6px 10px", borderRadius: 5, color: "var(--text-2)" }}
          >
            {t("Cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || !host || !username}
            style={{
              flex: 1, padding: "6px 10px", borderRadius: 5,
              background: "var(--accent)", color: "var(--text-on-accent)",
              fontWeight: 600,
            }}
          >
            {busy ? busyLabel : primaryLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{
        fontSize: 11, color: "var(--text-1)", fontWeight: 500,
        textTransform: "uppercase", letterSpacing: 0.8,
      }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: "var(--panel-1)", border: "1px solid var(--border)",
          borderRadius: 4, padding: "6px 8px", fontSize: 12,
          color: "var(--text-1)",
        }}
      />
    </label>
  );
}
