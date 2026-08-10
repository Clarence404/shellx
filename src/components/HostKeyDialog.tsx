import { useEffect, useRef } from "react";
import { useChallenges } from "../state/challenges";

export function HostKeyDialog() {
  const challenge = useChallenges((s) => s.pending[0] ?? null);
  const resolve = useChallenges((s) => s.resolve);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!challenge) return;
    // For mismatch, autofocus Cancel; for unknown, autofocus Accept.
    if (challenge.verdict === "mismatch") {
      cancelRef.current?.focus();
    } else {
      acceptRef.current?.focus();
    }
  }, [challenge?.attemptId]); // re-run when a new challenge appears

  useEffect(() => {
    if (!challenge) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolve(challenge.attemptId, false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        // Enter = primary action: accept for unknown, cancel for mismatch
        if (challenge.verdict === "unknown") {
          resolve(challenge.attemptId, true);
        } else {
          resolve(challenge.attemptId, false);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [challenge, resolve]);

  if (!challenge) return null;

  const isMismatch = challenge.verdict === "mismatch";
  const borderColor = isMismatch ? "var(--error, #f28779)" : "var(--accent)";
  const borderWidth = isMismatch ? 2 : 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => resolve(challenge.attemptId, false)}
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
          border: `${borderWidth}px solid ${borderColor}`,
          borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <div style={{ color: "var(--text-1)", fontSize: 13, fontWeight: 500 }}>
          {isMismatch ? "⚠ 服务器密钥已更改" : "验证服务器身份"}
        </div>

        <div style={{ fontSize: 12, color: "var(--text-2)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div><span style={{ color: "var(--text-3)" }}>主机：</span>{challenge.host}:{challenge.port}</div>
          <div><span style={{ color: "var(--text-3)" }}>算法：</span>{challenge.keyType}</div>
          {isMismatch && challenge.storedFingerprint && (
            <div>
              <span style={{ color: "var(--text-3)" }}>已存储：</span>
              <span style={{ textDecoration: "line-through", color: "var(--text-3)" }}>
                {challenge.storedFingerprint}
              </span>
            </div>
          )}
          <div>
            <span style={{ color: "var(--text-3)" }}>
              {isMismatch ? "新指纹：" : "指纹："}
            </span>
            <span style={{ color: isMismatch ? "#ff9080" : "var(--text-1)", fontFamily: "monospace", fontSize: 11 }}>
              {challenge.fingerprint}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {isMismatch ? (
            <>
              <button
                onClick={() => resolve(challenge.attemptId, true)}
                style={{
                  padding: "6px 14px", borderRadius: 5, fontSize: 12,
                  background: "transparent", color: "var(--text-3)",
                  border: "0.5px solid var(--border)", cursor: "pointer",
                }}
              >
                我确认服务器换了密钥
              </button>
              <button
                ref={cancelRef}
                onClick={() => resolve(challenge.attemptId, false)}
                style={{
                  padding: "6px 16px", borderRadius: 5, fontSize: 12, fontWeight: 500,
                  background: "var(--error, #f28779)", color: "#fff",
                  border: "none", cursor: "pointer",
                }}
              >
                取消连接（推荐）
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => resolve(challenge.attemptId, false)}
                style={{
                  padding: "6px 14px", borderRadius: 5, fontSize: 12,
                  background: "transparent", color: "var(--text-2)",
                  border: "0.5px solid var(--border)", cursor: "pointer",
                }}
              >
                取消连接
              </button>
              <button
                ref={acceptRef}
                onClick={() => resolve(challenge.attemptId, true)}
                style={{
                  padding: "6px 16px", borderRadius: 5, fontSize: 12, fontWeight: 500,
                  background: "var(--accent)", color: "var(--text-on-accent)",
                  border: "none", cursor: "pointer",
                }}
              >
                信任并保存
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
