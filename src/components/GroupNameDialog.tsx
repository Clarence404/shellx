import { useEffect, useRef, useState } from "react";
import { FolderPlus } from "lucide-react";
import { useT } from "../i18n";

interface Props {
  /** Null keeps it closed. */
  open: boolean;
  title: string;
  /** Pre-filled name — the current one when renaming, empty for a new group. */
  initial: string;
  /** Existing group names, to say whether this one joins or creates. */
  existing: string[];
  confirmLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

/**
 * Asks for a group name. Shared by "New group…" (moving hosts into a group
 * that doesn't exist yet) and "Rename group". Typing the name of an existing
 * group is allowed — it joins it (for a rename, that merges the two) — and
 * the hint under the field says which is about to happen.
 */
export function GroupNameDialog({ open, title, initial, existing, confirmLabel, onCancel, onSubmit }: Props) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Re-seed each time it opens, so a rename starts from the current name.
  useEffect(() => {
    if (open) {
      setValue(initial);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    };
    // Capture, so the drawer's own Escape (clear selection / clear search)
    // doesn't fire underneath an open dialog.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  const name = value.trim();
  const joins = name !== "" && existing.includes(name) && name !== initial.trim();
  const unchanged = name === initial.trim();

  function submit() {
    if (name && !unchanged) onSubmit(name);
    else if (unchanged && name) onCancel(); // renaming to the same name is a no-op
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "shellx-fade-in 120ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 320, padding: "18px 20px", background: "var(--panel-2)",
          border: "0.5px solid var(--border)", borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          fontSize: 13, fontWeight: 600, color: "var(--text-1)",
        }}>
          <FolderPlus size={14} strokeWidth={2} color="var(--accent)" />
          {title}
        </div>
        <input
          ref={inputRef}
          aria-label={t("Group name")}
          value={value}
          maxLength={40}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder={t("Group name")}
          autoFocus
          style={{
            width: "100%", background: "var(--panel-1)", border: "1px solid var(--border)",
            borderRadius: 4, padding: "6px 8px", fontSize: 12, color: "var(--text-1)",
          }}
        />
        <div style={{ minHeight: 16, margin: "6px 0 12px", fontSize: 10, color: "var(--text-3)" }}>
          {joins ? t("Joins the existing group") : name && !unchanged ? t("Creates a new group") : ""}
        </div>
        {/* House rule for dialogs: Cancel left, the primary action right. */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: "6px 10px", borderRadius: 5, background: "transparent",
              color: "var(--text-2)", border: "1px solid var(--border-hi)", fontSize: 12, cursor: "pointer",
            }}>
            {t("Cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!name || unchanged}
            style={{
              flex: 1, padding: "6px 10px", borderRadius: 5, background: "var(--accent)",
              color: "var(--text-on-accent)", border: "none", fontSize: 12, fontWeight: 600,
              cursor: !name || unchanged ? "default" : "pointer", opacity: !name || unchanged ? 0.5 : 1,
            }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
