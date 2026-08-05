import { useEffect, useRef, useCallback } from "react";

interface Props {
  percent: number;
  onChange: (pct: number) => void;
}

export function PaneSplitter({ onChange }: Props) {
  const dragging = useRef(false);
  const containerFinder = useRef<HTMLDivElement | null>(null);

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
      onChange(pct);
    }
    function up() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onChange]);

  return (
    <div ref={containerFinder}
      onMouseDown={onMouseDown}
      onDoubleClick={() => onChange(50)}
      role="separator" aria-orientation="vertical"
      title="Drag to resize, double-click to reset"
      style={{
        width: 6, cursor: "col-resize", flexShrink: 0,
        background: "var(--border)", position: "relative",
      }}
    />
  );
}
