import { useState } from "react";
import { TriangleAlert, ChevronRight, ChevronDown } from "lucide-react";
import { useFtpStore } from "../state/ftp";
import { useHostsStore } from "../state/hosts";
import { KeyPicker } from "./KeyPicker";
import type {
  FtpAuthMethod, FtpCharset, FtpHost, FtpProtocol, FtpTlsMode,
} from "../types/ftp";
import { useT } from "../i18n";

interface Props {
  /** Editing an existing row, or null to create one. */
  initial?: FtpHost | null;
  onCancel: () => void;
  onDone: (id: string) => void;
}

/** What "Encryption" shows for the FTP family. FTPS is not a third
 *  protocol here — it is FTP with TLS, which is also the truth on the
 *  wire, and the shape WinSCP presents (File protocol + Encryption). */
type Encryption = "none" | "explicit" | "implicit";

function defaultPortFor(p: FtpProtocol, tls: FtpTlsMode): number {
  if (p === "sftp") return 22;
  if (p === "ftps" && tls === "implicit") return 990;
  return 21;
}

/**
 * WinSCP-shaped connection form: protocol + encryption dropdowns up
 * top, the four essentials (host, port, user, password) as two rows,
 * and everything that is usually right by default — name, transfer
 * mode, filename encoding, key authentication — folded into an
 * Advanced section. Every choice is a dropdown; the only buttons are
 * Save and Cancel.
 */
export function FtpHostForm({ initial, onCancel, onDone }: Props) {
  const t = useT();
  const editing = !!initial;
  const [protocol, setProtocol] = useState<FtpProtocol>(initial?.protocol ?? "ftp");
  const [tlsMode, setTlsMode] = useState<FtpTlsMode>(initial?.tls_mode ?? "explicit");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 21));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [charset, setCharset] = useState<FtpCharset>(initial?.charset ?? "auto");
  const [passive, setPassive] = useState(initial?.passive ?? true);
  const [authMethod, setAuthMethod] = useState<FtpAuthMethod>(initial?.auth_method ?? "password");
  const [keyPath, setKeyPath] = useState(initial?.key_path ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [forgetPassword, setForgetPassword] = useState(false);
  const [forgetPassphrase, setForgetPassphrase] = useState(false);
  const keychainAvailable = useHostsStore((st) => st.keychainAvailable);
  const [anonymous, setAnonymous] = useState(
    initial?.protocol !== "sftp" && initial?.username === "anonymous",
  );
  // Open by default: folding it saved seven rows of pixels and cost a
  // click every time someone wanted the name or the encoding.
  const [showAdv, setShowAdv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const family: "ftp" | "sftp" = protocol === "sftp" ? "sftp" : "ftp";
  const encryption: Encryption = protocol === "ftp" ? "none" : tlsMode;

  // Any protocol/encryption change moves the port with it, unless the
  // user already typed one that is not simply the previous default.
  function apply(nextProtocol: FtpProtocol, nextTls: FtpTlsMode) {
    setPort((current) =>
      current === String(defaultPortFor(protocol, tlsMode))
        ? String(defaultPortFor(nextProtocol, nextTls))
        : current,
    );
    setProtocol(nextProtocol);
    setTlsMode(nextTls);
  }

  function pickFamily(next: "ftp" | "sftp") {
    if (next === family) return;
    if (next === "sftp" && anonymous) {
      setAnonymous(false);
      setUsername("");
    }
    apply(next === "sftp" ? "sftp" : "ftp", tlsMode);
  }

  function pickEncryption(next: Encryption) {
    if (next === "none") apply("ftp", "explicit");
    else apply("ftps", next);
  }

  function toggleAnonymous(on: boolean) {
    setAnonymous(on);
    if (on) {
      setUsername("anonymous");
      setPassword("");
    } else if (username === "anonymous") {
      setUsername("");
    }
  }

  const usesKey = protocol === "sftp" && authMethod === "publickey";
  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
  const canSave =
    !!host.trim() && !!username.trim() && portValid && !busy && (!usesKey || !!keyPath.trim());

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setErr(null);
    try {
      const name = label.trim() || `${username.trim()}@${host.trim()}`;
      const common = {
        label: name, protocol, host: host.trim(), port: portNum,
        username: username.trim(), charset, passive,
        auth_method: authMethod,
        key_path: usesKey ? keyPath.trim() : null,
        tls_mode: tlsMode,
      };
      // Secrets are omitted rather than sent empty: an empty string
      // would overwrite what is already in the keychain. An explicit
      // null (the Forget checkboxes, edit mode only) deletes it —
      // same semantics as the host form.
      if (editing && initial) {
        await useFtpStore.getState().updateHost({
          id: initial.id,
          ...common,
          ...(forgetPassword ? { password: null } : password ? { password } : {}),
          ...(forgetPassphrase ? { passphrase: null } : passphrase ? { passphrase } : {}),
        });
        onDone(initial.id);
      } else {
        onDone((await useFtpStore.getState().addHost({
          ...common,
          ...(password ? { password } : {}),
          ...(passphrase ? { passphrase } : {}),
        })).id);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 344, padding: "16px 18px",
        background: "var(--panel-2)", border: "1px solid var(--border)",
        borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        maxHeight: "86vh", overflowY: "auto",
      }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        {editing ? t("Edit connection") : t("New FTP connection")}
      </h3>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Field label={t("File protocol")}>
            <Select
              label={t("File protocol")}
              value={family}
              onChange={(v) => pickFamily(v as "ftp" | "sftp")}
              options={[["ftp", "FTP"], ["sftp", "SFTP"]]}
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Field label={t("Encryption")}>
            {family === "sftp" ? (
              <Select
                label={t("Encryption")}
                value="ssh"
                options={[["ssh", t("SSH (always encrypted)")]]}
                disabled
              />
            ) : (
              <Select
                label={t("Encryption")}
                value={encryption}
                onChange={(v) => pickEncryption(v as Encryption)}
                options={[
                  ["none", t("No encryption")],
                  ["explicit", t("Explicit TLS (FTPS · 21)")],
                  ["implicit", t("Implicit TLS (FTPS · 990)")],
                ]}
              />
            )}
          </Field>
        </div>
      </div>

      {protocol === "ftp" && (
        <Banner tone="warn" icon={<TriangleAlert size={12} strokeWidth={2} />}>
          {t("FTP is not encrypted: the password and every byte travel in the clear. Use it only on a network you trust.")}
        </Banner>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Field label={t("Host")}>
            <Input value={host} onChange={setHost} placeholder="10.20.1.40" />
          </Field>
        </div>
        <div style={{ width: 88 }}>
          <Field label={t("Port")}>
            <Input value={port} onChange={setPort} invalid={!portValid} />
          </Field>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Field label={t("Username")}>
            <Input
              value={username}
              onChange={setUsername}
              placeholder="ftpuser"
              disabled={anonymous}
            />
          </Field>
        </div>
        {/* A key replaces the password — the field leaves rather than
            sitting there disabled; the key inputs live under Advanced. */}
        {!usesKey && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <Field label={t("Password")}>
              <Input
                value={password}
                onChange={setPassword}
                type="password"
                disabled={anonymous || forgetPassword}
                placeholder={editing && !anonymous ? t("leave blank to keep the stored one") : ""}
              />
            </Field>
          </div>
        )}
      </div>

      {!keychainAvailable && (
        <div style={{ fontSize: 10, color: "var(--text-3)", margin: "-4px 0 8px" }}>
          {t("(Password storage unavailable on this system)")}
        </div>
      )}

      {editing && keychainAvailable && !usesKey && !anonymous && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11, marginBottom: 10, color: "var(--text-1)" }}>
          <input
            type="checkbox"
            checked={forgetPassword}
            onChange={(e) => setForgetPassword(e.target.checked)}
            style={{ marginTop: 1, flexShrink: 0 }}
          />
          {/* Same two-line layout as the host form's row. */}
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ whiteSpace: "nowrap" }}>{t("Forget stored password")}</span>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>
              {t("Removes the saved password. You'll need to type it next connection.")}
            </span>
          </span>
        </label>
      )}

      {family === "ftp" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => toggleAnonymous(e.target.checked)}
          />
          {t("Anonymous login")}
        </label>
      )}

      <button
        type="button"
        aria-expanded={showAdv}
        onClick={() => setShowAdv((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          width: "100%", padding: "7px 0 6px", marginBottom: showAdv ? 4 : 8,
          background: "transparent", border: "none",
          borderTop: "1px solid var(--border)",
          fontSize: 12, color: "var(--accent)", cursor: "pointer",
        }}>
        {showAdv ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t("Advanced settings")}
        {!showAdv && (
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>
            {family === "ftp"
              ? ` · ${t("Name")} / ${t("Transfer mode")} / ${t("Filename encoding")}`
              : ` · ${t("Name")} / ${t("Authentication")}`}
          </span>
        )}
      </button>

      {showAdv && (
        <>
          <Field label={t("Name")}>
            <Input value={label} onChange={setLabel} placeholder={t("auto-fills as user@host")} />
          </Field>

          {family === "ftp" && (
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label={t("Transfer mode")}>
                  <Select
                    label={t("Transfer mode")}
                    value={passive ? "passive" : "active"}
                    onChange={(v) => setPassive(v === "passive")}
                    options={[
                      ["passive", t("Passive (PASV)")],
                      ["active", t("Active (PORT)")],
                    ]}
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label={t("Filename encoding")}>
                  <Select
                    label={t("Filename encoding")}
                    value={charset}
                    onChange={(v) => setCharset(v as FtpCharset)}
                    options={[["auto", t("Auto")], ["utf8", "UTF-8"], ["gbk", "GBK"]]}
                  />
                </Field>
              </div>
            </div>
          )}

          {family === "sftp" && (
            <>
              <Field label={t("Authentication")}>
                <Select
                  label={t("Authentication")}
                  value={authMethod}
                  onChange={(v) => setAuthMethod(v as FtpAuthMethod)}
                  options={[["password", t("Password")], ["publickey", t("Key file…")]]}
                />
              </Field>
              {usesKey && (
                <>
                  <Field label={t("Private key")}>
                    <KeyPicker
                      value={keyPath || null}
                      onChange={(p) => setKeyPath(p ?? "")}
                      autoPreselect={!editing}
                    />
                  </Field>
                  <Field label={t("Key passphrase")}>
                    <Input
                      value={passphrase}
                      onChange={setPassphrase}
                      type="password"
                      disabled={forgetPassphrase}
                      placeholder={editing
                        ? t("leave blank to keep the stored one")
                        : t("leave blank if the key has none")}
                    />
                  </Field>
                  {editing && keychainAvailable && (
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, marginBottom: 9, color: "var(--text-1)" }}>
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
            </>
          )}
        </>
      )}

      {err && <div style={{ fontSize: 11, color: "var(--error)", marginBottom: 8 }}>{err}</div>}

      {/* House rule for dialogs: Cancel left, the primary action right. */}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            flex: 1, height: 28, borderRadius: 5, fontSize: 12,
            border: "1px solid var(--border-hi)", background: "transparent",
            color: "var(--text-2)",
          }}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void handleSave()}
          style={{
            flex: 1, height: 28, borderRadius: 5, border: "none",
            background: canSave ? "var(--accent)" : "var(--panel-1)",
            color: canSave ? "var(--text-on-accent)" : "var(--text-3)",
            fontSize: 12, fontWeight: 600,
          }}>
          {busy ? `${t("Saving")}…` : t("Save")}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginBottom: 3 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({ label, value, onChange, options, disabled }: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  options: [string, string][];
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
      style={{
        width: "100%", height: 26, borderRadius: 4, padding: "0 5px",
        fontSize: 12, color: "var(--text-1)", background: "var(--panel-1)",
        border: "1px solid var(--border-hi)",
        opacity: disabled ? 0.7 : 1,
      }}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

function Input({ value, onChange, placeholder, type, invalid, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      aria-label={placeholder}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", height: 26, borderRadius: 4, padding: "0 7px",
        fontSize: 12, color: "var(--text-1)", background: "var(--panel-1)",
        border: `1px solid ${invalid ? "var(--error)" : "var(--border-hi)"}`,
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
}

function Banner({ tone, icon, children }: {
  tone: "warn" | "ok";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", gap: 6, alignItems: "flex-start",
      fontSize: 11, lineHeight: 1.6, padding: "6px 8px",
      borderRadius: 4, marginBottom: 10,
      background: tone === "warn" ? "var(--warn-fade)" : "var(--success-fade)",
      border: `1px solid ${tone === "warn" ? "var(--warn)" : "var(--success)"}`,
      color: tone === "warn" ? "var(--warn)" : "var(--success)",
    }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}
