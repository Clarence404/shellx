import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ProcessRow } from "../../types/monitor";
import { HostContextMenu } from "../HostContextMenu";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useT } from "../../i18n";

type SortKey = "cpu" | "mem";

export function ProcessTab({ processes }: { processes: ProcessRow[] }) {
  const t = useT();
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; row: ProcessRow } | null>(null);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return processes
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => (sortKey === "cpu" ? b.cpuPct - a.cpuPct : b.memPct - a.memPct));
  }, [processes, filter, sortKey]);

  // One scale for both bars so CPU and memory are visually comparable.
  const max = Math.max(1, ...processes.flatMap((p) => [p.cpuPct, p.memPct]));

  return (
    <div style={{ padding: "12px 16px 16px" }}>
      <div style={{
        background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 12,
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
          borderBottom: "1px solid var(--border)", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("Processes")} · Top {processes.length}</span>
          <span style={{ flex: 1 }} />
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Search size={12} style={{ position: "absolute", left: 7, color: "var(--text-3)" }} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("Filter by name…")}
              style={{
                fontSize: 11, border: "1px solid var(--border)", borderRadius: 6,
                padding: "4px 8px 4px 22px", width: 150, background: "var(--panel-2)",
                color: "var(--text-1)",
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("Sort")}</span>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {(["cpu", "mem"] as SortKey[]).map((k) => (
              <button key={k} onClick={() => setSortKey(k)} style={{
                fontSize: 11, padding: "4px 10px", cursor: "pointer", border: "none",
                background: sortKey === k ? "var(--accent-fade)" : "transparent",
                color: sortKey === k ? "var(--accent)" : "var(--text-2)",
                fontWeight: sortKey === k ? 600 : 400,
              }}>{k === "cpu" ? "CPU" : t("Memory")}</button>
            ))}
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <Th w={70}>PID</Th>
              <Th>{t("Process")}</Th>
              <Th w={170}>CPU</Th>
              <Th w={170}>{t("Memory")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.pid}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, row: p }); }}
                style={{ cursor: "context-menu" }}
              >
                <Td mono>{p.pid}</Td>
                <Td><span style={{ fontWeight: 500 }}>{p.name}</span></Td>
                <BarCell pct={p.cpuPct} max={max} color="var(--accent)" />
                <BarCell pct={p.memPct} max={max} color="color-mix(in srgb, var(--accent) 45%, var(--panel-2))" textStrong />
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ padding: "20px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
                {t("No matching processes.")}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {menu && (
        <HostContextMenu
          x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: `${t("Copy PID")} (${menu.row.pid})`, onClick: () => void writeText(String(menu.row.pid)) },
            { label: t("Copy process name"), onClick: () => void writeText(menu.row.name) },
          ]}
        />
      )}
    </div>
  );
}

function Th({ children, w }: { children: React.ReactNode; w?: number }) {
  return (
    <th style={{
      textAlign: "left", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase",
      color: "var(--text-3)", fontWeight: 600, padding: "8px 14px",
      borderBottom: "1px solid var(--border)", width: w,
      position: "sticky", top: 0, background: "var(--panel-1)", zIndex: 2,
    }}>{children}</th>
  );
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td style={{
      padding: "7px 14px", fontSize: 12, borderBottom: "1px solid var(--border-2, var(--border))",
      color: mono ? "var(--text-3)" : "var(--text-1)",
      fontFamily: mono ? "var(--font-mono)" : undefined,
    }}>{children}</td>
  );
}
function BarCell({ pct, max, color, textStrong }: { pct: number; max: number; color: string; textStrong?: boolean }) {
  return (
    <td style={{ padding: "7px 14px", fontSize: 12, borderBottom: "1px solid var(--border)", position: "relative" }}>
      <div style={{
        position: "absolute", left: 14, right: 14, top: "50%", transform: "translateY(-50%)",
        height: 14, background: "var(--panel-2)", borderRadius: 3, overflow: "hidden",
      }}>
        <div style={{ width: `${(pct / max) * 100}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{
        position: "relative", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
        fontVariantNumeric: "tabular-nums", color: textStrong ? "var(--text-1)" : color,
      }}>{pct.toFixed(1)}%</span>
    </td>
  );
}
