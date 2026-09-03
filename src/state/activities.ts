import type { ActivityKind, ConnectionInfo } from "../types/connection";

/**
 * Which activities a session can show, and which one it is showing.
 *
 * This lived inline in App while one toolbar drove one visible session.
 * Every pane carries its own switcher now, so the rule has to be callable
 * per session rather than once per window.
 */

export interface ActivityOption {
  id: ActivityKind;
  label: string;
}

const TERMINAL: ActivityOption = { id: "terminal", label: "Terminal" };
const FILES: ActivityOption = { id: "files", label: "Files" };
const TUNNEL: ActivityOption = { id: "tunnel", label: "Tunnels" };
const MONITOR: ActivityOption = { id: "monitor", label: "Monitor" };

/** `connectionMode` comes from the saved host; unsaved hosts get the default. */
export function activitiesFor(
  session: Pick<ConnectionInfo, "kind"> | null | undefined,
  connectionMode: string,
): ActivityOption[] {
  // A local shell or a serial line has no SSH subsystems to offer.
  if (session?.kind === "local" || session?.kind === "serial") return [TERMINAL];
  if (connectionMode === "tunnels_only") return [TUNNEL];
  if (connectionMode === "term_tunnels") return [TERMINAL, FILES, TUNNEL, MONITOR];
  return [TERMINAL, FILES, MONITOR];
}

/** The wanted activity when it's on offer, else the session's first one. */
export function clampActivity(
  wanted: ActivityKind | undefined,
  options: ActivityOption[],
): ActivityKind {
  return options.some((o) => o.id === wanted) ? (wanted as ActivityKind) : options[0].id;
}
