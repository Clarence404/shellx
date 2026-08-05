import { ExternalLink } from "lucide-react";

export function AboutPanel() {
  const version = import.meta.env.PACKAGE_VERSION;
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
    </div>
  );
}
