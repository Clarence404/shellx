import { useEffect, useRef, useState } from "react";
import { Folder, File as FileIcon } from "lucide-react";
import { HostContextMenu } from "./HostContextMenu";
import type { EntryKind } from "../types/sftp";

interface Props {
  name: string;
  kind: EntryKind;
  size: number;
  onOpen: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onDownload: () => void;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function FileRow({ name, kind, size, onOpen, onRename, onDelete, onDownload, disabled }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  function handleContextMenu(e: React.MouseEvent) {
    if (disabled) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function startRename() {
    setDraft(name);
    setRenaming(true);
  }

  function commitRename() {
    setRenaming(false);
    if (draft.trim() && draft !== name) onRename(draft.trim());
  }

  function cancelRename() {
    setRenaming(false);
    setDraft(name);
  }

  const items = [
    { label: "Download", onClick: onDownload },
    { label: "Rename", onClick: startRename },
    { label: "Delete", onClick: onDelete, variant: "danger" as const },
  ];

  return (
    <>
      <div
        role="listitem"
        onDoubleClick={disabled ? undefined : onOpen}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px", fontSize: 12, color: disabled ? "var(--text-3)" : "var(--text-1)",
          background: hovered && !disabled ? "var(--border)" : "transparent",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {kind === "directory"
          ? <Folder size={13} color="var(--text-2)" />
          : <FileIcon size={13} color="var(--text-3)" />}
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") cancelRename();
            }}
            onBlur={commitRename}
            style={{
              flex: 1, background: "var(--panel-1)", color: "var(--text-1)",
              border: "1px solid var(--accent)", borderRadius: 4,
              padding: "2px 6px", fontSize: 12,
            }}
          />
        ) : (
          <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {name}
          </span>
        )}
        {!renaming && kind !== "directory" && (
          <span style={{ color: "var(--text-3)", fontSize: 10, minWidth: 56, textAlign: "right" }}>
            {formatBytes(size)}
          </span>
        )}
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
