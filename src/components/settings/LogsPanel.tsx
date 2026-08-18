import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Search, Download, Trash2, X } from "lucide-react";
import { useT } from "../../i18n";
import {
  logsSnapshot, logsSubscribe, logsUnsubscribe, logsExport,
  logsDiskEnabled, logsSetDiskEnabled,
  onLogEntry, onLogLagged,
  type LogEntry, type LogFilter, type LogLevel, type LogsStats,
} from "../../ipc/logs";

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const CATEGORIES = ["tunnel", "session", "sftp", "monitor", "host", "updater", "keychain", "app"];

export function LogsPanel() {
  const t = useT();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogsStats>({ total: 0, debug: 0, info: 0, warn: 0, error: 0 });
  const [query, setQuery] = useState("");
  const [minLevel, setMinLevel] = useState<LogLevel>("info");
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [diskEnabled, setDiskEnabled] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Debounce the query so typing doesn't refetch on every keystroke.
  const queryTimer = useRef<number | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    if (queryTimer.current !== null) window.clearTimeout(queryTimer.current);
    queryTimer.current = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => {
      if (queryTimer.current !== null) window.clearTimeout(queryTimer.current);
    };
  }, [query]);

  const filter = useMemo<LogFilter>(() => ({
    query: debouncedQuery.trim(),
    min_level: minLevel,
    categories: activeCategories,
  }), [debouncedQuery, minLevel, activeCategories]);

  const filterMatches = useCallback((e: LogEntry): boolean => {
    if (activeCategories.length > 0 && !activeCategories.includes(e.category)) return false;
    const severity: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    if (severity[e.level] < severity[minLevel]) return false;
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.trim().toLowerCase();
      const inMsg = e.message.toLowerCase().includes(q);
      const inFields = JSON.stringify(e.fields).toLowerCase().includes(q);
      if (!inMsg && !inFields) return false;
    }
    return true;
  }, [activeCategories, minLevel, debouncedQuery]);

  const refetch = useCallback(async () => {
    try {
      const r = await logsSnapshot(filter, 500);
      setEntries(r.entries);
      setStats(r.stats);
    } catch (e) {
      console.error("logs snapshot failed", e);
    }
  }, [filter]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Live subscription — flip the backend pump on/off, and push each new
  // entry into the current view (respecting the filter).
  useEffect(() => {
    if (!live) {
      void logsUnsubscribe();
      return;
    }
    let unlistenEntry: (() => void) | undefined;
    let unlistenLagged: (() => void) | undefined;
    void logsSubscribe();
    onLogEntry((entry) => {
      if (!filterMatches(entry)) return;
      setEntries((prev) => {
        const next = [entry, ...prev];
        if (next.length > 500) next.length = 500;
        return next;
      });
      setStats((prev) => ({
        total: prev.total + 1,
        debug: prev.debug + (entry.level === "debug" ? 1 : 0),
        info: prev.info + (entry.level === "info" ? 1 : 0),
        warn: prev.warn + (entry.level === "warn" ? 1 : 0),
        error: prev.error + (entry.level === "error" ? 1 : 0),
      }));
    }).then((u) => { unlistenEntry = u; });
    onLogLagged(() => {
      // Ring lagged — do a full refetch to recover accurate state.
      void refetch();
    }).then((u) => { unlistenLagged = u; });
    return () => {
      unlistenEntry?.();
      unlistenLagged?.();
      void logsUnsubscribe();
    };
  }, [live, filterMatches, refetch]);

  useEffect(() => {
    void logsDiskEnabled().then(setDiskEnabled).catch(() => {});
  }, []);

  async function handleExport() {
    try {
      const path = await saveDialog({
        title: t("Export logs as jsonl"),
        defaultPath: `shellx-logs-${new Date().toISOString().slice(0, 10)}.jsonl`,
        filters: [{ name: "JSON Lines", extensions: ["jsonl"] }],
      });
      if (!path) return;
      const n = await logsExport(String(path), filter);
      console.log(`exported ${n} entries`);
    } catch (e) {
      console.error("export failed", e);
    }
  }

  function toggleCategory(cat: string) {
    setActiveCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      overflow: "hidden", background: "var(--panel-2)",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
          {t("Logs")}
        </h1>
        <span style={{
          fontSize: 11, color: "var(--text-3)",
          background: "var(--panel-1)", padding: "2px 10px", borderRadius: 999,
          fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        }}>
          {stats.warn} warn · {stats.error} error · {stats.total} {t("total")}
        </span>
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)" }}>
          <input
            type="checkbox"
            checked={diskEnabled}
            onChange={(e) => {
              const v = e.target.checked;
              setDiskEnabled(v);
              void logsSetDiskEnabled(v);
            }}
          />
          {t("Write to disk")}
        </label>
        <button
          onClick={handleExport}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 28, padding: "0 12px",
            background: "transparent", color: "var(--text-2)",
            border: "1px solid var(--border)", borderRadius: 6,
            cursor: "pointer", fontSize: 12,
          }}
        >
          <Download size={12} />
          {t("Export jsonl")}
        </button>
      </div>

      {/* Filter bar */}
      <div style={{
        padding: "10px 20px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        background: "var(--panel-1)", flexWrap: "wrap", rowGap: 8,
      }}>
        <div style={{
          flex: 1, minWidth: 200,
          display: "inline-flex", alignItems: "center", gap: 6,
          height: 30, padding: "0 10px",
          border: "1px solid var(--border)", borderRadius: 6,
          background: "var(--panel-2)", color: "var(--text-3)",
        }}>
          <Search size={12} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search message or fields")}
            style={{
              border: "none", outline: "none", background: "transparent",
              color: "var(--text-1)", fontSize: 12, flex: 1, minWidth: 100,
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)" }}
              title={t("Clear")}
            ><X size={12} /></button>
          )}
        </div>
        <select
          value={minLevel}
          onChange={(e) => setMinLevel(e.target.value as LogLevel)}
          style={{
            height: 30, padding: "0 8px", fontSize: 12,
            background: "var(--panel-2)", color: "var(--text-1)",
            border: "1px solid var(--border)", borderRadius: 6, outline: "none",
          }}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>{t("min level")} · {l}+</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 4 }}>
          {CATEGORIES.map((c) => {
            const active = activeCategories.includes(c);
            return (
              <button
                key={c}
                onClick={() => toggleCategory(c)}
                style={{
                  height: 24, padding: "0 8px", fontSize: 11,
                  background: active ? "var(--accent)" : "var(--panel-2)",
                  color: active ? "var(--text-on-accent)" : "var(--text-2)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 4, cursor: "pointer",
                }}
              >{c}</button>
            );
          })}
        </div>
        <button
          onClick={() => setLive((v) => !v)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 30, padding: "0 12px",
            background: live
              ? "color-mix(in srgb, var(--success) 15%, transparent)"
              : "var(--panel-2)",
            color: live ? "var(--success)" : "var(--text-2)",
            border: `1px solid ${live ? "var(--success)" : "var(--border)"}`,
            borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 500,
          }}
        >
          {live && (
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "var(--success)",
              animation: "shx-pulse 1.4s ease-in-out infinite",
            }} />
          )}
          {live ? t("Live") : t("Live off")}
        </button>
        <button
          onClick={() => setEntries([])}
          title={t("Clear view (does not delete on disk)")}
          style={{
            width: 30, height: 30,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent", color: "var(--text-3)",
            border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer",
          }}
        ><Trash2 size={12} /></button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {[t("Time"), t("Level"), t("Category"), t("Message")].map((h, i) => (
                <th key={i} style={{
                  position: "sticky", top: 0, zIndex: 2,
                  background: "var(--panel-2)", borderBottom: "1px solid var(--border)",
                  textAlign: "left", padding: "8px 14px",
                  fontSize: 11, fontWeight: 600, color: "var(--text-3)",
                  textTransform: "uppercase", letterSpacing: 0.4,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: "40px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
                  {t("No log entries match the current filter")}
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <LogRow
                key={e.id}
                entry={e}
                expanded={expandedId === e.id}
                onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pulse keyframes (inline so no global CSS edit needed) */}
      <style>{`
        @keyframes shx-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}

function LogRow({ entry, expanded, onToggle }: {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const time = new Date(entry.ts);
  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  const ss = String(time.getSeconds()).padStart(2, "0");
  const ms = String(time.getMilliseconds()).padStart(3, "0");
  const timeStr = `${hh}:${mm}:${ss}.${ms}`;

  const levelStyle: Record<string, React.CSSProperties> = {
    debug: { background: "#F1F5F9", color: "#64748B" },
    info: { background: "var(--panel-1)", color: "var(--text-2)" },
    warn: { background: "color-mix(in srgb, var(--warn, #F59E0B) 15%, transparent)", color: "var(--warn, #F59E0B)" },
    error: { background: "color-mix(in srgb, var(--error) 15%, transparent)", color: "var(--error)" },
  };

  const fieldsPreview = Object.entries(entry.fields).slice(0, 4).map(([k, v]) => {
    const short = typeof v === "string" ? (v.length > 40 ? `${v.slice(0, 38)}…` : v) : JSON.stringify(v);
    return `${k}=${short}`;
  }).join(" · ");

  return (
    <>
      <tr onClick={onToggle}
        style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
        <td style={{ padding: "9px 14px", color: "var(--text-3)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", verticalAlign: "top", width: 108 }}>
          {timeStr}
        </td>
        <td style={{ padding: "9px 14px", verticalAlign: "top", width: 70 }}>
          <span style={{
            display: "inline-block", padding: "1px 8px", borderRadius: 4,
            fontSize: 10, fontWeight: 600, textTransform: "uppercase",
            letterSpacing: 0.4, ...levelStyle[entry.level],
          }}>{entry.level}</span>
        </td>
        <td style={{ padding: "9px 14px", verticalAlign: "top", width: 90 }}>
          <span style={{
            display: "inline-block", padding: "1px 8px", borderRadius: 4,
            fontSize: 10, fontWeight: 500, fontFamily: "var(--font-mono)",
            background: "var(--panel-1)", color: "var(--text-2)",
          }}>{entry.category}</span>
        </td>
        <td style={{ padding: "9px 14px", color: "var(--text-1)", verticalAlign: "top" }}>
          {entry.message}
          {fieldsPreview && (
            <span style={{ color: "var(--text-3)", fontFamily: "var(--font-mono)", fontSize: 11, marginLeft: 8 }}>
              · {fieldsPreview}
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} style={{
            padding: "12px 14px", background: "var(--panel-1)",
            borderTop: "1px dashed var(--border)", borderBottom: "1px solid var(--border)",
          }}>
            <pre style={{
              margin: 0, padding: "10px 12px",
              background: "var(--panel-2)", border: "1px solid var(--border)",
              borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: 11,
              color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>{JSON.stringify(entry, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}
