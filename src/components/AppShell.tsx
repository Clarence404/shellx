import type { ReactNode } from "react";
import { ActivityRail } from "./ActivityRail";
import { Drawer } from "./Drawer";
import { Titlebar } from "./Titlebar";
import type { Tab } from "./TabBar";
import { useSessions } from "../state/sessions";
import type { HostInfo } from "../types/host";

interface Props {
  tabs?: Tab[];
  activeTabId?: string | null;
  onTabSelect?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onTabsClose?: (ids: string[]) => void;
  onNewConnection?: () => void;
  onNewLocalTerminal?: () => void;
  onEditHost?: (host: HostInfo) => void;
  onConnectHost?: (host: HostInfo, forceNew?: boolean) => void;
  children?: ReactNode;
}

/**
 * Column-first: custom Titlebar owns the top strip (logo + tabs + window
 * controls); below it, Rail + Drawer + main content lay out horizontally.
 * Titlebar replaces the OS window chrome (tauri.conf.json sets
 * `decorations: false`).
 */
export function AppShell({
  tabs = [], activeTabId = null,
  onTabSelect = () => {},
  onTabClose = () => {},
  onTabsClose,
  onNewConnection,
  onNewLocalTerminal,
  onEditHost,
  onConnectHost,
  children,
}: Props) {
  const view = useSessions((s) => s.railView);
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Titlebar
        tabs={tabs} activeTabId={activeTabId}
        onTabSelect={onTabSelect} onTabClose={onTabClose}
        onTabsClose={onTabsClose}
        onNewConnection={onNewConnection}
        onNewLocalTerminal={onNewLocalTerminal}
        onConnectHost={onConnectHost}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <ActivityRail />
        <Drawer view={view}
          onNewConnection={onNewConnection}
          onEditHost={onEditHost}
          onConnectHost={onConnectHost} />
        <main style={{ flex: 1, minWidth: 0, overflow: "hidden",
          background: "var(--panel-2)" }}>{children}</main>
      </div>
    </div>
  );
}
