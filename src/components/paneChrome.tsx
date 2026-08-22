import { Monitor, Folder, Network, Activity } from "lucide-react";
import { useSessions } from "../state/sessions";
import { useHostsStore } from "../state/hosts";
import { activitiesFor, clampActivity } from "../state/activities";
import type { ActivityKind } from "../types/connection";
import { PaneToolbarButton } from "./PaneToolbarButton";
import { useT } from "../i18n";

/**
 * Terminal / Files / Tunnels / Monitor for one session, in exactly one
 * place per pane.
 *
 * Views that own a header row (files, tunnels, monitor) dock it at the
 * right end of that row via `ActivitySwitcherSlot`, so it sits in the same
 * line as their own buttons and shares their metrics — the buttons ARE
 * `PaneToolbarButton`, which is why the spacing can't drift. A terminal has
 * no header row, so there it floats over the top-right corner instead;
 * same buttons, same gaps, same corner.
 */

const ICON: Record<ActivityKind, (size: number) => React.ReactNode> = {
  terminal: (size) => <Monitor size={size} />,
  files: (size) => <Folder size={size} />,
  tunnel: (size) => <Network size={size} />,
  monitor: (size) => <Activity size={size} />,
};

export function ActivitySwitcher({ sessionId }: { sessionId: string }) {
  const t = useT();
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId));
  const wanted = useSessions((s) => s.activeActivity[sessionId]);
  const hosts = useHostsStore((s) => s.hosts);
  const mode = hosts.find((h) => h.id === (session?.host_id ?? ""))?.connection_mode
    ?? "terminal_only";
  const options = activitiesFor(session, mode);
  const current = clampActivity(wanted, options);

  // One activity is no choice — a local shell gets no control at all.
  if (options.length < 2) return null;

  return (
    <span data-pane-activities style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {options.map((o) => (
        <PaneToolbarButton
          key={o.id}
          title={t(o.label)}
          active={o.id === current}
          onClick={(e) => {
            e.stopPropagation();
            useSessions.getState().setActive(sessionId);
            useSessions.getState().setActivity(sessionId, o.id);
          }}
        >{(size) => ICON[o.id](size)}</PaneToolbarButton>
      ))}
    </span>
  );
}

/**
 * Docked placement: a hairline, then the switcher. Views put this at the
 * end of their header row. The divider separates "act on what this view
 * shows" from "choose what this pane shows"; it disappears with the
 * switcher when there's nothing to choose.
 */
export function ActivitySwitcherSlot({ sessionId }: { sessionId: string }) {
  const session = useSessions((s) => s.sessions.find((x) => x.id === sessionId));
  const hosts = useHostsStore((s) => s.hosts);
  const mode = hosts.find((h) => h.id === (session?.host_id ?? ""))?.connection_mode
    ?? "terminal_only";
  if (activitiesFor(session, mode).length < 2) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, marginLeft: "auto" }}>
      <span style={{
        width: 1, height: 14, background: "var(--border-hi)",
        margin: "0 4px", flexShrink: 0,
      }} />
      <ActivitySwitcher sessionId={sessionId} />
    </span>
  );
}
