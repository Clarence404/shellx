import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { error: Error | null }

export class MonitorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(e: Error): State {
    return { error: e };
  }

  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error("[MonitorBoundary]", e, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: "100%", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 10,
          background: "var(--panel-2)", color: "var(--error)", padding: 24,
        }}>
          <span style={{ fontSize: 20 }}>⚠ 监控渲染错误</span>
          <pre style={{
            fontSize: 11, color: "var(--text-2)", maxWidth: 480,
            overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
            background: "var(--panel-1)", padding: 10, borderRadius: 4,
          }}>
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.state.error === null ? this.props.children : null;
  }
}
