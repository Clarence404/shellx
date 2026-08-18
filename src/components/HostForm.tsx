import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { useHostsStore } from "../state/hosts";
import { openConnection } from "../ipc/commands";
import { keysDiscover } from "../ipc/keys";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { HostInfo } from "../types/host";
import type { DiscoveredKey } from "../ipc/keys";

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

  // Existing hosts may have connection_mode = "tunnels_only" / "term_tunnels"
  // from earlier releases. We no longer surface a mode selector here (tunnels
  // are managed from the global Tunnels view), so just preserve whatever the
  // host was saved with; new hosts default to a terminal-only shell.
  const connectionMode = initial?.connection_mode ?? "terminal_only";

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

  // Port must be a whole number in 1..=65535 — anything else blocks save.
  const portInvalid = (() => {
    const s = port.trim();
    if (!s) return false; // emptiness is the Required check's job
    if (!/^\d+$/.test(s)) return true;
    const n = parseInt(s, 10);
    return n < 1 || n > 65535;
  })();

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
          title={t("Deselect")}
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
                placeholder={t("Filter…")}
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
                  {t("Browse…")}
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
          {t("Browse…")}
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

      {/* Basic body */}
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <Field label={t("Label")} value={label} onChange={setLabel} placeholder={t("auto-fills as user@host")} maxLength={60} />
          <Field label={t("Host")} value={host} onChange={setHost} placeholder="192.168.1.10 / example.com" required />
          <Field label={t("Port")} value={port} onChange={setPort} placeholder="22" required
            errorText={portInvalid ? t("Port must be 1–65535") : undefined} />
          <Field label={t("Username")} value={username} onChange={setUsername} placeholder="root" required />

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
              {t("Password")}
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
              {t("Key file")}
            </button>
          </div>

          {/* Public-key section */}
          {authMode === "publickey" && (
            <>
              {renderKeyPicker()}

              <Field
                label={t("Passphrase")}
                type="password"
                value={passphrase}
                onChange={setPassphrase}
                placeholder={mode === "edit" ? t("leave blank to keep current") : t("Key passphrase (optional)")}
              />

              {mode === "edit" && keychainAvailable && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-1)" }}>
                  <input
                    type="checkbox"
                    checked={forgetPassphrase}
                    onChange={(e) => setForgetPassphrase(e.target.checked)}
                  />
                  {t("Forget stored passphrase")}
                </label>
              )}
            </>
          )}

          {/* Password section */}
          {authMode === "password" && (
            <>
              <Field
                label={t("Password")}
                type="password"
                value={password}
                onChange={setPassword}
                placeholder={mode === "edit" ? t("leave blank to keep current") : t("SSH login password")}
              />

              {mode === "edit" && keychainAvailable && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-1)" }}>
                  <input
                    type="checkbox"
                    checked={forgetPassword}
                    onChange={(e) => setForgetPassword(e.target.checked)}
                  />
                  {t("Forget stored password")}
                  <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                    {t("Removes the saved password. You'll need to type it next connection.")}
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
              {t("Save this host")}
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
              {t("Remember password")}
              {!keychainAvailable && (
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                  {t("(Password storage unavailable on this system)")}
                </span>
              )}
            </label>
          )}
      </div>

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
            disabled={busy || !host.trim() || !username.trim() || !port.trim() || portInvalid}
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
  label, value, onChange, type = "text", placeholder, maxLength, required, errorText,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; maxLength?: number;
  /** Marks the label with * and shows a "Required" hint once the field
   *  has been touched and left empty. */
  required?: boolean;
  /** Extra validation message from the parent (e.g. port out of range);
   *  shown once the field has been touched. */
  errorText?: string;
}) {
  const t = useT();
  const [touched, setTouched] = useState(false);
  const missing = !!required && touched && value.trim() === "";
  const err = missing ? t("Required") : (touched ? errorText : undefined);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{
        fontSize: 11, color: "var(--text-1)", fontWeight: 500,
        textTransform: "uppercase", letterSpacing: 0.8,
      }}>
        {label}
        {required && <span style={{ color: "var(--error)" }}> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={!!err}
        style={{
          background: "var(--panel-1)",
          border: err ? "1px solid var(--error)" : "1px solid var(--border)",
          borderRadius: 4, padding: "6px 8px", fontSize: 12,
          color: "var(--text-1)",
        }}
      />
      {err && <span style={{ fontSize: 10, color: "var(--error)" }}>{err}</span>}
    </label>
  );
}
