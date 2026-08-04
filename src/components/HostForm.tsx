import { useEffect, useState } from "react";
import { useHostsStore } from "../state/hosts";
import { openConnection } from "../ipc/commands";
import type { HostInfo } from "../types/host";

type Mode = "create" | "edit";
type DoneAction = "connected" | "saved";

interface Props {
  mode: Mode;
  initial?: HostInfo;
  onDone: (action: DoneAction, session?: { id: string; label: string; host_id: string | null }) => void;
  onCancel: () => void;
}

export function HostForm({ mode, initial, onDone, onCancel }: Props) {
  const keychainAvailable = useHostsStore((s) => s.keychainAvailable);
  const addHost = useHostsStore((s) => s.addHost);
  const updateHostById = useHostsStore((s) => s.updateHostById);

  const [label, setLabel] = useState(initial?.label ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [saveHost, setSaveHost] = useState(true);
  const [rememberPassword, setRememberPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-fill label from username@host in create mode when both are entered
  useEffect(() => {
    if (mode === "create" && !label && username && host) {
      setLabel(`${username}@${host}`);
    }
  }, [mode, username, host, label]);

  const canRememberPw = keychainAvailable && password.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === "edit" && initial) {
        // Edit: save DB + optionally keychain, do NOT reconnect
        const result = await updateHostById({
          id: initial.id,
          label, host, port: Number(port), username,
          password: password.length > 0 ? password : undefined, // undefined = leave unchanged
        });
        if (!result.password_stored) {
          setErr("Host saved, but password storage failed. Try again or connect manually.");
          return;
        }
        onDone("saved");
      } else {
        // Create mode
        const pn = Number(port);
        if (saveHost) {
          const inserted = await addHost({
            label, host, port: pn, username,
            password: (rememberPassword && canRememberPw) ? password : undefined,
          });
          if (!inserted.password_stored) {
            setErr("Host saved, but password storage failed. Try again or connect manually.");
            return;
          }
          // Connect using the saved host
          const info = await openConnection({
            host, port: pn, username, password, label,
            host_id: inserted.id,
          });
          onDone("connected", { id: info.id, label: info.label, host_id: info.host_id });
        } else {
          // Quick connect — no DB entry
          const info = await openConnection({
            host, port: pn, username, password, label,
          });
          onDone("connected", { id: info.id, label: info.label, host_id: info.host_id });
        }
      }
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel = mode === "edit"
    ? "Save"
    : (saveHost ? "Save & Connect" : "Connect");

  const busyLabel = mode === "edit" ? "Saving…" : "Connecting…";

  return (
    <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={{
      background: "var(--panel-2)", padding: 20, borderRadius: 8,
      border: "1px solid var(--border)", width: 340,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {mode === "edit" ? "Edit host" : "New SSH connection"}
      </h3>

      <Field label="Label" value={label} onChange={setLabel} placeholder="auto-fills as user@host" />
      <Field label="Host" value={host} onChange={setHost} />
      <Field label="Port" value={port} onChange={setPort} />
      <Field label="Username" value={username} onChange={setUsername} />
      <Field label="Password" type="password" value={password}
        onChange={setPassword}
        placeholder={mode === "edit" ? "leave blank to keep current" : ""} />

      {mode === "create" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-2)" }}>
          <input type="checkbox" checked={saveHost}
            onChange={(e) => setSaveHost(e.target.checked)} />
          Save this host
        </label>
      )}

      {mode === "create" && saveHost && (
        <label style={{
          display: "flex", alignItems: "center", gap: 8, fontSize: 11,
          color: canRememberPw ? "var(--text-2)" : "var(--text-3)",
        }}>
          <input type="checkbox" checked={rememberPassword}
            disabled={!canRememberPw}
            onChange={(e) => setRememberPassword(e.target.checked)} />
          Remember password
          {!keychainAvailable && (
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>
              (Password storage unavailable on this system)
            </span>
          )}
        </label>
      )}

      {err && <div style={{ color: "var(--error)", fontSize: 11 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" onClick={onCancel}
          style={{ flex: 1, padding: "6px 10px", borderRadius: 5, color: "var(--text-2)" }}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !host || !username}
          style={{
            flex: 1, padding: "6px 10px", borderRadius: 5,
            background: "var(--accent)", color: "var(--text-on-accent)",
            fontWeight: 600,
          }}>
          {busy ? busyLabel : primaryLabel}
        </button>
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
        fontSize: 10, color: "var(--text-3)",
        textTransform: "uppercase", letterSpacing: 0.8,
      }}>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: "var(--panel-1)", border: "1px solid var(--border)",
          borderRadius: 4, padding: "6px 8px", fontSize: 12,
          color: "var(--text-1)",
        }} />
    </label>
  );
}
