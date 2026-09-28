import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UpdateNotice } from "./UpdateNotice";
import { useUpdater } from "../state/updater";

const NOTES = "# v0.34.0\n\nSomething new landed.\n\n- **A thing.** Detail.";

function setAvailable(overrides: Partial<ReturnType<typeof useUpdater.getState>> = {}) {
  useUpdater.setState({
    status: "available", version: "0.34.0", notes: NOTES, foundSilently: true,
    ...overrides,
  });
}

describe("UpdateNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    useUpdater.setState({
      status: "idle", version: null, notes: null, foundSilently: false,
      progress: 0, received: 0, total: 0, error: null,
    });
  });
  afterEach(cleanup);

  it("renders nothing when there is no silently-found update", () => {
    render(<UpdateNotice />);
    expect(screen.queryByText(/What's new in/)).not.toBeInTheDocument();
  });

  it("does not show for an update found via a manual check", () => {
    setAvailable({ foundSilently: false });
    render(<UpdateNotice />);
    expect(screen.queryByText(/What's new in/)).not.toBeInTheDocument();
  });

  it("shows the version and rendered notes for a silently-found update", () => {
    setAvailable();
    render(<UpdateNotice />);
    expect(screen.getByText(/What's new in/)).toBeInTheDocument();
    expect(screen.getByText(/v0\.34\.0/)).toBeInTheDocument();
    expect(screen.getByText("Something new landed.")).toBeInTheDocument();
  });

  it("dismissing hides it and the dismissal survives a remount for the same version", async () => {
    const user = userEvent.setup();
    setAvailable();
    const { unmount } = render(<UpdateNotice />);
    await user.click(screen.getByRole("button", { name: /later/i }));
    expect(screen.queryByText(/What's new in/)).not.toBeInTheDocument();

    unmount();
    render(<UpdateNotice />);
    expect(screen.queryByText(/What's new in/)).not.toBeInTheDocument();
    expect(localStorage.getItem("shellx.updateNoticeDismissedVersion")).toBe("0.34.0");
  });

  it("a newer version shows again even after the previous one was dismissed", () => {
    localStorage.setItem("shellx.updateNoticeDismissedVersion", "0.33.0");
    setAvailable({ version: "0.34.0" });
    render(<UpdateNotice />);
    expect(screen.getByText(/What's new in/)).toBeInTheDocument();
  });

  it("clicking Download & restart dismisses the card and starts the download", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    setAvailable();
    useUpdater.setState({ downloadAndInstall } as any);
    render(<UpdateNotice />);

    await user.click(screen.getByRole("button", { name: /download & restart/i }));
    expect(downloadAndInstall).toHaveBeenCalled();
    expect(screen.queryByText(/What's new in/)).not.toBeInTheDocument();
  });
});
