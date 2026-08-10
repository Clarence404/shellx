import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../ipc/tunnels", () => ({
  listTunnelsForHost: vi.fn().mockResolvedValue([]),
  openTunnel: vi.fn(), closeTunnel: vi.fn(),
  updateTunnel: vi.fn(), addTunnel: vi.fn(),
}));

import { TunnelsPanel } from "../TunnelsPanel";

describe("TunnelsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders header with 0 rules", async () => {
    render(<TunnelsPanel sessionId="s1" hostId="h1" connectionMode="term_tunnels" />);
    // Panel mounts without error; the header shows "0 rules"
    expect(await screen.findByText(/0 rules/)).toBeTruthy();
  });
});
