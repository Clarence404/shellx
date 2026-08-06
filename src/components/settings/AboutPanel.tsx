import { useEffect, useState } from "react";
import { ExternalLink, Folder } from "lucide-react";
import { getConfigPaths, type ConfigPaths } from "../../ipc/config";

export function AboutPanel() {
  const version = import.meta.env.PACKAGE_VERSION;
  const [paths, setPaths] = useState<ConfigPaths | null>(null);

  // Load config paths once on mount. Silently ignore IPC failure — the
  // panel falls back to hiding the paths block rather than showing an
  // error inline, since it's informational chrome not a workflow.
  useEffect(() => {
    let cancelled = false;
    getConfigPaths()
      .then((p) => { if (!cancelled) setPaths(p); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ padding: "20px 24px", color: "var(--text-1)", flex: 1 }}>
      <h3 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 20px" }}>About</h3>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <span style={{ color: "var(--accent)", fontFamily: '"JetBrains Mono", var(--font-mono)' }}>&gt;_</span>
        {" "}shellx <span style={{ color: "var(--text-2)" }}>v{version}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 6 }}>MIT License · Copyright © 2026</div>
      <a
        href="https://github.com/Clarence404/shellx"
        target="_blank" rel="noreferrer"
        style={{
          fontSize: 12, color: "var(--accent)", textDecoration: "none",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        github.com/Clarence404/shellx <ExternalLink size={11} />
      </a>

      {paths && (
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "0.5px solid var(--border)" }}>
          <div style={{
            fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2,
            color: "var(--text-3)", fontWeight: 500, marginBottom: 10,
          }}>Config location</div>
          <PathRow label="Config dir" value={paths.configDir} />
          <PathRow label="hosts.db" value={paths.hostsDb} />
          <PathRow label="settings.json" value={paths.settingsJson} />
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 8, lineHeight: 1.5 }}>
            To customize: set the <code style={{
              fontFamily: '"JetBrains Mono", var(--font-mono)', background: "var(--panel-1)",
              padding: "0 4px", borderRadius: 3,
            }}>SHELLX_CONFIG_DIR</code> environment variable before launching shellx.
          </div>
        </div>
      )}
    </div>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "4px 0", fontSize: 12,
    }}>
      <Folder size={12} color="var(--text-3)" />
      <span style={{ color: "var(--text-2)", minWidth: 90 }}>{label}</span>
      <span
        title={value}
        style={{
          fontFamily: '"JetBrains Mono", var(--font-mono)', fontSize: 11,
          color: "var(--text-1)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1,
        }}
      >{value}</span>
    </div>
  );
}
