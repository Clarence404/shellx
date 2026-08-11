import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../ipc/hostkeys", () => ({
  hostkeysList: vi.fn().mockResolvedValue([
    { host: "test-bastion.company.com", key_type: "ssh-ed25519", fingerprint: "SHA256:abc" },
  ]),
  onHostkeyChallenge: vi.fn().mockResolvedValue(() => {}),
  hostkeyRespond: vi.fn().mockResolvedValue(undefined),
}));

import { TrustedServersPanel } from "./TrustedServersPanel";

describe("TrustedServersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists trusted hosts with type and fingerprint", async () => {
    const { hostkeysList } = await import("../../ipc/hostkeys");
    (hostkeysList as ReturnType<typeof vi.fn>).mockResolvedValue([
      { host: "test-bastion.company.com", key_type: "ssh-ed25519", fingerprint: "SHA256:abc" },
    ]);
    render(<TrustedServersPanel />);
    expect(await screen.findByText("test-bastion.company.com")).toBeInTheDocument();
    expect(screen.getByText("ssh-ed25519")).toBeInTheDocument();
    expect(screen.getByText(/SHA256:abc/)).toBeInTheDocument();
  });

  it("shows empty state when no entries", async () => {
    const { hostkeysList } = await import("../../ipc/hostkeys");
    (hostkeysList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<TrustedServersPanel />);
    expect(await screen.findByText(/No entries/)).toBeInTheDocument();
  });

  it("shows copy button for each row", async () => {
    const { hostkeysList } = await import("../../ipc/hostkeys");
    (hostkeysList as ReturnType<typeof vi.fn>).mockResolvedValue([
      { host: "test-bastion.company.com", key_type: "ssh-ed25519", fingerprint: "SHA256:abc" },
    ]);
    render(<TrustedServersPanel />);
    const btn = await screen.findByRole("button", { name: /Copy/ });
    expect(btn).toBeInTheDocument();
  });
});
