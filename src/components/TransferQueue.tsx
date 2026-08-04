import { X } from "lucide-react";
import { useTransfersStore } from "../state/transfers";
import { transferCancel } from "../ipc/transfers";

interface Props {
  connectionId: string;
}

export function TransferQueue({ connectionId }: Props) {
  // Select the raw list (stable reference unless the store changes) and
  // filter outside the selector — filtering inside the selector returns a
  // new array every render, which breaks useSyncExternalStore's snapshot
  // stability check against the real zustand store and causes an infinite
  // render loop (only masked in isolation by a mocked store).
  const allTransfers = useTransfersStore((s) => s.list);
  const list = allTransfers.filter((t) => t.connection_id === connectionId);
  if (list.length === 0) return null;

  return (
    <div style={{
      borderTop: "1px solid var(--border)", padding: "6px 10px",
      background: "var(--panel-1)", display: "flex", flexDirection: "column", gap: 4,
    }}>
      {list.map((t) => (
        <div key={t.id} style={{
          display: "flex", alignItems: "center", gap: 8, fontSize: 10,
        }}>
          <span style={{ color: "var(--text-3)" }}>
            {t.direction === "upload" ? "↑" : "↓"}
          </span>
          <span style={{ color: "var(--text-1)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {t.remote_path.split("/").pop()}
          </span>
          {t.state.kind === "active" && (
            <>
              <div style={{ width: 80, height: 3, background: "var(--border)", borderRadius: 2 }}>
                <div style={{
                  width: `${t.total_bytes > 0 ? (t.bytes_done / t.total_bytes * 100) : 0}%`,
                  height: "100%", background: "var(--accent)",
                }} />
              </div>
              <span style={{ color: "var(--text-3)" }}>
                {formatSize(t.bytes_done)} / {formatSize(t.total_bytes)}
              </span>
              <button onClick={() => transferCancel(t.id)} title="Cancel">
                <X size={10} color="var(--text-3)" />
              </button>
            </>
          )}
          {t.state.kind === "done" && <span style={{ color: "var(--success)" }}>done</span>}
          {t.state.kind === "cancelled" && <span style={{ color: "var(--text-3)" }}>cancelled</span>}
          {t.state.kind === "failed" && <span style={{ color: "var(--error)" }}>{t.state.error}</span>}
        </div>
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
