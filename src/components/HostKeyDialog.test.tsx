import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HostKeyDialog } from "./HostKeyDialog";
import { useChallenges } from "../state/challenges";

vi.mock("../ipc/hostkeys", () => ({
  hostkeyRespond: vi.fn().mockResolvedValue(undefined),
}));
import { hostkeyRespond } from "../ipc/hostkeys";

const UNKNOWN: import("../ipc/hostkeys").HostkeyChallenge = {
  attemptId: "a1", host: "test-bastion", port: 22, keyType: "ssh-ed25519",
  fingerprint: "SHA256:abc", verdict: "unknown", storedFingerprint: null,
};
const MISMATCH: import("../ipc/hostkeys").HostkeyChallenge = {
  ...UNKNOWN, attemptId: "a2", verdict: "mismatch", storedFingerprint: "SHA256:old",
};

beforeEach(() => {
  useChallenges.setState({ pending: [] });
  vi.clearAllMocks();
});

describe("HostKeyDialog", () => {
  it("renders nothing with no pending challenge", () => {
    const { container } = render(<HostKeyDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("unknown variant shows fingerprint and trusts on accept click", () => {
    useChallenges.getState().push(UNKNOWN);
    render(<HostKeyDialog />);
    expect(screen.getByText(/SHA256:abc/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /信任并保存/ }));
    expect(hostkeyRespond).toHaveBeenCalledWith("a1", true);
  });

  it("unknown variant cancels on cancel button", () => {
    useChallenges.getState().push(UNKNOWN);
    render(<HostKeyDialog />);
    fireEvent.click(screen.getByRole("button", { name: /取消连接/ }));
    expect(hostkeyRespond).toHaveBeenCalledWith("a1", false);
  });

  it("mismatch variant shows both fingerprints", () => {
    useChallenges.getState().push(MISMATCH);
    render(<HostKeyDialog />);
    expect(screen.getByText(/SHA256:old/)).toBeInTheDocument();
    expect(screen.getByText(/SHA256:abc/)).toBeInTheDocument();
  });

  it("mismatch cancel button calls resolve with false", () => {
    useChallenges.getState().push(MISMATCH);
    render(<HostKeyDialog />);
    fireEvent.click(screen.getByRole("button", { name: /取消连接/ }));
    expect(hostkeyRespond).toHaveBeenCalledWith("a2", false);
  });

  it("Escape declines", () => {
    useChallenges.getState().push(UNKNOWN);
    render(<HostKeyDialog />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(hostkeyRespond).toHaveBeenCalledWith("a1", false);
  });

  it("Enter accepts for unknown variant", () => {
    useChallenges.getState().push(UNKNOWN);
    render(<HostKeyDialog />);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(hostkeyRespond).toHaveBeenCalledWith("a1", true);
  });

  it("Enter declines for mismatch variant", () => {
    useChallenges.getState().push(MISMATCH);
    render(<HostKeyDialog />);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(hostkeyRespond).toHaveBeenCalledWith("a2", false);
  });
});
