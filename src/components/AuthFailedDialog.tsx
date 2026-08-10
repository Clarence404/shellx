import { useEffect } from "react";

interface Props {
  message: string | null;
  onUsePassword(): void;
  onPickAnotherKey(): void;
  onRetry(): void;
  onClose(): void;
}

export function AuthFailedDialog({ message, onUsePassword, onPickAnotherKey, onRetry, onClose }: Props) {
  useEffect(() => {
    if (!message) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
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
          minWidth: 340, maxWidth: 460,
          padding: "20px 22px",
          background: "var(--panel-2)",
          border: "1.5px solid var(--error, #f28779)",
          borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", gap: 14,
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          aria-label="关闭"
          style={{
            position: "absolute", top: 12, right: 12,
            background: "transparent", border: "none",
            color: "var(--text-3)", cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}
        >✕</button>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--error, #f28779)", fontSize: 18, fontWeight: 700 }}>✕</span>
          <div style={{ color: "var(--text-1)", fontSize: 13, fontWeight: 500 }}>认证失败</div>
        </div>

        <div style={{
          padding: "10px 12px",
          background: "var(--panel-1)",
          borderRadius: 5,
          fontSize: 12, color: "var(--text-2)", lineHeight: 1.6,
        }}>
          <div style={{ marginBottom: 4, color: "var(--text-3)" }}>可能的原因：</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 2 }}>
            <li>Passphrase 输入错误超过限制</li>
            <li>服务器拒绝了该密钥（未在 authorized_keys 中）</li>
            <li>密钥格式不受服务器支持</li>
          </ul>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            onClick={onPickAnotherKey}
            style={{
              padding: "6px 14px", borderRadius: 5, fontSize: 12,
              background: "transparent", color: "var(--text-2)",
              border: "0.5px solid var(--border)", cursor: "pointer",
            }}
          >
            换个密钥
          </button>
          <button
            onClick={onUsePassword}
            style={{
              padding: "6px 14px", borderRadius: 5, fontSize: 12,
              background: "transparent", color: "var(--text-2)",
              border: "0.5px solid var(--border)", cursor: "pointer",
            }}
          >
            改用密码
          </button>
          <button
            onClick={onRetry}
            style={{
              padding: "6px 16px", borderRadius: 5, fontSize: 12, fontWeight: 500,
              background: "var(--accent)", color: "var(--text-on-accent)",
              border: "none", cursor: "pointer",
            }}
          >
            重试
          </button>
        </div>
      </div>
    </div>
  );
}
