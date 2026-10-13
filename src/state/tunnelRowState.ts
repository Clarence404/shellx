/** What a tunnel row knows about itself, as the view reads it. */
export interface TunnelRowInput {
  /** The backend's last status for this rule, if any. */
  status?: string;
  /** True while a retry is armed or in flight for this rule. */
  hasRetry: boolean;
  /** The retry loop stopped because the credentials were refused. */
  authFailed: boolean;
  /** This rule has reached `active` at least once this app session. */
  wasEverActive: boolean;
  /** An IPC call (start / stop / delete) is in flight from this row. */
  busy: boolean;
}

export interface TunnelRowState {
  isRunning: boolean;
  isError: boolean;
  isAuthFailed: boolean;
  isReconnecting: boolean;
  isFirstConnecting: boolean;
  /** Anything the user may want to call off: forwarding, dialling, or
   *  sitting on an armed retry. The primary button follows this — Stop
   *  when engaged, Start when not. */
  isEngaged: boolean;
}

/**
 * Derive a row's display state.
 *
 * The one that matters is `isEngaged`. The row used to key its primary
 * button on `isRunning` alone, so a rule in the middle of a reconnect
 * loop — not active, by definition — offered Start. Pressing it opened a
 * second attempt alongside the loop instead of ending it, and nothing in
 * the row cancelled the armed timer, so the only way out of a reconnect
 * against an unreachable host was to delete the rule or wait for the
 * attempt limit.
 */
export function tunnelRowState(input: TunnelRowInput): TunnelRowState {
  const { status, hasRetry, authFailed, wasEverActive, busy } = input;
  const isRunning = status === "active";
  const isError = status === "error";
  const isAuthFailed = hasRetry && authFailed;
  // "Reconnecting" only makes sense once the tunnel has actually been
  // active at least once — otherwise a retry armed by an initial-connect
  // failure (autostart on a not-yet-reachable host, say) would read as a
  // reconnect even though nothing has ever connected.
  const isReconnecting = hasRetry && !isAuthFailed && wasEverActive;
  // First-time-connecting covers two overlapping cases:
  //  · the openTunnelViaHost await right after the user hits Start
  //  · a retry loop for a rule that has never reached active yet
  const isFirstConnecting =
    (busy && !isRunning && !isReconnecting) ||
    (hasRetry && !isAuthFailed && !wasEverActive);
  // An auth failure is deliberately not engaged: nothing is scheduled,
  // and the row offers Retry rather than Stop.
  return {
    isRunning,
    isError,
    isAuthFailed,
    isReconnecting,
    isFirstConnecting,
    isEngaged: isRunning || isReconnecting || isFirstConnecting,
  };
}

/**
 * How far through the retry loop this rule is, as words.
 *
 * A limit of 0 (Settings → Advanced) means it never gives up, so there
 * is no total to name and the label just counts up.
 */
export function attemptLabel(attempt: number, limit: number, t: (key: string) => string): string {
  // No "#" before the number: the Chinese strings around this read
  // "第 N 次失败", and "第 #N 次失败" has a stray glyph in the middle.
  return limit > 0 ? `${t("Attempt")} ${attempt}/${limit}` : `${t("Attempt")} ${attempt}`;
}
