import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransferArrow } from "./TransferArrow";
import { useRailFiles } from "../state/railFiles";

// TransferArrow's click handler reads useRailFiles.getState().transfer at
// call time (not a hook-captured reference), so vi.spyOn(getState(), ...)
// below is observed correctly regardless of when it's set relative to
// render. It still calls through to the real store action by default,
// which would otherwise reach the real sftpUpload IPC call (and throw on
// the missing Tauri bridge in jsdom) — hence this mock.
vi.mock("../ipc/transfers", () => ({
  sftpUpload: vi.fn(),
  sftpDownload: vi.fn(),
}));

describe("TransferArrow", () => {
  beforeEach(() => {
    useRailFiles.setState({
      leftPath: "/l", leftEntries: [], leftLoading: false, leftError: null, leftSelected: [],
      rightHost: "h1", rightPath: "/r", rightEntries: [], rightLoading: false, rightError: null, rightSelected: [],
      splitterPercent: 50,
    });
  });

  it("hides entirely when both sides empty (v0.5.7: no idle button)", () => {
    render(<TransferArrow />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("enabled when only left has selection; click fires transfer('up')", () => {
    useRailFiles.setState({ leftSelected: ["a"] });
    const transferSpy = vi.spyOn(useRailFiles.getState(), "transfer");
    render(<TransferArrow />);
    expect(screen.getByRole("button")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(transferSpy).toHaveBeenCalledWith("up");
  });

  it("hides entirely when both sides have selection (ambiguous direction)", () => {
    useRailFiles.setState({ leftSelected: ["a"], rightSelected: ["b"] });
    render(<TransferArrow />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("arrow position tracks splitterPercent when visible", () => {
    // Needs a valid selection so the button actually renders under the
    // new visibility rule.
    useRailFiles.setState({ splitterPercent: 30, leftSelected: ["a"] });
    render(<TransferArrow />);
    const btn = screen.getByRole("button");
    expect(btn.style.left).toBe("30%");
  });
});
