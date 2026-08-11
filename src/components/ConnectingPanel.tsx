import { Plug } from "lucide-react";

interface Props {
  /** Host label — "192.168.1.10" or "prod-web-1", whichever is available. */
  hostLabel: string;
  /**
   * Panel title. Defaults to "Connecting to {hostLabel}…" — override with
   * "Reconnecting to …" from RemotePane's Disconnected → Reconnect flow so
   * the UI text tracks the user's mental model.
   */
  title?: string;
  /** Small explanatory line under the title. Defaults to the generic form. */
  subtitle?: string;
  /**
   * Optional Cancel handler. When absent the button is hidden — useful for
   * the first-connect flow from Hosts sidebar where there's no canonical
   * "cancel" (the connecting flag drives the whole state, no session yet).
   */
  onCancel?: () => void;
}

/**
 * Shared "connecting in flight" UI: two plug icons drifting toward each other
 * with a three-dot pulse between them, then title + subtitle. Reused by
 * RemotePane's Reconnect flow (SFTP) and the main-pane first-connect flow
 * (SSH). Keyframes (`shellx-plug-left/right`, `shellx-dot-pulse`) live in
 * reset.css alongside hostrow-pulse — pure CSS, no JS animation loop.
 */
export function ConnectingPanel({ hostLabel, title, subtitle, onCancel }: Props) {
  return (
    <div style={{
      flex: 1, minHeight: 0, height: "100%",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 14, padding: "24px 20px", textAlign: "center",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)" }}>
        <Plug size={22} strokeWidth={1.5}
          style={{ animation: "shellx-plug-left 1.6s ease-in-out infinite" }} />
        <span style={{
          display: "inline-flex", gap: 3,
          fontSize: 20, lineHeight: 1, color: "var(--accent)",
          letterSpacing: 1,
        }}>
          <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out infinite" }}>·</span>
          <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out 0.2s infinite" }}>·</span>
          <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out 0.4s infinite" }}>·</span>
        </span>
        {/* Wrapping span carries the horizontal mirror; the inner Plug
            owns the animation. CSS animations overwrite the `transform`
            property during play, so stacking scaleX on the same element
            would cancel the mirror mid-cycle. */}
        <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
          <Plug size={22} strokeWidth={1.5}
            style={{ animation: "shellx-plug-right 1.6s ease-in-out infinite" }} />
        </span>
      </div>
      <div style={{ maxWidth: "100%" }}>
        {/* One line, ellipsized — a pathological host label must not wrap
            the panel across several lines. Full text in the tooltip. */}
        <div
          title={title ?? `Connecting to ${hostLabel}…`}
          style={{
            color: "var(--text-1)", fontSize: 13, marginBottom: 4,
            maxWidth: 420, whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
            marginLeft: "auto", marginRight: "auto",
          }}>
          {title ?? `Connecting to ${hostLabel}…`}
        </div>
        <div style={{ color: "var(--text-3)", fontSize: 11 }}>
          {subtitle ?? "Establishing the SSH session."}
        </div>
      </div>
      {onCancel && (
        <button onClick={onCancel}
          style={{
            padding: "6px 14px", borderRadius: 5,
            background: "transparent", color: "var(--text-2)",
            border: "0.5px solid var(--border)", fontSize: 11,
            cursor: "pointer",
          }}>
          Cancel
        </button>
      )}
    </div>
  );
}
