import { useEffect, useRef, useState } from "react";
import {
  Folder, File as FileIcon,
  FileText, FileCode, FileJson, FileImage, FileArchive,
  FileTerminal, FileAudio, FileVideo, FileLock, FileSpreadsheet,
  Database, type LucideIcon,
} from "lucide-react";
import { HostContextMenu } from "./HostContextMenu";
import { useIconSizes } from "../state/settings";
import type { EntryKind } from "../types/sftp";

const EXT_ICON: Record<string, [LucideIcon, string]> = {
  // text / config
  txt: [FileText, "var(--text-3)"], md: [FileText, "var(--text-3)"],
  log: [FileText, "var(--text-3)"], conf: [FileText, "var(--text-3)"],
  cfg: [FileText, "var(--text-3)"], ini: [FileText, "var(--text-3)"],
  rst: [FileText, "var(--text-3)"], env: [FileText, "var(--text-3)"],
  // code
  js: [FileCode, "#f2c8a2"], ts: [FileCode, "#f2c8a2"],
  jsx: [FileCode, "#f2c8a2"], tsx: [FileCode, "#f2c8a2"],
  py: [FileCode, "#f2c8a2"], rs: [FileCode, "#f2c8a2"],
  go: [FileCode, "#f2c8a2"], c: [FileCode, "#f2c8a2"],
  cpp: [FileCode, "#f2c8a2"], h: [FileCode, "#f2c8a2"],
  hpp: [FileCode, "#f2c8a2"], java: [FileCode, "#f2c8a2"],
  rb: [FileCode, "#f2c8a2"], php: [FileCode, "#f2c8a2"],
  kt: [FileCode, "#f2c8a2"], swift: [FileCode, "#f2c8a2"],
  cs: [FileCode, "#f2c8a2"], lua: [FileCode, "#f2c8a2"],
  html: [FileCode, "#f2c8a2"], css: [FileCode, "#f2c8a2"],
  scss: [FileCode, "#f2c8a2"], vue: [FileCode, "#f2c8a2"],
  // data
  json: [FileJson, "#a6e3a1"], yaml: [FileJson, "#a6e3a1"],
  yml: [FileJson, "#a6e3a1"], toml: [FileJson, "#a6e3a1"],
  xml: [FileJson, "#a6e3a1"],
  // image
  png: [FileImage, "#7c5cff"], jpg: [FileImage, "#7c5cff"],
  jpeg: [FileImage, "#7c5cff"], gif: [FileImage, "#7c5cff"],
  svg: [FileImage, "#7c5cff"], webp: [FileImage, "#7c5cff"],
  bmp: [FileImage, "#7c5cff"], ico: [FileImage, "#7c5cff"],
  // archive
  zip: [FileArchive, "#f2c8a2"], tar: [FileArchive, "#f2c8a2"],
  gz: [FileArchive, "#f2c8a2"], bz2: [FileArchive, "#f2c8a2"],
  xz: [FileArchive, "#f2c8a2"], "7z": [FileArchive, "#f2c8a2"],
  rar: [FileArchive, "#f2c8a2"],
  // shell / script
  sh: [FileTerminal, "#a6e3a1"], bash: [FileTerminal, "#a6e3a1"],
  zsh: [FileTerminal, "#a6e3a1"], fish: [FileTerminal, "#a6e3a1"],
  bat: [FileTerminal, "#a6e3a1"], cmd: [FileTerminal, "#a6e3a1"],
  ps1: [FileTerminal, "#a6e3a1"],
  // audio / video
  mp3: [FileAudio, "#7c5cff"], wav: [FileAudio, "#7c5cff"],
  flac: [FileAudio, "#7c5cff"], ogg: [FileAudio, "#7c5cff"],
  mp4: [FileVideo, "#7c5cff"], mov: [FileVideo, "#7c5cff"],
  avi: [FileVideo, "#7c5cff"], mkv: [FileVideo, "#7c5cff"],
  webm: [FileVideo, "#7c5cff"],
  // secrets / keys
  pem: [FileLock, "#f28779"], key: [FileLock, "#f28779"],
  crt: [FileLock, "#f28779"], cer: [FileLock, "#f28779"],
  pub: [FileLock, "#f28779"],
  // db / spreadsheet
  db: [Database, "#a6e3a1"], sqlite: [Database, "#a6e3a1"],
  sql: [Database, "#a6e3a1"],
  csv: [FileSpreadsheet, "#a6e3a1"], xls: [FileSpreadsheet, "#a6e3a1"],
  xlsx: [FileSpreadsheet, "#a6e3a1"], tsv: [FileSpreadsheet, "#a6e3a1"],
};

function iconForFile(name: string, kind: EntryKind): { Icon: LucideIcon; color: string } {
  if (kind === "directory") return { Icon: Folder, color: "var(--text-2)" };
  // Strip leading dots (dotfiles) before checking the extension, but only for
  // extension lookup — files like `.env`, `.zshrc` still get their base match.
  const stem = name.replace(/^\.+/, "");
  const dot = stem.lastIndexOf(".");
  const ext = dot > 0 ? stem.slice(dot + 1).toLowerCase() : stem.toLowerCase();
  const hit = EXT_ICON[ext];
  if (hit) return { Icon: hit[0], color: hit[1] };
  return { Icon: FileIcon, color: "var(--text-3)" };
}

interface Props {
  name: string;
  kind: EntryKind;
  size: number;
  onOpen: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onDownload: () => void;
  disabled?: boolean;
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
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

export function FileRow({ name, kind, size, onOpen, onRename, onDelete, onDownload, disabled, selected, onClick }: Props) {
  const iconSizes = useIconSizes();
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

  const { Icon, color: iconColor } = iconForFile(name, kind);

  return (
    <>
      <div
        role="listitem"
        aria-selected={selected || undefined}
        onClick={disabled ? undefined : onClick}
        onDoubleClick={onOpen}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "var(--pad-row-y) var(--pad-row-x)", fontSize: "var(--font-body)",
          fontFamily: '"JetBrains Mono", var(--font-mono)',
          color: disabled ? "var(--text-3)" : "var(--text-1)",
          background: selected ? "var(--accent-fade)" : hovered ? "var(--border)" : "transparent",
          cursor: "pointer",
        }}
      >
        <Icon size={iconSizes.md} color={iconColor} />
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
              fontFamily: '"JetBrains Mono", var(--font-mono)',
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
