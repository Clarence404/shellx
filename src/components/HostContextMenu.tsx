import { useEffect, useRef } from "react";

interface MenuItem {
  label: string;
  onClick: () => void;
  variant?: "danger";
}

export function HostContextMenu({
  x, y, items, onClose,
}: {
  x: number; y: number; items: MenuItem[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" style={{
      position: "fixed", top: y, left: x,
      background: "var(--panel-2)", border: "1px solid var(--border)",
      borderRadius: 5, padding: 4, zIndex: 200,
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      minWidth: 130,
    }}>
      {items.map((item, i) => (
        <button
          key={i}
          role="menuitem"
          onClick={() => { item.onClick(); onClose(); }}
          style={{
            display: "block", width: "100%", padding: "5px 10px",
            fontSize: 11, textAlign: "left",
            color: item.variant === "danger" ? "var(--error)" : "var(--text-1)",
            borderRadius: 3,
            background: "transparent",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--border)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >{item.label}</button>
      ))}
    </div>
  );
}
