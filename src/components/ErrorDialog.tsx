import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  /** When null, the dialog is hidden — the state-driver decides visibility. */
  message: string | null;
  onClose: () => void;
  /** Optional heading. Defaults to "Something went wrong". */
  title?: string;
}

/**
 * Centered in-app error modal. Replaces `window.alert()` — WebView2's native
 * dialog uses the OS's default position (top-left-ish on Windows), which
 * looks like it belongs to the browser process rather than shellx. This
 * component covers the whole viewport with a soft backdrop and centers a
 * card visually. Dismiss via the button, backdrop click, Escape, or Enter.
 */
export function ErrorDialog({ message, onClose, title }: Props) {
  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shellx-error-title"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        // Give the backdrop a hair of transition so the dialog doesn't
        // slam in on first paint. Same easing used by drawer / drop-target
        // outlines elsewhere in shellx.
        animation: "shellx-fade-in 120ms ease-out",
      }}
    >
      <div
        // Stop the click from bubbling to the backdrop's onClose.
        onClick={(e) => e.stopPropagation()}
        style={{
          minWidth: 320, maxWidth: 440,
          padding: "20px 22px",
          background: "var(--panel-2)",
          border: "0.5px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", gap: 14,
        }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <AlertCircle size={20} color="var(--error, #f28779)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="shellx-error-title" style={{
              color: "var(--text-1)", fontSize: 13, fontWeight: 500, marginBottom: 6,
            }}>
              {title ?? "Something went wrong"}
            </div>
            <div style={{
              color: "var(--text-2)", fontSize: 12, lineHeight: 1.5,
              wordBreak: "break-word",
            }}>
              {message}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            autoFocus
            onClick={onClose}
            style={{
              padding: "6px 16px", borderRadius: 5,
              background: "var(--accent)", color: "var(--text-on-accent)",
              border: "none", fontSize: 12, fontWeight: 500,
              cursor: "pointer",
            }}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
