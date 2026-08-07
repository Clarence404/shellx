import { Plus, ChevronLeft, ChevronRight, List, TerminalSquare, Plug } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { HostContextMenu } from "./HostContextMenu";
import { useHostsStore } from "../state/hosts";
import type { HostInfo } from "../types/host";

export type Tab = { id: string; title: string; state?: "active" | "closed" };

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseTabs?: (ids: string[]) => void;
  onNewConnection?: () => void;
  onConnectHost?: (host: HostInfo, forceNew?: boolean) => void;
}

// v0.6.3: cap the quick-connect list so a large saved-hosts inventory
// doesn't spill the popover off-screen. Same six-item ceiling used by
// the file-manager's "recent folders" affordance.
const QUICK_CONNECT_LIMIT = 6;

export function TabBar({
  tabs, activeTabId, onSelect, onClose, onCloseTabs, onNewConnection, onConnectHost,
}: Props) {
  const savedHosts = useHostsStore((s) => s.hosts);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);
  const listBtnRef = useRef<HTMLButtonElement | null>(null);
  const listPopRef = useRef<HTMLDivElement | null>(null);
  const plusBtnRef = useRef<HTMLButtonElement | null>(null);
  const plusPopRef = useRef<HTMLDivElement | null>(null);

  // Which end can still scroll. Both false → no overflow, hide all controls.
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const [listOpen, setListOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  // Recompute overflow state on scroll, resize, or tabs change. Runs on
  // ResizeObserver ticks so the Titlebar chrome adjusts as the window
  // grows/shrinks without waiting for the next scroll event.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setOverflow({ left, right });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [tabs]);

  // Keep the selected tab visible when the user cycles to a tab that
  // scrolled off. inline: "nearest" avoids jumpy re-centring on every
  // click; only tabs that are actually clipped get scrolled into view.
  // JSDom lacks scrollIntoView, so guard with a runtime check.
  useEffect(() => {
    const el = activeRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeTabId]);

  // Close the list dropdown on outside click / Escape.
  useEffect(() => {
    if (!listOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!listBtnRef.current?.contains(t) && !listPopRef.current?.contains(t)) {
        setListOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setListOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [listOpen]);

  // Same outside-click / Escape handling for the + button's popover.
  useEffect(() => {
    if (!plusOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!plusBtnRef.current?.contains(t) && !plusPopRef.current?.contains(t)) {
        setPlusOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setPlusOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [plusOpen]);

  const hasOverflow = overflow.left || overflow.right;

  function scrollByPx(delta: number) {
    stripRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  function closeMany(ids: string[]) {
    if (ids.length === 0) return;
    if (onCloseTabs) onCloseTabs(ids);
    else ids.forEach((id) => onClose(id));
  }

  function buildCtxItems(id: string) {
    const idx = tabs.findIndex((t) => t.id === id);
    const leftIds = idx > 0 ? tabs.slice(0, idx).map((t) => t.id) : [];
    const rightIds = idx >= 0 ? tabs.slice(idx + 1).map((t) => t.id) : [];
    const items: Array<{ label: string; onClick: () => void; variant?: "danger" }> = [];
    if (leftIds.length > 0) items.push({ label: `Close ${leftIds.length} to the left`, onClick: () => closeMany(leftIds) });
    if (rightIds.length > 0) items.push({ label: `Close ${rightIds.length} to the right`, onClick: () => closeMany(rightIds) });
    items.push({ label: "Close all", onClick: () => closeMany(tabs.map((t) => t.id)), variant: "danger" });
    return items;
  }

  return (
    <div style={{
      // Outer flex row — sits inside Titlebar's `flex: 1, minWidth: 0`
      // wrapper. `flex: 1, minWidth: 0` on THIS div matters too: without
      // it the outer TabBar defaults to `flex: 0 1 auto` and only grows
      // to fit its content, leaving a gap between the strip and the
      // window controls that isn't inside any drag-region (v0.5.5 fix).
      // The strip flex-grows within this row; the overflow-chrome
      // cluster ({‹ › ≡}) sits at the RIGHT end of the strip, sharing
      // one border-left divider so it reads as a single control group
      // rather than three loose buttons scattered across the titlebar.
      flex: 1, minWidth: 0,
      display: "flex", alignItems: "stretch", height: "100%",
      position: "relative",
    }}>
      <div
        ref={stripRef}
        role="tablist"
        // Empty strip area is a window drag surface — WebView2's default
        // drag detection lets clicks pass through to interactive
        // descendants (tabs are role="tab" with onClick, the + button is
        // a real <button>), so tab interaction still works; only the
        // gap-space between them and the empty strip when tabs=0 acts as
        // drag. Onus of "don't start a drag on THIS element" is on any
        // future child that needs a plain non-button click handler.
        data-tauri-drag-region
        // Vertical mouse-wheel is translated to horizontal scroll — the
        // native scrollbar is hidden (see className below + reset.css) so
        // the wheel is the primary scroll input. deltaX is honoured too
        // for horizontal trackpad gestures.
        onWheel={(e) => {
          if (!stripRef.current) return;
          const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
          if (delta === 0) return;
          stripRef.current.scrollLeft += delta;
        }}
        className="shellx-tabstrip"
        style={{
          // Height stretches to the parent Titlebar (32px); tabs align to
          // fill the full height so their active-pill background reaches
          // the Titlebar's bottom border, giving the "attached tab" look
          // without a redundant borderBottom of our own (Titlebar already
          // draws that line).
          flex: 1, minWidth: 0, height: "100%", background: "transparent",
          display: "flex", alignItems: "stretch",
          padding: "0 6px", gap: 2,
          overflowX: "auto", overflowY: "hidden",
          // Hide the native scrollbar so it doesn't consume vertical
          // space inside the 32px titlebar (squished tab pills otherwise
          // clipped upward — v0.5.3 hotfix). Wheel-scroll above replaces
          // the scrollbar for input; layout stays clean.
          scrollbarWidth: "none",
        }}
      >
        {tabs.map((t) => (
          <div key={t.id} role="tab" aria-selected={t.id === activeTabId}
            ref={t.id === activeTabId ? activeRef : undefined}
            onClick={() => onSelect(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu({ x: e.clientX, y: e.clientY, id: t.id });
            }}
            style={{
              padding: "6px 12px", borderRadius: "5px 5px 0 0", fontSize: "var(--font-ui-size)",
              background: t.id === activeTabId ? "var(--panel-2)" : "transparent",
              color: t.id === activeTabId ? "var(--text-1)" : "var(--text-3)",
              display: "flex", alignItems: "center", gap: 8,
              cursor: "pointer", flexShrink: 0,
              whiteSpace: "nowrap",
              opacity: t.state === "closed" ? 0.4 : 1,
              filter: t.state === "closed" ? "grayscale(0.6)" : "none",
              transition: "opacity 300ms, filter 300ms",
              pointerEvents: t.state === "closed" ? "none" : "auto",
            }}>
            {t.title}
            <span
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              aria-label={`close ${t.title}`}
              style={{ opacity: 0.6, fontSize: 12 }}>×</span>
          </div>
        ))}
        {onNewConnection && (
          <button
            ref={plusBtnRef}
            onClick={() => setPlusOpen((o) => !o)}
            aria-label="new tab"
            aria-haspopup="menu"
            aria-expanded={plusOpen}
            style={{
              padding: "6px 10px", marginLeft: 4,
              background: "transparent", color: "var(--text-3)",
              borderRadius: "5px 5px 0 0",
              display: "flex", alignItems: "center",
              cursor: "pointer", flexShrink: 0,
            }}>
            <Plus size={14} strokeWidth={2} />
          </button>
        )}
      </div>
      {hasOverflow && (
        <div style={{
          display: "flex", alignItems: "stretch",
          borderLeft: "0.5px solid var(--border)",
          flexShrink: 0,
        }}>
          <ChromeButton
            aria-label="scroll tabs left"
            disabled={!overflow.left}
            onClick={() => scrollByPx(-160)}
          >
            <ChevronLeft size={14} />
          </ChromeButton>
          <ChromeButton
            aria-label="scroll tabs right"
            disabled={!overflow.right}
            onClick={() => scrollByPx(160)}
          >
            <ChevronRight size={14} />
          </ChromeButton>
          <ChromeButton
            ref={listBtnRef}
            aria-label="all tabs"
            aria-haspopup="menu"
            aria-expanded={listOpen}
            onClick={() => setListOpen((o) => !o)}
          >
            <List size={14} />
          </ChromeButton>
        </div>
      )}

      {listOpen && (
        <div
          ref={listPopRef}
          role="menu"
          style={{
            // Anchored to the outer TabBar wrapper (position: relative);
            // sits just under the list button at the right end.
            position: "absolute", top: "100%", right: 0, marginTop: 2,
            minWidth: 220, maxWidth: 320, maxHeight: 360, overflow: "auto",
            background: "var(--panel-2)", border: "0.5px solid var(--border)",
            borderRadius: 5, padding: 4, zIndex: 300,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}>
          {tabs.map((t) => (
            <div
              key={t.id}
              role="menuitem"
              onClick={() => { onSelect(t.id); setListOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 8px", borderRadius: 3,
                fontSize: "var(--font-ui-size)",
                color: t.id === activeTabId ? "var(--text-1)" : "var(--text-2)",
                background: t.id === activeTabId ? "var(--border)" : "transparent",
                cursor: "pointer",
                opacity: t.state === "closed" ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (t.id !== activeTabId) (e.currentTarget as HTMLElement).style.background = "var(--border)";
              }}
              onMouseLeave={(e) => {
                if (t.id !== activeTabId) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.title}
              </span>
              <button
                aria-label={`close ${t.title}`}
                onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
                style={{
                  color: "var(--text-3)", padding: "0 4px",
                  background: "transparent", fontSize: 12,
                }}>×</button>
            </div>
          ))}
        </div>
      )}

      {plusOpen && (
        <PlusMenu
          popRef={plusPopRef}
          anchor={plusBtnRef.current}
          savedHosts={savedHosts}
          onNewConnection={() => { setPlusOpen(false); onNewConnection?.(); }}
          onQuickConnect={(host) => { setPlusOpen(false); onConnectHost?.(host); }}
        />
      )}

      {ctxMenu && (
        <HostContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          items={buildCtxItems(ctxMenu.id)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

/**
 * Popover shown when the tab bar's + button is clicked. Three sections:
 *
 *   1. New local terminal — disabled, "Soon" badge. Placeholder for the
 *      future ConPTY / forkpty backend feature.
 *   2. Quick connect — up to 6 saved hosts. Single click starts a fresh
 *      connect via `onConnectHost` (defers to App's existing dedup logic).
 *   3. New SSH connection — opens the full ConnectDialog.
 *
 * Anchor is computed once from the + button's client rect; the popover
 * uses `position: fixed` so it isn't clipped by TabBar's overflow.
 */
function PlusMenu({
  popRef, anchor, savedHosts, onNewConnection, onQuickConnect,
}: {
  popRef: React.RefObject<HTMLDivElement>;
  anchor: HTMLButtonElement | null;
  savedHosts: HostInfo[];
  onNewConnection: () => void;
  onQuickConnect: (host: HostInfo) => void;
}) {
  const rect = anchor?.getBoundingClientRect();
  const top = (rect?.bottom ?? 32) + 2;
  const left = rect?.left ?? 0;
  const quick = savedHosts.slice(0, QUICK_CONNECT_LIMIT);

  return (
    <div
      ref={popRef}
      role="menu"
      style={{
        position: "fixed", top, left,
        minWidth: 240, maxWidth: 320,
        background: "var(--panel-2)", border: "0.5px solid var(--border)",
        borderRadius: 6, padding: 4, zIndex: 300,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        fontSize: "var(--font-ui-size)",
      }}>
      <MenuItem
        icon={<TerminalSquare size={14} />}
        label="New local terminal"
        disabled
        badge="Soon"
      />
      {quick.length > 0 && (
        <>
          <MenuDivider />
          <MenuHeading>Quick connect</MenuHeading>
          {quick.map((h) => (
            <MenuItem
              key={h.id}
              icon={<span style={{
                display: "inline-block", width: 6, height: 6, borderRadius: 3,
                background: "var(--success, #7c9c80)",
              }} />}
              label={h.label || h.host}
              onClick={() => onQuickConnect(h)}
            />
          ))}
        </>
      )}
      <MenuDivider />
      <MenuItem
        icon={<Plug size={14} />}
        label="New SSH connection…"
        onClick={onNewConnection}
      />
    </div>
  );
}

function MenuItem({
  icon, label, onClick, disabled, badge,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <div
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLElement).style.background = "var(--border)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 10px", borderRadius: 4,
        color: disabled ? "var(--text-3)" : "var(--text-1)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}>
      <span style={{ display: "inline-flex", width: 14, justifyContent: "center", color: "var(--text-2)" }}>{icon}</span>
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {badge && (
        <span style={{
          fontSize: 9, padding: "1px 5px", borderRadius: 3,
          background: "var(--border)", color: "var(--text-3)",
          textTransform: "uppercase", letterSpacing: 0.4,
        }}>{badge}</span>
      )}
    </div>
  );
}

function MenuDivider() {
  return <div style={{ height: "0.5px", background: "var(--border)", margin: "4px 2px" }} />;
}

function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: "6px 10px 2px", fontSize: 10, color: "var(--text-3)",
      textTransform: "uppercase", letterSpacing: 0.4,
    }}>{children}</div>
  );
}

// Small titlebar-height chrome button used for the three tab-strip
// controls (‹ › list). forwardRef so the parent can anchor the list
// popover to the list button.
type ChromeButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  borderLeft?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const ChromeButton = forwardRef<HTMLButtonElement, ChromeButtonProps>(
  function ChromeButton({ children, disabled, borderLeft, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled}
        {...rest}
        style={{
          width: 28, height: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent",
          color: disabled ? "var(--text-3)" : "var(--text-2)",
          opacity: disabled ? 0.4 : 1,
          border: "none",
          borderLeft: borderLeft ? "0.5px solid var(--border)" : "none",
          padding: 0, cursor: disabled ? "default" : "pointer",
          flexShrink: 0,
        }}
      >{children}</button>
    );
  },
);
