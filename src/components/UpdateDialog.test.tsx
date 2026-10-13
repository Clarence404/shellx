import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockCheck = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a: unknown[]) => mockCheck(...a) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("../ipc/logs", () => ({ logPush: vi.fn().mockResolvedValue(undefined) }));

import { UpdateDialog } from "./UpdateDialog";
import { UpdatePill } from "./UpdatePill";
import { useUpdater } from "../state/updater";

const NOTES = "# v0.34.0\n\nSomething new landed.\n\n- **A thing.** Detail.\n\n---\n\n> Installers below are unsigned.";
const SEEN = "shellx.updateNoticeDismissedVersion";
const IGNORED = "shellx.updateIgnoredVersion";

function setAvailable(over: Partial<ReturnType<typeof useUpdater.getState>> = {}) {
  useUpdater.setState({ status: "available", version: "0.34.0", notes: NOTES, dialogOpen: true, ignored: null, ...over });
}

beforeEach(() => {
  localStorage.clear();
  mockCheck.mockReset();
  useUpdater.setState({
    status: "idle", version: null, notes: null, dialogOpen: false, ignored: null,
    progress: 0, received: 0, total: 0, error: null, errorPhase: null,
  });
});
afterEach(cleanup);

describe("UpdateDialog", () => {
  it("renders nothing until it is opened", () => {
    setAvailable({ dialogOpen: false });
    render(<UpdateDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the version, current → new, and the rendered release notes", () => {
    setAvailable();
    render(<UpdateDialog />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("v0.34.0");
    expect(dialog).toHaveTextContent(/Current version v.*→ New version v0\.34\.0/);
    expect(screen.getByText("Something new landed.")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("A thing. Detail.");
    // the standing installer footer is not "what's new"
    expect(screen.queryByText(/Installers below are unsigned/)).toBeNull();
  });

  it("says so when the release published no notes, instead of an empty box", () => {
    setAvailable({ notes: "" });
    render(<UpdateDialog />);
    expect(screen.getByText(/No release notes were published/)).toBeInTheDocument();
  });

  it("closing counts as having seen this version", async () => {
    const user = userEvent.setup();
    setAvailable();
    render(<UpdateDialog />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(SEEN)).toBe("0.34.0");
    expect(localStorage.getItem(IGNORED)).toBeNull();
  });

  it("Esc closes it, and so does clicking outside", async () => {
    const user = userEvent.setup();
    setAvailable();
    render(<UpdateDialog />);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    setAvailable();
    fireEvent.click(await screen.findByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Skip this version remembers it as ignored", async () => {
    const user = userEvent.setup();
    setAvailable();
    render(<UpdateDialog />);
    await user.click(screen.getByRole("button", { name: "Skip this version" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(IGNORED)).toBe("0.34.0");
    expect(useUpdater.getState().ignored).toBe("0.34.0");
  });

  it("offers the download page as a plain link", () => {
    setAvailable();
    render(<UpdateDialog />);
    const link = screen.getByRole("link", { name: "Open download page" });
    expect(link).toHaveAttribute("href", expect.stringContaining("github.com/Clarence404/shellx/releases"));
  });

  it("Download & restart starts the download", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    setAvailable();
    useUpdater.setState({ downloadAndInstall });
    render(<UpdateDialog />);
    await user.click(screen.getByRole("button", { name: "Download & restart" }));
    expect(downloadAndInstall).toHaveBeenCalled();
  });

  it("while downloading it shows progress instead of the buttons", () => {
    setAvailable({ status: "downloading", progress: 0.4, received: 2 * 1024 * 1024, total: 5 * 1024 * 1024 });
    render(<UpdateDialog />);
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText(/2\.0 MB \/ 5\.0 MB/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download & restart" })).toBeNull();
  });

  it("after a failed download it says so and offers Retry", () => {
    setAvailable({ status: "error", error: "disk full", errorPhase: "download" });
    render(<UpdateDialog />);
    expect(screen.getByText(/download didn't finish/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("when the dialog opens by itself", () => {
  const found = { version: "0.34.0", body: NOTES, downloadAndInstall: vi.fn() };

  it("a silent startup check that finds an update opens it", async () => {
    mockCheck.mockResolvedValue(found);
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().dialogOpen).toBe(true);
    expect(useUpdater.getState().notes).toBe(NOTES);
  });

  it("a manual check does not — the user is already in Settings → About", async () => {
    mockCheck.mockResolvedValue(found);
    await useUpdater.getState().check(false);
    expect(useUpdater.getState().status).toBe("available");
    expect(useUpdater.getState().dialogOpen).toBe(false);
  });

  it("not again for a version that was already seen", async () => {
    localStorage.setItem(SEEN, "0.34.0");
    mockCheck.mockResolvedValue(found);
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().dialogOpen).toBe(false);
  });

  it("not for a version the user skipped", async () => {
    localStorage.setItem(IGNORED, "0.34.0");
    mockCheck.mockResolvedValue(found);
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().dialogOpen).toBe(false);
  });

  it("a newer version opens it again after an older one was seen or skipped", async () => {
    localStorage.setItem(SEEN, "0.33.0");
    localStorage.setItem(IGNORED, "0.33.0");
    mockCheck.mockResolvedValue(found);
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().dialogOpen).toBe(true);
  });
});

describe("UpdatePill (titlebar button)", () => {
  const found = { version: "0.34.0", body: NOTES, downloadAndInstall: vi.fn() };

  it("is a quiet check-for-updates button when there is nothing to update to", () => {
    render(<UpdatePill />);
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update available" })).toBeNull();
  });

  it("clicking it checks, and a found update opens the dialog", async () => {
    const user = userEvent.setup();
    mockCheck.mockResolvedValue(found);
    render(<UpdatePill />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(useUpdater.getState().dialogOpen).toBe(true);
  });

  it("when already current it says so in the dialog instead of flashing past", async () => {
    const user = userEvent.setup();
    mockCheck.mockResolvedValue(null);
    render(<><UpdatePill /><UpdateDialog /></>);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(useUpdater.getState().status).toBe("upToDate");
    expect(useUpdater.getState().dialogOpen).toBe(true);
    expect(screen.getByRole("dialog")).toHaveTextContent("shellx is up to date");
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("a failed check says so, and does not claim a download went wrong", async () => {
    const user = userEvent.setup();
    mockCheck.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    render(<><UpdatePill /><UpdateDialog /></>);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Could not check for updates/);
    expect(dialog).not.toHaveTextContent(/download didn't finish/);
  });

  it("becomes the blue Update pill while one is waiting, and reopens the dialog", async () => {
    const user = userEvent.setup();
    setAvailable({ dialogOpen: false });
    render(<UpdatePill />);
    expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Update available" }));
    expect(useUpdater.getState().dialogOpen).toBe(true);
  });

  it("goes back to the quiet button once that version is skipped", () => {
    setAvailable({ dialogOpen: false, ignored: "0.34.0" });
    render(<UpdatePill />);
    expect(screen.queryByRole("button", { name: "Update available" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();
  });

  it("a click on a skipped version still shows it", async () => {
    const user = userEvent.setup();
    localStorage.setItem(IGNORED, "0.34.0");
    useUpdater.setState({ ignored: "0.34.0" });
    mockCheck.mockResolvedValue(found);
    render(<UpdatePill />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(useUpdater.getState().dialogOpen).toBe(true);
  });

  it("shows the percentage while downloading", () => {
    setAvailable({ status: "downloading", progress: 0.25, dialogOpen: false });
    render(<UpdatePill />);
    expect(screen.getByRole("button", { name: "Update available" })).toHaveTextContent("25%");
  });
});
