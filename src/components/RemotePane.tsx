import { useEffect } from "react";
import { RefreshCw, FolderPlus, Plus, PlugZap, Unplug } from "lucide-react";
import { useRailFiles } from "../state/railFiles";
import { useSessions } from "../state/sessions";
import { useHostsStore } from "../state/hosts";
import {
  sftpMkdir, sftpRename, sftpRemoveFile, sftpRemoveDir,
} from "../ipc/sftp";
import { sftpDownload } from "../ipc/transfers";
import { HostDropdown } from "./HostDropdown";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { FileRow } from "./FileRow";

import type { HostInfo } from "../types/host";

interface Props {
  onNewConnection: () => void;
  onConnectSavedHost?: (host: HostInfo) => void;
}

function joinPath(cwd: string, name: string): string {
  return cwd === "/" ? `/${name}` : `${cwd}/${name}`;
}

export function RemotePane({ onNewConnection, onConnectSavedHost }: Props) {
  const rightHost = useRailFiles((s) => s.rightHost);
  const rightSavedHostId = useRailFiles((s) => s.rightSavedHostId);
  const rightPath = useRailFiles((s) => s.rightPath);
  const entries = useRailFiles((s) => s.rightEntries);
  const loading = useRailFiles((s) => s.rightLoading);
  const error = useRailFiles((s) => s.rightError);
  const leftPath = useRailFiles((s) => s.leftPath);
  const selected = useRailFiles((s) => s.rightSelected);
  const sessions = useSessions((s) => s.sessions);
  const savedHosts = useHostsStore((s) => s.hosts);

  // Actions are dispatched via getState() at call time rather than a
  // hook-captured reference, so each invocation always reaches the store's
  // current action (avoids stale closures across store rehydration/testing).
  // See LocalPane for the precedent.
  const setRightHost = (id: string | null) => useRailFiles.getState().setRightHost(id);
  const setRightPath = (p: string) => useRailFiles.getState().setRightPath(p);
  const loadRight = () => useRailFiles.getState().loadRight();
  const transfer = (direction: "up" | "down") => useRailFiles.getState().transfer(direction);

  // v0.5.5: derive disconnect state instead of auto-nulling rightHost.
  // A closed / removed session used to force us back to the empty picker
  // (via a useEffect that called setRightHost(null)); Option B keeps
  // rightHost around so we can render a DisconnectedPanel with the host
  // label + Reconnect action. rightSavedHostId lets us look up the saved
  // host in useHostsStore even after useSessions purges the closed
  // session (300 ms after connection:closed fires).
  const currentSession = sessions.find((s) => s.id === rightHost);
  const isDisconnected = !!rightHost && currentSession?.state !== "active";
  const savedHostForReconnect = rightSavedHostId
    ? savedHosts.find((h) => h.id === rightSavedHostId) ?? null
    : null;
  // Label to show in the HostDropdown after the closed session is
  // purged from useSessions.sessions.
  const fallbackLabel = savedHostForReconnect?.label ?? currentSession?.label ?? null;

  // Mount-only rehydration guard: useRailFiles's initial state restores
  // rightHost/rightPath directly from localStorage (bypassing setRightHost
  // entirely), while rightEntries is never persisted and starts empty. On a
  // cold restart with a previously-selected host, that leaves the pane
  // showing a host + path but a permanently empty file list. Fire once on
  // mount to catch that case; the `entries.length === 0 && !loading` guard
  // means it's a no-op whenever setRightHost already populated things (the
  // normal host-switch path still relies solely on setRightHost's own
  // load-on-select, so this does not double-fetch on switches). Skip when
  // already disconnected — no point trying to list against a dead handle.
  useEffect(() => {
    if (rightHost && !isDisconnected && entries.length === 0 && !loading) {
      void useRailFiles.getState().loadRight();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleReconnect() {
    if (savedHostForReconnect && onConnectSavedHost) {
      // Kick off the connect flow — RailFilesView's sessionCount-growth
      // watcher will update rightHost to the new session id when
      // addSession lands. rightPath is host-keyed in localStorage, so it
      // survives the id change (see persist() in railFiles.ts).
      onConnectSavedHost(savedHostForReconnect);
    }
  }

  if (!rightHost) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{
          height: 32, padding: "0 10px", display: "flex", alignItems: "center",
          background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)",
        }}>
          <HostDropdown
            currentHost={null}
            onSelect={setRightHost}
            onConnectSavedHost={onConnectSavedHost}
            onNewConnection={onNewConnection}
          />
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 12, color: "var(--text-3)" }}>
          <div style={{ fontSize: 12 }}>Pick a host to browse remote files</div>
          <button onClick={onNewConnection}
            style={{
              padding: "6px 12px", borderRadius: 5,
              background: "var(--accent-fade)", border: "0.5px solid var(--accent)",
              color: "var(--text-1)", fontSize: 12, display: "flex",
              alignItems: "center", gap: 6,
            }}>
            <Plus size={12} /> New connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        height: 32, padding: "0 10px", display: "flex", alignItems: "center", gap: 6,
        background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)",
      }}>
        <HostDropdown
          currentHost={rightHost}
          fallbackLabel={fallbackLabel}
          onSelect={setRightHost}
          onConnectSavedHost={onConnectSavedHost}
          onNewConnection={onNewConnection}
        />
        <div style={{ flex: 1 }} />
        <button title="New folder"
          disabled={isDisconnected}
          onClick={async () => {
            const name = prompt("New folder name");
            if (!name) return;
            await sftpMkdir(rightHost, joinPath(rightPath, name));
            await loadRight();
          }}
          style={{ color: "var(--text-2)", opacity: isDisconnected ? 0.35 : 1 }}>
          <FolderPlus size={12} />
        </button>
        <button title="Refresh"
          disabled={isDisconnected}
          onClick={() => void loadRight()}
          style={{ color: "var(--text-2)", opacity: isDisconnected ? 0.35 : 1 }}>
          <RefreshCw size={12} />
        </button>
      </div>

      {isDisconnected ? (
        <DisconnectedPanel
          hostLabel={fallbackLabel ?? "this host"}
          canReconnect={!!savedHostForReconnect}
          onReconnect={handleReconnect}
          onPickDifferent={() => setRightHost(null)}
        />
      ) : (
        <>
          <div style={{ height: 30, padding: "0 10px", display: "flex", alignItems: "center",
            background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)" }}>
            <PathBreadcrumb path={rightPath} onNavigate={setRightPath} />
          </div>
          <div role="list" style={{ flex: 1, minHeight: 0, overflow: "auto" }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const src = e.dataTransfer.getData("application/x-shellx-pane");
              if (src === "left") transfer("up");
            }}
          >
            {error && <div style={{ padding: "8px 10px", color: "var(--error)", fontSize: 11 }}>{error}</div>}
            {loading && <div style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: 11 }}>Loading…</div>}
            {rightPath !== "" && rightPath !== "/" && (
              // Also skip when rightPath is empty — that window (between
              // setRightHost's synchronous reset and sftpRealpath resolving
              // to $HOME) briefly renders as breadcrumb "/" but `rightPath
              // !== "/"` was true for `""` so a stray ".." row showed.
              <FileRow
                name=".." kind="directory" size={0}
                onOpen={() => {
                  const parts = rightPath.split("/").filter(Boolean);
                  parts.pop();
                  void setRightPath(parts.length ? "/" + parts.join("/") : "/");
                }}
                onRename={() => {}} onDelete={() => {}} onDownload={() => {}}
                disabled
              />
            )}
            {entries.map((e) => (
              <div key={e.name} draggable
                onDragStart={(ev) => ev.dataTransfer.setData("application/x-shellx-pane", "right")}
              >
                <FileRow
                  name={e.name} kind={e.kind} size={e.size}
                  selected={selected.includes(e.name)}
                  onClick={(ev) => useRailFiles.getState().toggleSelectRight(e.name, ev.ctrlKey || ev.metaKey || ev.shiftKey)}
                  onOpen={() => {
                    if (e.kind === "directory") void setRightPath(joinPath(rightPath, e.name));
                    else void sftpDownload(rightHost, joinPath(rightPath, e.name), joinPath(leftPath, e.name));
                  }}
                  onRename={async (newName) => {
                    if (!newName || newName === e.name) return;
                    await sftpRename(rightHost, joinPath(rightPath, e.name), joinPath(rightPath, newName));
                    await loadRight();
                  }}
                  onDelete={async () => {
                    if (!confirm(`Delete "${e.name}"?`)) return;
                    if (e.kind === "directory") await sftpRemoveDir(rightHost, joinPath(rightPath, e.name));
                    else await sftpRemoveFile(rightHost, joinPath(rightPath, e.name));
                    await loadRight();
                  }}
                  onDownload={() => void sftpDownload(rightHost, joinPath(rightPath, e.name), joinPath(leftPath, e.name))}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Rendered in place of the file list when RemotePane's rightHost points
// to a session that's closed or already purged. Reconnect is only
// offered when we still know the saved-host id (quick-connect sessions
// were never saved, so there's nothing to reconnect to — user must pick
// a different host).
function DisconnectedPanel({
  hostLabel, canReconnect, onReconnect, onPickDifferent,
}: {
  hostLabel: string;
  canReconnect: boolean;
  onReconnect: () => void;
  onPickDifferent: () => void;
}) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 14, padding: "24px 20px", textAlign: "center",
    }}>
      <Unplug size={28} color="var(--warn)" strokeWidth={1.5} />
      <div>
        <div style={{ color: "var(--text-1)", fontSize: 13, marginBottom: 4 }}>
          Connection to {hostLabel} closed
        </div>
        <div style={{ color: "var(--text-3)", fontSize: 11 }}>
          {canReconnect
            ? "The SSH session ended. Reconnect to keep browsing."
            : "The SSH session ended. This was a quick-connect — pick a saved host to continue."}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {canReconnect && (
          <button onClick={onReconnect}
            style={{
              padding: "6px 14px", borderRadius: 5,
              background: "var(--accent)", color: "var(--text-on-accent)",
              border: "none", fontSize: 12, fontWeight: 500,
              display: "inline-flex", alignItems: "center", gap: 6,
              cursor: "pointer",
            }}>
            <PlugZap size={12} /> Reconnect
          </button>
        )}
        <button onClick={onPickDifferent}
          style={{
            padding: "6px 14px", borderRadius: 5,
            background: "transparent", color: "var(--text-2)",
            border: "0.5px solid var(--border)", fontSize: 11,
            cursor: "pointer",
          }}>
          Pick different host
        </button>
      </div>
    </div>
  );
}
