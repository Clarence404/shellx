import { useEffect, useState } from "react";
import { Minus, Square, X, Copy as Restore, Search, Sun, Moon, Zap } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TabBar, type Tab } from "./TabBar";
import type { HostInfo } from "../types/host";
import { useSettingsStore } from "../state/settings";
import { useT } from "../i18n";

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
  onTabsClose?: (ids: string[]) => void;
  onNewConnection?: () => void;
  onNewLocalTerminal?: () => void;
  onRename?: (id: string, title: string) => void;
  onConnectHost?: (host: HostInfo, forceNew?: boolean) => void;
  onOpenPalette?: () => void;
  onOpenSnippets?: () => void;
}

const IS_MAC = typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";

/**
 * Custom titlebar. `tauri.conf.json` sets `decorations: false` +
 * `titleBarStyle: "Overlay"` (macOS keeps its own red/yellow/green
 * traffic lights on top of this bar; on Windows/Linux we own everything).
 *
 * Layout: [logo] [tabs] [flex-1 drag region] [min][max/restore][close].
 * The empty middle carries `data-tauri-drag-region` so the user can drag
 * the window by any non-interactive area; TabBar / logo / controls are
 * interactive and NOT drag regions.
 */
export function Titlebar({ tabs, activeTabId, onTabSelect, onTabClose, onTabsClose, onNewConnection, onNewLocalTerminal, onRename, onConnectHost, onOpenPalette, onOpenSnippets }: Props) {
  const [maximized, setMaximized] = useState(false);
  const t = useT();
  const themeId = useSettingsStore((s) => s.themeId);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const isDark = themeId === "warm-minimal";

  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    void win.isMaximized().then((m) => { if (!cancelled) setMaximized(m); });
    // Listen for resize/maximize toggles so the icon updates.
    const unlistenPromise = win.onResized(async () => {
      const m = await win.isMaximized();
      if (!cancelled) setMaximized(m);
    });
    return () => {
      cancelled = true;
      void unlistenPromise.then((u) => u());
    };
  }, []);

  const win = () => getCurrentWindow();

  return (
    <div
      style={{
        height: 32, flexShrink: 0, background: "var(--panel-1)",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center",
        // Reserve macOS traffic-light gutter — 68px is enough for the
        // three buttons at standard spacing. On Windows/Linux there's
        // nothing there and this padding just becomes visual breathing
        // room, which is fine.
        paddingLeft: 8,
      }}>
      {/* Logo — clicking it doesn't do anything yet; drag region so users
          can grab here to drag the window. */}
      <div
        data-tauri-drag-region
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "0 8px", color: "var(--accent)",
          fontFamily: '"JetBrains Mono", var(--font-mono)',
          fontSize: 13, fontWeight: 600,
          userSelect: "none",
        }}>
        <span data-tauri-drag-region>&gt;_</span>
      </div>
      {/* TabBar consumes the remaining space between logo and window
          controls. `flex: 1 + minWidth: 0` lets it shrink below its
          content width; TabBar's own `overflow-x: auto` scrolls the
          strip internally. Without minWidth: 0, flex-basis "auto" wins
          and tabs push into the window-controls area, hiding
          minimize/maximize/close (see v0.5.3 hotfix). */}
      <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
        <TabBar
          tabs={tabs} activeTabId={activeTabId}
          onSelect={onTabSelect} onClose={onTabClose}
          onCloseTabs={onTabsClose}
          onNewConnection={onNewConnection}
          onNewLocalTerminal={onNewLocalTerminal}
          onRename={onRename}
          onConnectHost={onConnectHost}
        />
      </div>
      {/* Drag gutter before window controls — guarantees a drag /
          dbl-click-maximize surface even when tabs fill the strip, and
          gives visual breathing room between the tab-chrome cluster
          (‹ › ≡) and the window buttons (min/max/close). v0.5.3 widened
          from 12px to 24px after the two clusters touched. */}
      <div
        data-tauri-drag-region
        onDoubleClick={() => void win().toggleMaximize()}
        style={{ flexShrink: 0, width: 16, height: "100%" }}
      />
      {onOpenSnippets && (
        <PillButton
          onClick={onOpenSnippets}
          label={t("Snippets")}
          shortcut={`${MOD_LABEL}+Shift+K`}
          icon={<Zap size={12} />}
        />
      )}
      {onOpenPalette && (
        <SearchButton onClick={onOpenPalette} label={t("Search")} />
      )}
      <ThemeToggle
        isDark={isDark}
        onToggle={() => setTheme(isDark ? "warm-light" : "warm-minimal")}
        label={t(isDark ? "Switch to light theme" : "Switch to dark theme")}
      />
      <div style={{
        flexShrink: 0, width: 8, height: 14,
        borderLeft: "1px solid var(--border)", margin: "0 4px",
      }} />
      <div style={{ display: "flex", height: "100%" }}>
        <TitleButton onClick={() => void win().minimize()} label="Minimize">
          <Minus size={14} />
        </TitleButton>
        <TitleButton onClick={() => void win().toggleMaximize()} label={maximized ? "Restore" : "Maximize"}>
          {maximized ? <Restore size={12} /> : <Square size={12} />}
        </TitleButton>
        <TitleButton onClick={() => void win().close()} label="Close" danger>
          <X size={14} />
        </TitleButton>
      </div>
    </div>
  );
}

function TitleButton({
  children, onClick, label, danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 44, height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: hover ? (danger ? "var(--error)" : "var(--border-hi)") : "transparent",
        color: hover && danger ? "var(--bg)" : "var(--text-2)",
        border: "none", padding: 0, cursor: "pointer",
      }}
    >{children}</button>
  );
}

/** Same pill as SearchButton, for the snippet palette — icon-first
 *  because two labelled pills would crowd the titlebar. */
function PillButton({ onClick, label, shortcut, icon }: {
  onClick: () => void;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={`${label}  (${shortcut})`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: 22, width: 26, marginRight: 4,
        border: "1px solid var(--border)",
        background: hover ? "var(--panel-2)" : "var(--panel-1)",
        color: hover ? "var(--text-1)" : "var(--text-3)",
        borderRadius: 6, cursor: "pointer",
      }}
    >
      {icon}
    </button>
  );
}

// Pill button that opens the command palette. Shows the shortcut so
// discoverability doesn't rely on users guessing Ctrl+K.
function SearchButton({ onClick, label }: { onClick: () => void; label: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={`${label}  (${MOD_LABEL}+K)`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        height: 22, padding: "0 8px 0 8px", marginRight: 4,
        border: "1px solid var(--border)",
        background: hover ? "var(--panel-2)" : "var(--panel-1)",
        color: hover ? "var(--text-1)" : "var(--text-3)",
        borderRadius: 6, cursor: "pointer",
        fontSize: 11,
      }}
    >
      <Search size={12} />
      <span>{label}</span>
      <span style={{
        marginLeft: 12,
        color: "var(--text-4, var(--text-3))",
      }}>{MOD_LABEL}+K</span>
    </button>
  );
}

// Icon-only theme toggle. Shows Sun in dark (click → light) and Moon in
// light (click → dark) so the icon hints where you're going, not where
// you are.
function ThemeToggle({
  isDark, onToggle, label,
}: {
  isDark: boolean; onToggle: () => void; label: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onToggle}
      aria-label={label}
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 32, height: 22, marginRight: 4,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: hover ? "var(--panel-2)" : "transparent",
        color: "var(--text-2)",
        border: "1px solid transparent",
        borderRadius: 6, cursor: "pointer",
      }}
    >
      {isDark ? <Sun size={13} /> : <Moon size={13} />}
    </button>
  );
}
