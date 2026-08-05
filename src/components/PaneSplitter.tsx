import { useEffect, useRef, useCallback } from "react";

interface Props {
  percent: number;
  /** Fired on every mousemove during a drag — keep this in-memory only (no persistence). */
  onChange: (pct: number) => void;
  /** Fired once when the drag ends (mouseup) or on the double-click reset — safe to persist here. */
  onCommit: (pct: number) => void;
}

export function PaneSplitter({ onChange, onCommit }: Props) {
  const dragging = useRef(false);
  const containerFinder = useRef<HTMLDivElement | null>(null);
  const lastPct = useRef<number | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    e.preventDefault();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function move(e: MouseEvent) {
      if (!dragging.current) return;
      const parent = containerFinder.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      lastPct.current = pct;
      onChange(pct);
    }
    function up() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (lastPct.current != null) {
        onCommit(lastPct.current);
        lastPct.current = null;
      }
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onChange, onCommit]);

  return (
    <div ref={containerFinder}
      onMouseDown={onMouseDown}
      onDoubleClick={() => onCommit(50)}
      role="separator" aria-orientation="vertical"
      title="Drag to resize, double-click to reset"
      style={{
        width: 6, cursor: "col-resize", flexShrink: 0,
        background: "var(--border)", position: "relative",
      }}
    />
  );
}
