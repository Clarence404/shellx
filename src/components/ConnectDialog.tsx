import { useRef } from "react";
import { useSessions } from "../state/sessions";
import { useHostsStore } from "../state/hosts";
import { openShell } from "../ipc/commands";
import { HostForm } from "./HostForm";
import type { HostInfo } from "../types/host";

interface Props {
  open: boolean;
  mode?: "create" | "edit";
  initial?: HostInfo;
  onClose: () => void;
}

export function ConnectDialog({ open, mode = "create", initial, onClose }: Props) {
  const addSession = useSessions((s) => s.addSession);
  // Track where mousedown started so a drag from inside the form to the
  // backdrop doesn't accidentally dismiss the dialog.
  const mouseDownInsideRef = useRef(false);
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="new connection"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
      onMouseDown={(e) => { mouseDownInsideRef.current = e.target !== e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && !mouseDownInsideRef.current) onClose(); }}
    >
      <HostForm
        mode={mode}
        initial={initial}
        onCancel={onClose}
        onDone={(action, session) => {
          if (action === "connected" && session) {
            addSession({
              id: session.id, label: session.label,
              kind: "ssh", host_id: session.host_id, state: "active",
            });
          }
          if (action === "saved" && mode === "edit" && initial) {
            // A session opened while the host was tunnels-only has no shell
            // channel. If the edit switched the host to a terminal-capable
            // mode, retrofit the shell onto its live sessions — open_shell
            // is idempotent, so sessions that already have one are no-ops.
            const saved = useHostsStore.getState().hosts.find((h) => h.id === initial.id);
            if (saved && saved.connection_mode !== "tunnels_only") {
              useSessions.getState().sessions
                .filter((s) => s.host_id === initial.id && s.kind === "ssh" && s.state === "active")
                .forEach((s) => {
                  void openShell(s.id)
                    .then(() => {
                      // Late-opened PTYs start at 80x24 — tell the mounted
                      // TerminalView to push its real dimensions.
                      window.dispatchEvent(new CustomEvent("shellx:refit", { detail: s.id }));
                    })
                    .catch(() => {});
                });
            }
          }
          onClose();
        }} />
    </div>
  );
}
