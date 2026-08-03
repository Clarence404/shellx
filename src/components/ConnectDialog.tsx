import { useState } from "react";
import { openSshSession } from "../ipc/commands";
import { useSessions } from "../state/sessions";

export function ConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addSession = useSessions((s) => s.addSession);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const label = `${username}@${host}`;
      const info = await openSshSession({
        host, port: Number(port), username, password, label,
      });
      addSession(info);
      onClose();
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label="new connection" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }} onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} style={{
        background: "var(--panel-2)", padding: 20, borderRadius: 8,
        border: "1px solid var(--border)", width: 320, display: "flex",
        flexDirection: "column", gap: 10,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>New SSH connection</h3>
        <Field label="Host" value={host} onChange={setHost} />
        <Field label="Port" value={port} onChange={setPort} />
        <Field label="Username" value={username} onChange={setUsername} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        {err && <div style={{ color: "var(--error)", fontSize: 11 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: "6px 10px", borderRadius: 5, color: "var(--text-2)" }}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !host || !username}
            style={{ flex: 1, padding: "6px 10px", borderRadius: 5,
              background: "var(--accent)", color: "var(--text-on-accent)", fontWeight: 600 }}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--panel-1)", border: "1px solid var(--border)",
          borderRadius: 4, padding: "6px 8px", fontSize: 12,
        }} />
    </label>
  );
}
