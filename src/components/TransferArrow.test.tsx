import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransferArrow } from "./TransferArrow";
import { useRailFiles } from "../state/railFiles";

// vi.spyOn(useRailFiles.getState(), "transfer") calls through to the real
// store action by default, which would otherwise reach the real sftpUpload
// IPC call (and throw on the missing Tauri bridge in jsdom).
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

  it("disabled when both sides empty", () => {
    render(<TransferArrow />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("enabled when only left has selection; click fires transfer('up')", () => {
    useRailFiles.setState({ leftSelected: ["a"] });
    const transferSpy = vi.spyOn(useRailFiles.getState(), "transfer");
    render(<TransferArrow />);
    expect(screen.getByRole("button")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(transferSpy).toHaveBeenCalledWith("up");
  });

  it("disabled when both sides have selection", () => {
    useRailFiles.setState({ leftSelected: ["a"], rightSelected: ["b"] });
    render(<TransferArrow />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
