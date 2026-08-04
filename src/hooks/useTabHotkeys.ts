import { useEffect } from "react";

interface Handlers {
  onNewTab: () => void;
  onCloseTab: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
}

export function useTabHotkeys({ onNewTab, onCloseTab, onNextTab, onPrevTab }: Handlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        onNewTab();
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        onCloseTab();
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) onPrevTab();
        else onNextTab();
      }
    };
    window.addEventListener("keydown", handler, true); // capture phase
    return () => window.removeEventListener("keydown", handler, true);
  }, [onNewTab, onCloseTab, onNextTab, onPrevTab]);
}
