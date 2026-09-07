import { useState } from "react";
import { FilePen, X, Check, TriangleAlert } from "lucide-react";
import { useEditsStore } from "../state/edits";
import { useT } from "../i18n";

/** One-time explainer shown before the first remote-file edit: makes clear
 *  it's a local temp copy that auto-uploads on save. Mounted once in App. */
export function RemoteEditNotice() {
  const t = useT();
  const pending = useEditsStore((s) => s.pending);
  const [dontShow, setDontShow] = useState(false);
  if (!pending) return null;
  return (
    <div
      role="dialog"
      aria-label="remote edit notice"
      onClick={() => useEditsStore.getState().cancelPending()}
      style={{
        position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 400, background: "var(--panel-2)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "18px 20px",
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <FilePen size={16} style={{ color: "var(--accent)" }} />
          {t("Edit")} {pending.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.8 }}>
          {t("This downloads a local temporary copy and opens it in your editor:")}
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li>{t("every save uploads it back to the server automatically")}</li>
            <li>{t("closing shellx or disconnecting stops the watch")}</li>
          </ul>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--text-2)", marginTop: 14 }}>
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
          {t("Don't show this again")}
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            onClick={() => useEditsStore.getState().cancelPending()}
            style={{
              padding: "7px 16px", borderRadius: 6, fontSize: 12,
              background: "var(--panel-1)", color: "var(--text-2)", border: "1px solid var(--border)",
            }}>
            {t("Cancel")}
          </button>
          <button
            onClick={() => useEditsStore.getState().confirmPending(dontShow)}
            style={{
              padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: "var(--accent-fade)", color: "var(--text-1)", border: "1px solid var(--accent)",
            }}>
            {t("Download and open")}
          </button>
        </div>
      </div>
    </div>
  );
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "Editing N files" chip above the transfer strip — one row per watched
 *  file with its last-upload time (or error) and a stop button. */
export function EditingChip() {
  const t = useT();
  const edits = useEditsStore((s) => s.edits);
  const [open, setOpen] = useState(true);
  if (edits.length === 0) return null;
  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--panel-1)", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "7px 12px",
          fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer",
        }}>
        <FilePen size={13} /> {t("Editing")} {edits.length} {t("file(s)")}
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 400, color: "var(--text-3)" }}>
          {t("saves upload automatically")}
        </span>
      </button>
      {open && edits.map((e) => (
        <div key={e.id} style={{
          display: "flex", alignItems: "center", gap: 9, padding: "7px 12px",
          borderTop: "1px solid var(--border-2, var(--border))", fontSize: 12,
        }}>
          <FilePen size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {e.name}
          </span>
          {e.error ? (
            <span style={{ fontSize: 10, color: "var(--error)", display: "inline-flex", alignItems: "center", gap: 3 }}>
              <TriangleAlert size={11} /> {t("upload failed")}
            </span>
          ) : e.lastUploadAt ? (
            <span style={{ fontSize: 10, color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Check size={11} /> {t("saved")} {timeOf(e.lastUploadAt)}
            </span>
          ) : (
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{t("watching…")}</span>
          )}
          <button
            onClick={() => useEditsStore.getState().stop(e.id)}
            title={t("Stop watching")}
            style={{
              marginLeft: "auto", fontSize: 10, color: "var(--text-3)",
              border: "1px solid var(--border)", borderRadius: 5, padding: "2px 8px",
              background: "transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
            }}>
            <X size={11} /> {t("Stop")}
          </button>
        </div>
      ))}
    </div>
  );
}
