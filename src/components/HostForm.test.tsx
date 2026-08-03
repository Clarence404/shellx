import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { HostForm } from "./HostForm";

vi.mock("../state/hosts", () => ({
  useHostsStore: Object.assign(
    () => ({
      keychainAvailable: true,
      addHost: vi.fn().mockResolvedValue({
        id: "id-1", label: "l", host: "h", port: 22, username: "u",
        notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
      }),
      updateHostById: vi.fn(),
    }),
    { getState: () => ({ keychainAvailable: true }) },
  ),
}));

vi.mock("../ipc/commands", () => ({
  openSshSession: vi.fn().mockResolvedValue({
    id: "sess-1", label: "l", kind: "ssh", host_id: null,
  }),
}));

describe("HostForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create mode: renders 'Save & Connect' when Save this host is checked", async () => {
    const onDone = vi.fn();
    render(<HostForm mode="create" onDone={onDone} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /save & connect/i })).toBeInTheDocument();
  });

  it("create mode: unchecking Save this host changes button to 'Connect'", async () => {
    const user = userEvent.setup();
    render(<HostForm mode="create" onDone={() => {}} onCancel={() => {}} />);
    const checkbox = screen.getByRole("checkbox", { name: /save this host/i });
    await user.click(checkbox);
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save & connect/i })).not.toBeInTheDocument();
  });

  it("edit mode: shows 'Save' button, hides 'Save this host' checkbox", async () => {
    render(<HostForm
      mode="edit"
      initial={{
        id: "id-1", label: "prod-1", host: "10.0.0.1", port: 22,
        username: "chen", notes: null,
        created_at: 0, last_connected_at: null, sort_order: 0,
      }}
      onDone={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /save this host/i })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("prod-1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10.0.0.1")).toBeInTheDocument();
  });
});
