import { useRef } from "react";
import { useSessions } from "../state/sessions";
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
          onClose();
        }} />
    </div>
  );
}
