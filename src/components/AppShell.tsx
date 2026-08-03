import { useState, type ReactNode } from "react";
import { ActivityRail, type RailView } from "./ActivityRail";
import { Drawer } from "./Drawer";
import { TabBar, type Tab } from "./TabBar";
import type { HostInfo } from "../types/host";

interface Props {
  tabs?: Tab[];
  activeTabId?: string | null;
  onTabSelect?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onNewConnection?: () => void;
  onEditHost?: (host: HostInfo) => void;
  onConnectHost?: (host: HostInfo) => void;
  children?: ReactNode;
}

export function AppShell({
  tabs = [], activeTabId = null,
  onTabSelect = () => {},
  onTabClose = () => {},
  onNewConnection,
  onEditHost,
  onConnectHost,
  children,
}: Props) {
  const [view, setView] = useState<RailView>("hosts");
  return (
    <div style={{ height: "100vh", display: "flex" }}>
      <ActivityRail activeView={view} onSelect={setView} />
      <Drawer view={view}
        onNewConnection={onNewConnection}
        onEditHost={onEditHost}
        onConnectHost={onConnectHost} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column",
        background: "var(--panel-2)" }}>
        <TabBar
          tabs={tabs} activeTabId={activeTabId}
          onSelect={onTabSelect} onClose={onTabClose}
          onNewConnection={onNewConnection}
        />
        <main style={{ flex: 1, overflow: "hidden" }}>{children}</main>
      </div>
    </div>
  );
}
