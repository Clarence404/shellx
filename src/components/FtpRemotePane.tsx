import { useEffect } from "react";
import { ArrowUp, RefreshCw, Folder, File as FileIcon, Loader2 } from "lucide-react";
import { joinPath, useFtpStore } from "../state/ftp";
import { useT } from "../i18n";
import type { FtpEntry, FtpHost } from "../types/ftp";

/** Directories first, then by name — the order every file manager uses,
 *  and the one the server does not promise. */
function sortEntries(entries: FtpEntry[]): FtpEntry[] {
  return [...entries].sort((a, b) => {
    const da = a.kind === "directory" ? 0 : 1;
    const db = b.kind === "directory" ? 0 : 1;
    return da !== db ? da - db : a.name.localeCompare(b.name);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(1)} ${units[i]}`;
}

function formatTime(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FtpRemotePane() {
  const t = useT();
  const activeId = useFtpStore((s) => s.activeId);
  const hosts = useFtpStore((s) => s.hosts);
  const connected = useFtpStore((s) => s.connected);
  const cwd = useFtpStore((s) => s.cwd);
  const entries = useFtpStore((s) => s.entries);
  const listedKey = useFtpStore((s) => s.listedKey);
  const listing = useFtpStore((s) => s.listing);
  const error = useFtpStore((s) => s.error);

  const host = hosts.find((h) => h.id === activeId) ?? null;
  const live = !!activeId && connected.includes(activeId);

  // Landing on a connection with nothing listed yet — after a reconnect,
  // or after the view was remounted — fills the pane without the user
  // having to press refresh. Keyed on what has been listed, not on how
  // many rows came back: an empty directory is an answer, and asking
  // again because it was empty would never stop.
  useEffect(() => {
    if (live && !listing && listedKey !== `${activeId}:${cwd}`) {
      void useFtpStore.getState().refresh();
    }
  }, [live, listing, listedKey, activeId, cwd]);

  if (!host || !live) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-3)", fontSize: 12, padding: 20, textAlign: "center",
      }}>
        {hosts.length === 0
          ? t("Add an FTP connection to get started")
          : t("Pick a connection on the left")}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Path bar. The tags say what this connection is actually doing —
          nine out of ten FTP problems are one of these three. */}
      <div style={{
        height: 32, flexShrink: 0, display: "flex", alignItems: "center", gap: 6,
        padding: "0 8px", borderBottom: "1px solid var(--border)", background: "var(--panel-1)",
      }}>
        <IconButton
          label={t("Up one level")}
          onClick={() => void useFtpStore.getState().navigate(joinPath(cwd, ".."))}
          disabled={cwd === "/"}
        >
          <ArrowUp size={12} strokeWidth={2} />
        </IconButton>
        <IconButton label={t("Refresh")} onClick={() => void useFtpStore.getState().refresh()}>
          <RefreshCw size={12} strokeWidth={2} />
        </IconButton>
        <div style={{
          flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 11,
          background: "var(--panel-2)", border: "1px solid var(--border)",
          borderRadius: 4, padding: "3px 6px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{cwd}</div>
        <ConnectionTags host={host} />
      </div>

      {/* Column header */}
      <div style={{
        display: "flex", fontSize: 10, color: "var(--text-3)", padding: "4px 10px",
        borderBottom: "1px solid var(--border)", textTransform: "uppercase",
        letterSpacing: 0.4, flexShrink: 0,
      }}>
        <span style={{ flex: 1 }}>{host.label}</span>
        <span style={{ width: 72, textAlign: "right" }}>{t("File size")}</span>
        <span style={{ width: 80, textAlign: "right" }}>{t("Modified")}</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {error && (
          <div style={{
            fontSize: 11, color: "var(--error)", padding: "8px 10px",
            borderBottom: "1px solid var(--border)", whiteSpace: "pre-wrap",
          }}>{error}</div>
        )}
        {listing && entries.length === 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
            color: "var(--text-3)", fontSize: 12, padding: "24px 0",
          }}>
            <Loader2 size={12} className="shellx-spin" /> {t("Listing")}…
          </div>
        )}
        {!listing && entries.length === 0 && !error && (
          <div style={{ color: "var(--text-3)", fontSize: 12, padding: "24px 0", textAlign: "center" }}>
            {t("This folder is empty")}
          </div>
        )}
        {sortEntries(entries).map((e) => (
          <div
            key={e.name}
            onDoubleClick={() => {
              if (e.kind === "directory") void useFtpStore.getState().navigate(joinPath(cwd, e.name));
            }}
            style={{
              display: "flex", alignItems: "center", fontSize: 12,
              padding: "4px 10px", gap: 8,
              cursor: e.kind === "directory" ? "pointer" : "default",
            }}
            onMouseEnter={(ev) => { ev.currentTarget.style.background = "var(--panel-1)"; }}
            onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ flexShrink: 0, color: "var(--text-3)", display: "flex" }}>
              {e.kind === "directory"
                ? <Folder size={12} strokeWidth={2} />
                : <FileIcon size={12} strokeWidth={2} />}
            </span>
            <span style={{
              flex: 1, minWidth: 0, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{e.name}</span>
            <span style={{ width: 72, textAlign: "right", fontSize: 11, color: "var(--text-3)" }}>
              {e.kind === "directory" ? "" : formatBytes(e.size)}
            </span>
            <span style={{ width: 80, textAlign: "right", fontSize: 11, color: "var(--text-3)" }}>
              {formatTime(e.modified)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectionTags({ host }: { host: FtpHost }) {
  const t = useT();
  const tags: { text: string; tone: "warn" | "ok" | "muted" }[] = [];
  if (host.protocol === "ftp") tags.push({ text: t("plaintext"), tone: "warn" });
  else tags.push({ text: t("encrypted"), tone: "ok" });
  if (host.protocol !== "sftp") {
    tags.push({ text: host.charset === "auto" ? t("auto") : host.charset.toUpperCase(), tone: "muted" });
    tags.push({ text: host.passive ? t("passive mode") : t("active mode"), tone: "muted" });
  }
  return (
    <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
      {tags.map((tag) => (
        <span key={tag.text} style={{
          fontSize: 9, lineHeight: "15px", padding: "0 4px", borderRadius: 3,
          border: `1px solid ${
            tag.tone === "warn" ? "var(--warn)"
              : tag.tone === "ok" ? "var(--success)" : "var(--border-hi)"}`,
          background: tag.tone === "warn" ? "var(--warn-fade)"
            : tag.tone === "ok" ? "var(--success-fade)" : "transparent",
          color: tag.tone === "warn" ? "var(--warn)"
            : tag.tone === "ok" ? "var(--success)" : "var(--text-3)",
        }}>{tag.text}</span>
      ))}
    </span>
  );
}

function IconButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        color: disabled ? "var(--text-4)" : "var(--text-3)",
        padding: "2px 3px", borderRadius: 3, display: "flex",
        background: "transparent", border: "none",
      }}>
      {children}
    </button>
  );
}
