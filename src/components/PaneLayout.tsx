import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, Monitor, Folder, Network, Activity } from "lucide-react";
import { useSessions } from "../state/sessions";
import { usePaneDrag, isDragging } from "../state/paneDrag";
import type { DragTarget } from "../state/paneDrag";
import * as tree from "../state/paneTree";
import type { DropZone, PaneNode } from "../state/paneTree";
import { placeSurfaces, surfaceHost } from "./SessionSurfaces";
import { ActivitySwitcher } from "./paneChrome";
import { useHostsStore } from "../state/hosts";
import { activitiesFor, clampActivity } from "../state/activities";
import type { ActivityKind } from "../types/connection";
import { useT } from "../i18n";

/** Outer band of the whole area: a drop here spans everything. */
const OUTER_BAND = 16;
/** Edge bands inside a pane, as a share of it but never thinner than this
 *  — a quarter-size pane still needs an edge you can hit. */
const EDGE_MIN_X = 26;
const EDGE_MIN_Y = 22;
const EDGE_SHARE_X = 0.22;
const EDGE_SHARE_Y = 0.2;
/** Past this many panes the edge zones stop accepting new ones. Not a hard
 *  cap on what a layout can hold — just no convenient way to keep going. */
const SOFT_MAX_PANES = 6;

type Verdict =
  | { ok: true; kind: "split" | "move" | "swap" | "replace" | "rootSplit" | "rootMove"; label: string }
  | { ok: false; why: string };

export function PaneLayout() {
  const t = useT();
  const layout = useSessions((s) => s.layout);
  const activeId = useSessions((s) => s.activeId);
  const sessions = useSessions((s) => s.sessions);
  const drag = usePaneDrag();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const parkRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef(new Map<string, HTMLElement>());

  // An implicit one-leaf tree keeps a single pane and a split on the same
  // rendering path; headers only appear once there are two panes.
  const effective: PaneNode | null = layout ?? (activeId ? tree.leaf(activeId) : null);
  const shown = tree.paneIds(effective);
  const multi = shown.length > 1;

  // Move each session's surface into its slot after every layout paint,
  // parking the ones that aren't on screen.
  useLayoutEffect(() => {
    placeSurfaces(slotRefs.current, sessions.map((s) => s.id), parkRef.current);
  }, [sessions, effective, drag.target]);

  const registerSlot = useCallback((sessionId: string, el: HTMLElement | null) => {
    if (el) slotRefs.current.set(sessionId, el);
    else slotRefs.current.delete(sessionId);
  }, []);

  // ---- what a drop right now would do ----
  const verdictFor = useCallback((target: DragTarget | null): Verdict | null => {
    if (!drag.sessionId || !target) return null;
    const dragged = drag.sessionId;
    const onScreen = shown.includes(dragged);

    if (target.scope === "root") {
      if (onScreen && shown.length === 1) return { ok: false, why: t("Only one pane") };
      if (!onScreen && shown.length >= SOFT_MAX_PANES) {
        return { ok: false, why: `${t("Pane limit")} ${SOFT_MAX_PANES}` };
      }
      const label = {
        left: t("Whole column, far left"), right: t("Whole column, far right"),
        top: t("Whole row, at the top"), bottom: t("Whole row, at the bottom"),
        center: "",
      }[target.zone];
      return { ok: true, kind: onScreen ? "rootMove" : "rootSplit", label };
    }

    const targetId = target.paneId;
    if (!targetId) return null;
    if (targetId === dragged) return { ok: false, why: t("Same pane") };
    if (target.zone === "center") {
      return onScreen
        ? { ok: true, kind: "swap", label: t("Swap") }
        : { ok: true, kind: "replace", label: t("Show here") };
    }
    if (onScreen && shown.length === 1) return { ok: false, why: t("Only one pane") };
    if (!onScreen && shown.length >= SOFT_MAX_PANES) {
      return { ok: false, why: `${t("Pane limit")} ${SOFT_MAX_PANES}` };
    }
    const dirLabel = {
      left: t("Left"), right: t("Right"), top: t("Above"), bottom: t("Below"), center: "",
    }[target.zone];
    return {
      ok: true,
      kind: onScreen ? "move" : "split",
      label: onScreen ? `${t("Move")} · ${dirLabel}` : `${t("Split")} · ${dirLabel}`,
    };
  }, [drag.sessionId, shown, t]);

  // ---- pointer plumbing: one window-level listener pair per drag ----
  useEffect(() => {
    if (!drag.sessionId) return;
    const store = usePaneDrag.getState();

    // A pointer drag still extends the native text selection, which paints
    // half the window blue on the way to the drop. Suppress selection for
    // the length of the press — including the armed phase, so even a click
    // that never becomes a drag can't leave a stray selection behind — and
    // drop whatever was already selected when the press started.
    const body = document.body;
    const prevSelect = body.style.userSelect;
    const prevCursor = body.style.cursor;
    body.style.userSelect = "none";
    body.style.cursor = "grabbing";
    window.getSelection()?.removeAllRanges();

    function targetAt(x: number, y: number): DragTarget | null {
      const root = rootRef.current;
      if (!root) return null;
      const r = root.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;

      const near = Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y);
      if (near <= OUTER_BAND) {
        const zone: DropZone =
          near === y - r.top ? "top"
          : near === r.bottom - y ? "bottom"
          : near === x - r.left ? "left" : "right";
        return { scope: "root", paneId: null, zone };
      }

      const el = document.elementFromPoint(x, y);
      const paneEl = el instanceof Element ? el.closest("[data-pane-id]") : null;
      const paneId = paneEl?.getAttribute("data-pane-id") ?? null;
      if (!paneEl || !paneId) return null;
      const pr = paneEl.getBoundingClientRect();
      const bx = Math.max(EDGE_MIN_X, Math.min(pr.width * EDGE_SHARE_X, pr.width * 0.35));
      const by = Math.max(EDGE_MIN_Y, Math.min(pr.height * EDGE_SHARE_Y, pr.height * 0.35));
      let zone: DropZone = "center";
      if (x - pr.left < bx) zone = "left";
      else if (pr.right - x < bx) zone = "right";
      else if (y - pr.top < by) zone = "top";
      else if (pr.bottom - y < by) zone = "bottom";
      return { scope: "pane", paneId, zone };
    }

    function onMove(e: PointerEvent) {
      if (!store.move(e.clientX, e.clientY)) return;
      usePaneDrag.getState().setTarget(targetAt(e.clientX, e.clientY));
    }

    function onUp() {
      const st = usePaneDrag.getState();
      const dragged = st.sessionId;
      const target = st.target;
      const wasDragging = isDragging(st);
      st.end();
      if (!wasDragging || !dragged || !target) return;
      const v = verdictFor(target);
      if (!v || !v.ok) return;
      const s = useSessions.getState();
      if (target.zone === "center" && target.paneId) {
        if (v.kind === "swap") s.swapPanes(dragged, target.paneId);
        else s.replacePane(target.paneId, dragged);
        return;
      }
      const zone = target.zone as Exclude<DropZone, "center">;
      if (target.scope === "root") {
        if (v.kind === "rootMove") s.moveRoot(dragged, zone);
        else s.splitRoot(zone, dragged);
        return;
      }
      if (!target.paneId) return;
      if (v.kind === "move") s.movePane(dragged, target.paneId, zone);
      else s.splitPane(target.paneId, zone, dragged);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") usePaneDrag.getState().end();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      body.style.userSelect = prevSelect;
      body.style.cursor = prevCursor;
    };
  }, [drag.sessionId, verdictFor]);

  if (!effective) return null;

  return (
    <div ref={rootRef} style={{ position: "absolute", inset: 0, display: "flex", minWidth: 0, minHeight: 0 }}>
      <PaneNodeView
        node={effective}
        path=""
        multi={multi}
        activeId={activeId}
        registerSlot={registerSlot}
      />
      <div ref={parkRef} style={{ display: "none" }} />
      {isDragging(drag) && (
        <DropIndicator
          target={drag.target}
          verdict={verdictFor(drag.target)}
          rootRef={rootRef}
          layout={effective}
        />
      )}
      {isDragging(drag) && (
        <div style={{
          position: "fixed", left: drag.pointer.x + 12, top: drag.pointer.y + 12,
          zIndex: 60, pointerEvents: "none",
          background: "var(--panel-2)", border: "1px solid var(--accent)",
          borderRadius: 6, padding: "4px 10px", fontSize: "var(--font-ui-size)",
          color: "var(--text-1)", whiteSpace: "nowrap",
          boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
        }}>
          {sessions.find((s) => s.id === drag.sessionId)?.label ?? ""}
        </div>
      )}
    </div>
  );
}

function PaneNodeView({
  node, path, multi, activeId, registerSlot,
}: {
  node: PaneNode;
  path: string;
  multi: boolean;
  activeId: string | null;
  registerSlot: (sessionId: string, el: HTMLElement | null) => void;
}) {
  if (node.kind === "leaf") {
    return (
      <Pane
        sessionId={node.sessionId}
        focused={multi && node.sessionId === activeId}
        split={multi}
        registerSlot={registerSlot}
      />
    );
  }
  const row = node.dir === "v";
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: row ? "row" : "column",
      minWidth: 0, minHeight: 0,
    }}>
      {node.kids.map((kid, i) => (
        <Slot key={i} ratio={node.ratios[i]} withGutter={i > 0} path={path} index={i - 1} row={row}>
          <PaneNodeView
            node={kid}
            path={path === "" ? String(i) : `${path}.${i}`}
            multi={multi}
            activeId={activeId}
            registerSlot={registerSlot}
          />
        </Slot>
      ))}
    </div>
  );
}

function Slot({
  ratio, withGutter, path, index, row, children,
}: {
  ratio: number; withGutter: boolean; path: string; index: number; row: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {withGutter && <Gutter path={path} index={index} row={row} />}
      <div style={{ flex: ratio, display: "flex", minWidth: 0, minHeight: 0 }}>{children}</div>
    </>
  );
}

/** Draggable boundary between two siblings. Double-click levels the row. */
function Gutter({ path, index, row }: { path: string; index: number; row: boolean }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const el = ref.current;
    const before = el?.previousElementSibling as HTMLElement | null;
    const after = el?.nextElementSibling as HTMLElement | null;
    if (!before || !after) return;
    const a = before.getBoundingClientRect();
    const b = after.getBoundingClientRect();
    const start = row ? a.left : a.top;
    const span = (row ? b.right - a.left : b.bottom - a.top) || 1;

    function move(ev: PointerEvent) {
      const f = ((row ? ev.clientX : ev.clientY) - start) / span;
      useSessions.getState().setPaneBoundary(path, index, f);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onDoubleClick={() => useSessions.getState().equalizeRow(path)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: "none",
        width: row ? 5 : "auto",
        height: row ? "auto" : 5,
        background: hover ? "var(--accent)" : "var(--border)",
        cursor: row ? "col-resize" : "row-resize",
        transition: "background 120ms",
        zIndex: 3,
      }}
    />
  );
}

function Pane({
  sessionId, focused, split, registerSlot,
}: {
  sessionId: string;
  focused: boolean;
  /** True once there are several panes. A lone pane keeps the original
   *  chrome — the toolbar above the area — and shows no header at all. */
  split: boolean;
  registerSlot: (sessionId: string, el: HTMLElement | null) => void;
}) {
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId));
  const wanted = useSessions((s) => s.activeActivity[sessionId]);
  const hosts = useHostsStore((s) => s.hosts);
  const mode = hosts.find((h) => h.id === (session?.host_id ?? ""))?.connection_mode
    ?? "terminal_only";
  const activity = clampActivity(wanted, activitiesFor(session, mode));
  const label = session?.label ?? sessionId;
  const closed = session?.state === "closed";
  const [hover, setHover] = useState(false);

  return (
    <div
      data-pane-id={sessionId}
      onPointerDown={() => useSessions.getState().setActive(sessionId)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, display: "flex", flexDirection: "column",
        minWidth: 0, minHeight: 0, position: "relative",
        outline: focused ? "1px solid var(--accent)" : "none",
        outlineOffset: -1,
      }}
    >
      {split && (
        <PaneHeader
          sessionId={sessionId}
          label={label}
          closed={!!closed}
          focused={focused}
        />
      )}
      {/* The session's real body is a detached host div that PaneLayout
          appends here — see SessionSurfaces. */}
      <div
        ref={(el) => registerSlot(sessionId, el)}
        style={{ flex: 1, minHeight: 0, position: "relative" }}
      />
      {/* Files, tunnels and monitor dock the switcher in their own header
          row (see ActivitySwitcherSlot). A terminal has no such row, so
          here it floats over the top-right corner — same buttons, same
          gaps, same corner, faint until the pointer is in the pane. */}
      {activity === "terminal" && (
        <div
          style={{
            position: "absolute", top: split ? 27 : 3, right: 4, zIndex: 4,
            opacity: hover ? 1 : 0.42,
            transition: "opacity 120ms ease",
          }}
        >
          <ActivitySwitcher sessionId={sessionId} />
        </div>
      )}
    </div>
  );
}

const ACTIVITY_ICON: Record<ActivityKind, React.ReactNode> = {
  terminal: <Monitor size={11} />,
  files: <Folder size={11} />,
  tunnel: <Network size={11} />,
  monitor: <Activity size={11} />,
};

function PaneHeader({
  sessionId, label, closed, focused,
}: {
  sessionId: string; label: string; closed: boolean; focused: boolean;
}) {
  const t = useT();
  return (
    <div
      onPointerDown={(e) => {
        // The header is the pane's drag handle. A press that never travels
        // stays a plain focus click (see DRAG_THRESHOLD).
        const el = e.target as HTMLElement;
        if (el.closest("[data-pane-pop]") || el.closest("[data-pane-activities]")) return;
        usePaneDrag.getState().arm(sessionId, e.clientX, e.clientY);
      }}
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 6,
        padding: "3px 8px", cursor: "grab",
        background: focused ? "var(--panel-2)" : "var(--panel-1)",
        borderBottom: "1px solid var(--border)",
        fontSize: "calc(var(--font-ui-size) - 2px)",
        color: focused ? "var(--text-1)" : "var(--text-3)",
        whiteSpace: "nowrap", overflow: "hidden", userSelect: "none",
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
        background: closed ? "var(--text-3)" : "var(--success)",
        opacity: closed ? 0.5 : 1,
      }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>

      <span
        data-pane-pop
        role="button"
        aria-label={`${t("Remove from layout")}: ${label}`}
        title={t("Remove from layout")}
        onClick={(e) => {
          e.stopPropagation();
          useSessions.getState().popPane(sessionId);
        }}
        style={{ marginLeft: "auto", display: "flex", cursor: "pointer", opacity: 0.7 }}
      >
        <X size={11} />
      </span>
    </div>
  );
}

/** The translucent preview of where the drop would land. */
function DropIndicator({
  target, verdict, rootRef, layout,
}: {
  target: DragTarget | null;
  verdict: Verdict | null;
  rootRef: React.RefObject<HTMLDivElement | null>;
  layout: PaneNode;
}) {
  if (!target || !verdict) return null;
  const root = rootRef.current;
  if (!root) return null;
  const rr = root.getBoundingClientRect();

  let box: { left: number; top: number; width: number; height: number };

  if (target.scope === "root") {
    // Preview the share it will actually get, so a full-width row reads as
    // one and its thickness isn't a lie.
    const dir = target.zone === "left" || target.zone === "right" ? "v" : "h";
    const joins = layout.kind === "split" && layout.dir === dir;
    const share = 1 / (joins ? layout.kids.length + 1 : 2);
    box = target.zone === "left" ? { left: 0, top: 0, width: rr.width * share, height: rr.height }
      : target.zone === "right" ? { left: rr.width * (1 - share), top: 0, width: rr.width * share, height: rr.height }
      : target.zone === "top" ? { left: 0, top: 0, width: rr.width, height: rr.height * share }
      : { left: 0, top: rr.height * (1 - share), width: rr.width, height: rr.height * share };
  } else {
    const paneEl = root.querySelector(`[data-pane-id="${target.paneId}"]`);
    if (!paneEl) return null;
    const pr = paneEl.getBoundingClientRect();
    const bx = Math.max(EDGE_MIN_X, Math.min(pr.width * EDGE_SHARE_X, pr.width * 0.35));
    const by = Math.max(EDGE_MIN_Y, Math.min(pr.height * EDGE_SHARE_Y, pr.height * 0.35));
    const L = pr.left - rr.left, T = pr.top - rr.top;
    box = target.zone === "left" ? { left: L, top: T, width: bx, height: pr.height }
      : target.zone === "right" ? { left: L + pr.width - bx, top: T, width: bx, height: pr.height }
      : target.zone === "top" ? { left: L + bx, top: T, width: pr.width - 2 * bx, height: by }
      : target.zone === "bottom" ? { left: L + bx, top: T + pr.height - by, width: pr.width - 2 * bx, height: by }
      : { left: L + bx, top: T + by, width: pr.width - 2 * bx, height: pr.height - 2 * by };
  }

  return (
    <div style={{
      position: "absolute", zIndex: 50, pointerEvents: "none",
      left: box.left, top: box.top,
      width: Math.max(0, box.width), height: Math.max(0, box.height),
      background: verdict.ok ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "rgba(140,140,150,0.18)",
      outline: verdict.ok ? "1px solid var(--accent)" : "1px dashed var(--text-3)",
      outlineOffset: -1,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "calc(var(--font-ui-size) - 2px)",
      color: verdict.ok ? "var(--accent)" : "var(--text-2)",
      textAlign: "center", padding: 2,
    }}>
      {verdict.ok ? verdict.label : verdict.why}
    </div>
  );
}
