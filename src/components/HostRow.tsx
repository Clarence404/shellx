import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { HostContextMenu } from "./HostContextMenu";
import { useIconSizes } from "../state/settings";
import type { HostInfo } from "../types/host";

interface Props {
  host: HostInfo;
  isConnected: boolean;
  isConnecting?: boolean;
  onConnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function HostRow({ host, isConnected, isConnecting, onConnect, onEdit, onDuplicate, onDelete }: Props) {
  const iconSizes = useIconSizes();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);

  const items = [
    { label: "Connect", onClick: onConnect },
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
          background: hovered ? "var(--border)" : "transparent",
        }}>
        <button
          aria-label={host.label}
          aria-describedby={isConnected ? `conn-status-${host.id}` : undefined}
          onClick={onConnect}
          onContextMenu={handleContextMenu}
          style={{
            flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 5,
            fontSize: "var(--font-small)", color: "var(--text-1)",
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
              background: "var(--accent)",
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
