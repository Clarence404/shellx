import { useState } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import { useFtpStore } from "../state/ftp";
import type { FtpCharset, FtpHost, FtpProtocol } from "../types/ftp";
import { useT } from "../i18n";

interface Props {
  /** Editing an existing row, or null to create one. */
  initial?: FtpHost | null;
  onCancel: () => void;
  onDone: (id: string) => void;
}

const DEFAULT_PORT: Record<FtpProtocol, number> = { sftp: 22, ftp: 21, ftps: 21 };

/**
 * A form per protocol, in one component. The protocol switch reshapes
 * what is below it: SFTP has no charset and no transfer mode, because
 * the protocol fixes filenames as UTF-8 and carries data on the same
 * authenticated connection. Those fields are absent rather than
 * disabled — the concepts do not exist there.
 */
export function FtpHostForm({ initial, onCancel, onDone }: Props) {
  const t = useT();
  const editing = !!initial;
  const [protocol, setProtocol] = useState<FtpProtocol>(initial?.protocol ?? "ftp");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? DEFAULT_PORT.ftp));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [charset, setCharset] = useState<FtpCharset>(initial?.charset ?? "auto");
  const [passive, setPassive] = useState(initial?.passive ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Changing the protocol moves the port with it, unless the user has
  // already typed one that is not simply the old default.
  function pickProtocol(next: FtpProtocol) {
    setPort((current) =>
      current === String(DEFAULT_PORT[protocol]) ? String(DEFAULT_PORT[next]) : current,
    );
    setProtocol(next);
  }

  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
  const canSave = !!host.trim() && !!username.trim() && portValid && !busy;

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setErr(null);
    try {
      const name = label.trim() || `${username.trim()}@${host.trim()}`;
      if (editing && initial) {
        await useFtpStore.getState().updateHost({
          id: initial.id,
          label: name, protocol, host: host.trim(), port: portNum,
          username: username.trim(), charset, passive,
          ...(password ? { password } : {}),
        });
        onDone(initial.id);
      } else {
        const saved = await useFtpStore.getState().addHost({
          label: name, protocol, host: host.trim(), port: portNum,
          username: username.trim(), charset, passive,
          ...(password ? { password } : {}),
        });
        onDone(saved.id);
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

      <Field label={t("Protocol")}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["sftp", "ftp", "ftps"] as FtpProtocol[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => pickProtocol(p)}
              style={{
                flex: 1, height: 26, borderRadius: 4, fontSize: 12,
                border: `1px solid ${protocol === p ? "var(--accent)" : "var(--border-hi)"}`,
                background: protocol === p ? "var(--accent-fade)" : "transparent",
                color: protocol === p ? "var(--accent)" : "var(--text-2)",
              }}>
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>

      {protocol === "ftp" ? (
        <Banner tone="warn" icon={<TriangleAlert size={12} strokeWidth={2} />}>
          {t("FTP is not encrypted: the password and every byte travel in the clear. Use it only on a network you trust.")}
        </Banner>
      ) : (
        <Banner tone="ok" icon={<Lock size={12} strokeWidth={2} />}>
          {protocol === "sftp"
            ? t("SFTP runs over SSH, the same way the Hosts view connects.")
            : t("FTPS is FTP with TLS. Both the control and data connections are encrypted.")}
        </Banner>
      )}

      {protocol !== "ftp" && (
        <div style={{ fontSize: 11, color: "var(--warn)", marginBottom: 10 }}>
          {t("Only FTP connects in this build.")}
        </div>
      )}

      <Field label={t("Name")}>
        <Input value={label} onChange={setLabel} placeholder={t("auto-fills as user@host")} />
      </Field>
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
      <Field label={t("Username")}>
        <Input value={username} onChange={setUsername} placeholder="ftpuser" />
      </Field>
      <Field label={t("Password")}>
        <Input
          value={password}
          onChange={setPassword}
          type="password"
          placeholder={editing ? t("leave blank to keep the stored one") : ""}
        />
      </Field>

      {protocol !== "sftp" && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 10 }}>
            <input type="checkbox" checked={passive} onChange={(e) => setPassive(e.target.checked)} />
            {t("Passive mode (PASV)")}
          </label>
          <Field label={t("Filename encoding")}>
            <div style={{ display: "flex", gap: 4 }}>
              {(["auto", "utf8", "gbk"] as FtpCharset[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCharset(c)}
                  style={{
                    flex: 1, height: 26, borderRadius: 4, fontSize: 12,
                    border: `1px solid ${charset === c ? "var(--accent)" : "var(--border-hi)"}`,
                    background: charset === c ? "var(--accent-fade)" : "transparent",
                    color: charset === c ? "var(--accent)" : "var(--text-2)",
                  }}>
                  {c === "auto" ? t("Auto") : c === "utf8" ? "UTF-8" : "GBK"}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}

      {err && <div style={{ fontSize: 11, color: "var(--error)", marginBottom: 8 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
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

function Input({ value, onChange, placeholder, type, invalid }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  invalid?: boolean;
}) {
  return (
    <input
      aria-label={placeholder}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", height: 26, borderRadius: 4, padding: "0 7px",
        fontSize: 12, color: "var(--text-1)", background: "var(--panel-1)",
        border: `1px solid ${invalid ? "var(--error)" : "var(--border-hi)"}`,
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
