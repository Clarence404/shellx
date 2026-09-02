import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useSessions } from "../state/sessions";
import { listTunnelsForHost } from "../ipc/tunnels";
import type { HostInfo } from "../types/host";
import { useT } from "../i18n";

/** Past this many, the list stops being something you read and starts
 *  being a wall — the rest are counted instead. */
const NAMES_SHOWN = 8;

interface Props {
  /** Null hides the dialog. One host or many — the copy adapts. */
  hosts: HostInfo[] | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * One confirmation for a whole delete, however many hosts it covers.
 * It names what is going, and says the part the old `confirm()` left
 * out: the host's tunnel rules go with it.
 */
export function ConfirmDeleteHosts({ hosts, onCancel, onConfirm }: Props) {
  const t = useT();
  // The consequences line states facts, not boilerplate: how many live
  // sessions this delete actually cuts, how many tunnel rules actually
  // go with it. A host with neither gets told so.
  const sessions = useSessions((s) => s.sessions);
  const openCount = hosts
    ? sessions.filter(
        (s) => s.state === "active" && s.host_id && hosts.some((h) => h.id === s.host_id),
      ).length
    : 0;
  const [ruleCount, setRuleCount] = useState<number | null>(null);
  useEffect(() => {
    if (!hosts || hosts.length === 0) {
      setRuleCount(null);
      return;
    }
    let cancelled = false;
    Promise.all(hosts.map((h) => listTunnelsForHost(h.id).catch(() => [])))
      .then((lists) => {
        if (!cancelled) setRuleCount(lists.reduce((n, l) => n + l.length, 0));
      });
    return () => { cancelled = true; };
  }, [hosts]);

  useEffect(() => {
    if (!hosts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    // Capture: the drawer also listens for Escape to clear its
    // selection, and a dialog on screen should get it first.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [hosts, onCancel]);

  if (!hosts || hosts.length === 0) return null;

  const shown = hosts.slice(0, NAMES_SHOWN);
  const rest = hosts.length - shown.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="confirm delete hosts"
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
          width: 320, padding: "18px 20px",
          background: "var(--panel-2)",
          border: "0.5px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 10,
        }}>
          <Trash2 size={14} strokeWidth={2} color="var(--error)" />
          {hosts.length === 1
            ? `${t("Delete")} ${hosts[0].label}?`
            : `${t("Delete")} ${hosts.length} ${t("hosts")}?`}
        </div>

        {hosts.length > 1 && (
          <div style={{
            fontSize: 12, color: "var(--text-2)", lineHeight: 1.9,
            marginBottom: 10, maxHeight: 168, overflowY: "auto",
          }}>
            {shown.map((h) => (
              <div key={h.id} style={{
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{h.label}</div>
            ))}
            {rest > 0 && (
              <div style={{ color: "var(--text-3)" }}>… {t("and")} {rest} {t("more")}</div>
            )}
          </div>
        )}

        <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 14, lineHeight: 1.6 }}>
          {(() => {
            const parts: string[] = [];
            if (openCount > 0) parts.push(`${openCount} ${t("open sessions will close")}`);
            if (ruleCount !== null && ruleCount > 0) {
              parts.push(`${ruleCount} ${t("tunnel rules go with it")}`);
            }
            if (parts.length > 0) return parts.join(" · ");
            // Counts still loading: stay quiet rather than guessing.
            if (ruleCount === null) return "";
            return t("No open sessions, no tunnel rules.");
          })()}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            autoFocus
            onClick={onConfirm}
            style={{
              flex: 1, padding: "6px 10px", borderRadius: 5,
              background: "var(--error)", color: "#fff",
              border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
            {t("Delete")}
          </button>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: "6px 10px", borderRadius: 5,
              background: "transparent", color: "var(--text-2)",
              border: "1px solid var(--border-hi)", fontSize: 12, cursor: "pointer",
            }}>
            {t("Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
