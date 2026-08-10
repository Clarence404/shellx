import { useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  keyName: string;
  attempt: number;
  error: string | null;
  onSubmit(passphrase: string, remember: boolean): void;
  onCancel(): void;
}

export function PassphraseDialog({ open, keyName, attempt, error, onSubmit, onCancel }: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [remember, setRemember] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassphrase("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); onSubmit(passphrase, remember); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, passphrase, remember, onSubmit, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "shellx-fade-in 120ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          minWidth: 320, maxWidth: 420,
          padding: "20px 22px",
          background: "var(--panel-2)",
          border: error ? "1.5px solid var(--error, #f28779)" : "0.5px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔑</span>
          <div style={{ color: "var(--text-1)", fontSize: 13, fontWeight: 500 }}>
            解锁密钥文件
            <div style={{ color: "var(--text-3)", fontSize: 11, fontWeight: 400, marginTop: 2 }}>
              {keyName}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ color: "var(--text-2)", fontSize: 12 }} htmlFor="shellx-passphrase">
            Passphrase
          </label>
          <input
            id="shellx-passphrase"
            ref={inputRef}
            type="password"
            aria-label="passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 5,
              border: error ? "1px solid var(--error, #f28779)" : "1px solid var(--border)",
              background: "var(--panel-1)",
              color: "var(--text-1)",
              fontSize: 13,
              outline: "none",
            }}
          />
          {error && (
            <div style={{ color: "var(--error, #f28779)", fontSize: 11 }}>
              ⚠ {error} ({attempt}/3)
            </div>
          )}
        </div>

        <label style={{
          display: "flex", alignItems: "center", gap: 8,
          cursor: "pointer", fontSize: 12, color: "var(--text-2)",
        }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          记住（存入系统密钥链）
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 14px", borderRadius: 5, fontSize: 12,
              background: "transparent", color: "var(--text-2)",
              border: "0.5px solid var(--border)", cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            onClick={() => onSubmit(passphrase, remember)}
            style={{
              padding: "6px 16px", borderRadius: 5, fontSize: 12, fontWeight: 500,
              background: "var(--accent)", color: "var(--text-on-accent)",
              border: "none", cursor: "pointer",
            }}
          >
            解锁并连接
          </button>
        </div>
      </div>
    </div>
  );
}
