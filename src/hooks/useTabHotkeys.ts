import { useEffect } from "react";

interface Handlers {
  onNewTab: () => void;
  onCloseTab: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
}

const isMac = () => navigator.userAgent.includes("Mac");

export function useTabHotkeys({ onNewTab, onCloseTab, onNextTab, onPrevTab }: Handlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "t" || e.key === "T") {
        // Windows/Linux: Ctrl+T is the browser/OS "new tab" chord and can
        // conflict with terminal muscle memory, so require Shift there.
        // macOS keeps plain Cmd+T since Ctrl isn't the modifier in play.
        if (!e.shiftKey && !isMac()) return;
        e.preventDefault();
        onNewTab();
      } else if (e.key === "w" || e.key === "W") {
        if (!e.shiftKey && !isMac()) return;
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
