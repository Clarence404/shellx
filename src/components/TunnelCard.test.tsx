import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const closeTunnel = vi.fn();
const openTunnelViaHost = vi.fn();
vi.mock("../ipc/tunnels", () => ({
  listTunnelsForHost: vi.fn().mockResolvedValue([]),
  listActiveTunnels: vi.fn().mockResolvedValue([]),
  openTunnelViaHost: (...a: unknown[]) => openTunnelViaHost(...a),
  closeTunnel: (...a: unknown[]) => closeTunnel(...a),
  addTunnel: vi.fn(), updateTunnel: vi.fn(), deleteTunnel: vi.fn(), reorderTunnels: vi.fn(),
}));
vi.mock("../ipc/logs", () => ({ logPush: vi.fn().mockResolvedValue(undefined) }));

import { TunnelCard } from "./GlobalTunnelsView";
import { useToasts } from "../state/toasts";
import type { TunnelRule, TunnelStatus } from "../types/tunnel";
import type { HostInfo } from "../types/host";

const HOST: HostInfo = {
  id: "h1", label: "bastion", host: "10.0.0.9", port: 22, username: "ec2-user",
  notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
  auth_method: "publickey", key_path: "/home/me/.ssh/id_ed25519",
  connection_mode: "term_tunnels", group_name: null,
};

const RULE: TunnelRule = {
  id: "r1", host_id: "h1", label: "Test-PG",
  local_port: 15432, remote_host: "db.internal", remote_port: 5432,
  bind_all: true, auto_reconnect: true, autostart: false, sort_order: 0,
} as TunnelRule;

const writeText = vi.fn();

function renderCard(over: Partial<Parameters<typeof TunnelCard>[0]> = {}) {
  const props = {
    rule: RULE, host: HOST, sessionId: null as string | null,
    status: undefined as TunnelStatus | undefined,
    retry: undefined, wasEverActive: false,
    isDragging: false, isDragOver: false,
    onGripPointerDown: vi.fn(), rowRef: vi.fn(),
    onEdit: vi.fn(), onRegisterRuleSession: vi.fn(), onForgetRuleSession: vi.fn(),
    onMarkStopIntent: vi.fn(), onCancelRetry: vi.fn(), onManualRetry: vi.fn(),
    onDeleted: vi.fn(),
    ...over,
  };
  return { props, ...render(<TunnelCard {...(props as Parameters<typeof TunnelCard>[0])} />) };
}

/** `userEvent.setup()` installs its own clipboard stub, so ours goes back
 *  afterwards — otherwise the component's writes land somewhere the test
 *  cannot see and every clipboard assertion fails while the feature works. */
function setupUser() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return user;
}

/** A retry waiting on its timer, the state the Stop button used to miss. */
const WAITING = { attempt: 7, nextRetryAt: Date.now() + 56_000, authFailed: false, timer: 1 };

beforeEach(() => {
  writeText.mockReset();
  closeTunnel.mockReset().mockResolvedValue(undefined);
  openTunnelViaHost.mockReset().mockResolvedValue({ session_id: "s1" });
  useToasts.setState({ toasts: [] });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

describe("the copy button", () => {
  it("copies the local address on a left click", async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole("button", { name: /Copy local address/ }));
    expect(writeText).toHaveBeenCalledWith("0.0.0.0:15432");
  });

  it("does not open the edit panel — copying is not editing", async () => {
    const user = setupUser();
    const { props } = renderCard();
    await user.click(screen.getByRole("button", { name: /Copy local address/ }));
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it("says what went to the clipboard", async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole("button", { name: /Copy local address/ }));
    const [toast] = useToasts.getState().toasts;
    expect(toast.body).toBe("0.0.0.0:15432");
  });

  it("offers the ssh command on a right click", async () => {
    const user = setupUser();
    renderCard();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Copy local address/ }));
    await user.click(screen.getByText("ssh command"));
    expect(writeText).toHaveBeenCalledWith(
      "ssh -L 0.0.0.0:15432:db.internal:5432 -i /home/me/.ssh/id_ed25519 ec2-user@10.0.0.9",
    );
  });

  it("choosing from that menu does not open the edit panel either", async () => {
    const user = setupUser();
    const { props } = renderCard();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Copy local address/ }));
    await user.click(screen.getByText("ssh command"));
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it("the menu also copies the plain address", async () => {
    const user = setupUser();
    renderCard();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Copy local address/ }));
    await user.click(screen.getByText("Local address"));
    expect(writeText).toHaveBeenCalledWith("0.0.0.0:15432");
  });
});

describe("Stop and Start", () => {
  const active = { rule_id: "r1", status: "active" } as TunnelStatus;

  it("offers Start when the rule is stopped", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("offers Stop while forwarding, and closes the tunnel", async () => {
    const user = setupUser();
    renderCard({ status: active, sessionId: "s1" });
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(closeTunnel).toHaveBeenCalledWith("s1", "r1");
  });

  it("offers Stop while reconnecting, when there is no session to close", () => {
    renderCard({ retry: WAITING, wasEverActive: true, status: { rule_id: "r1", status: "error" } as TunnelStatus });
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("stopping a reconnect cancels the armed retry rather than doing nothing", async () => {
    const user = setupUser();
    const { props } = renderCard({ retry: WAITING, wasEverActive: true });
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(props.onCancelRetry).toHaveBeenCalledWith("r1");
    expect(props.onMarkStopIntent).toHaveBeenCalledWith("r1");
    expect(props.onForgetRuleSession).toHaveBeenCalledWith("r1");
    expect(closeTunnel).not.toHaveBeenCalled();
  });
});

describe("the retry hint", () => {
  it("names the attempt limit, so the loop's end is visible", () => {
    renderCard({ retry: WAITING, wasEverActive: true });
    expect(screen.getByText(/Attempt 7\/10/)).toBeInTheDocument();
  });

  it("offers a way out of the backoff", async () => {
    const user = setupUser();
    const { props } = renderCard({ retry: WAITING, wasEverActive: true });
    await user.click(screen.getByRole("button", { name: "Retry now" }));
    expect(props.onCancelRetry).toHaveBeenCalledWith("r1");
    expect(props.onManualRetry).toHaveBeenCalledWith("r1");
  });

  it("is absent when nothing is being retried", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: "Retry now" })).toBeNull();
  });
});
