import type { ReactNode, MouseEventHandler } from "react";
import { useSettingsStore } from "../state/settings";

/**
 * Shared icon-button for LocalPane / RemotePane header toolbars
 * (New folder, Refresh, Upload).
 *
 * Two v0.5.6 changes vs the ad-hoc `<button>` these replaced:
 * - Icon size scales with `systemFontSize` (`Math.max(14, size + 2)`),
 *   so pulling the Appearance → System font-size slider grows the icons
 *   in step with the rest of the sans chrome. 14 px floor guarantees a
 *   tappable target even at the slider's minimum (11 px).
 * - Padding widened from ~0 to 5×6 px so the click surface is a
 *   comfortable ~26 × 26 hitbox at defaults (was ~12 × 12, users
 *   consistently mis-fired).
 */
export function PaneToolbarButton({
  title, label, onClick, disabled, active, children,
}: {
  title: string;
  /** Optional trailing text — icon + label variant (New folder, Upload).
   *  Without it, the button is icon-only (Refresh). Label text uses
   *  --font-ui-size so it scales with the System font-size slider too. */
  label?: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  /** Pressed state — used by the activity switcher, whose buttons are a
   *  choice rather than an action. */
  active?: boolean;
  /** Render prop — receives the icon size to apply via `<Icon size={n} />`. */
  children: (iconSize: number) => ReactNode;
}) {
  const systemFontSize = useSettingsStore((s) => s.systemFontSize);
  const iconSize = Math.max(14, systemFontSize + 2);
  return (
    <button
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: label ? 5 : 0,
        padding: label ? "5px 9px" : "5px 6px",
        borderRadius: 4,
        background: active ? "var(--wash, var(--border))" : "transparent",
        color: active ? "var(--accent)" : disabled ? "var(--text-3)" : "var(--text-2)",
        opacity: disabled ? 0.4 : 1,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        fontSize: "var(--font-ui-size)",
      }}
      onMouseEnter={(e) => { if (!disabled && !active) (e.currentTarget as HTMLElement).style.background = "var(--border)"; }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = active ? "var(--wash, var(--border))" : "transparent";
      }}
    >
      {children(iconSize)}
      {label && <span>{label}</span>}
    </button>
  );
}
