import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HostContextMenu } from "./HostContextMenu";
import { useIconSizes } from "../state/settings";
import type { HostInfo } from "../types/host";

interface Props {
  host: HostInfo;
  isConnected: boolean;
  isConnecting?: boolean;
  /** True when the currently active tab belongs to this host — the row
   *  keeps a hover-like highlight so users see which host they're on. */
  isActive?: boolean;
  onConnect: () => void;
  /** Fires on double-click. Opens a NEW session to the same host,
   *  bypassing the single-click dedup that switches to an existing tab.
   *  Wire only when the caller wants to allow concurrent shells to the
   *  same server. */
  onOpenNewShell?: () => void;
  /** Provided only when the host has at least one active session — hides
   *  the Disconnect item otherwise, since there's nothing to close. */
  onDisconnect?: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const DOUBLE_CLICK_MS = 250;

export function HostRow({ host, isConnected, isConnecting, isActive, onConnect, onOpenNewShell, onDisconnect, onEdit, onDuplicate, onDelete }: Props) {
  const iconSizes = useIconSizes();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  // Click / double-click disambiguation: a single click fires
  // `onConnect` (dedup to existing tab), a double click fires
  // `onOpenNewShell` (force a second session). Because the browser
  // fires `click` twice before it fires `dblclick`, we defer the
  // single-click action ~250ms so a following dblclick can cancel it.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);
  const handleRowClick = () => {
    if (clickTimerRef.current) return; // a click is already pending
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onConnect();
    }, DOUBLE_CLICK_MS);
  };
  const handleRowDoubleClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onOpenNewShell?.();
  };

  // Disconnect appears right below Connect so the "session lifecycle"
  // actions cluster, followed by a separator, then the saved-host
  // actions (Edit / Duplicate / Delete). Delete stays danger-red at the
  // bottom to keep destructive actions where the eye expects them.
  const items = [
    { label: "Connect", onClick: onConnect },
    ...(onDisconnect ? [{ label: "Disconnect", onClick: onDisconnect }] : []),
    { kind: "separator" as const },
    { label: "Edit", onClick: onEdit },
    { label: "Duplicate", onClick: onDuplicate },
    { label: "Delete", onClick: onDelete, variant: "danger" as const },
  ];

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function handleMoreClick(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: rect.right, y: rect.bottom + 4 });
  }

  function handleMoreKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleMoreClick(e);
    }
  }

  return (
    <>
      <div
        role="group"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: "100%", borderRadius: 5,
          display: "flex", alignItems: "center", gap: 4,
          background: (hovered || isActive) ? "var(--border)" : "transparent",
        }}>
        <button
          aria-label={host.label}
          aria-describedby={isConnected ? `conn-status-${host.id}` : undefined}
          onClick={handleRowClick}
          onDoubleClick={handleRowDoubleClick}
          title={onOpenNewShell ? "Click to open · double-click to open a second shell" : undefined}
          onContextMenu={handleContextMenu}
          style={{
            flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 5,
            fontSize: "var(--font-ui-size)", color: "var(--text-1)",
            display: "flex", alignItems: "center", gap: 8,
            background: "transparent",
            textAlign: "left",
          }}>
          <span
            data-testid={`conn-status-${host.id}`}
            data-connected={String(isConnected)}
            data-connecting={String(!!isConnecting)}
            style={{
              width: 6, height: 6, borderRadius: "50%",
              // Green = connected; accent purple while connecting (pulse);
              // dim accent when idle.
              background: isConnected && !isConnecting ? "var(--success)" : "var(--accent)",
              opacity: isConnected ? 1 : (isConnecting ? 1 : 0.3),
              animation: isConnecting ? "hostrow-pulse 900ms ease-in-out infinite" : undefined,
              boxShadow: isConnecting ? "0 0 0 0 var(--accent-shadow)" : undefined,
            }} />
          <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {host.label}
          </span>
        </button>
        <button
          aria-label="host options"
          tabIndex={0}
          onClick={handleMoreClick}
          onKeyDown={handleMoreKeyDown}
          style={{
            color: "var(--text-3)",
            opacity: hovered ? 1 : 0,
            transition: "opacity 0.1s",
            padding: "4px 6px",
            marginRight: 4,
            background: "transparent",
            borderRadius: 4,
            flexShrink: 0,
          }}>
          <MoreHorizontal size={iconSizes.sm} strokeWidth={2} />
        </button>
      </div>
      {menu && (
        <HostContextMenu
          x={menu.x} y={menu.y} items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
