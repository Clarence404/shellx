import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FileBrowserView } from "./FileBrowserView";
import { useFilesStore } from "../state/files";
import { sftpRealpath, sftpListDir } from "../ipc/sftp";

// The other FileBrowserView suite mocks the whole files store with
// pre-seeded data — which is exactly why a bug in the FIRST load could
// hide there. This suite uses the real store and mocks only the IPC, so
// the path from "tab just opened" to "rows on screen" is what runs.
vi.mock("../ipc/sftp", () => ({
  sftpRealpath: vi.fn(),
  sftpListDir: vi.fn(),
  sftpMkdir: vi.fn(),
  sftpRename: vi.fn(),
  sftpRemoveFile: vi.fn(),
  sftpRemoveDir: vi.fn(),
}));
vi.mock("../ipc/transfers", () => ({
  sftpUpload: vi.fn(),
  sftpDownload: vi.fn(),
  sftpUploadDir: vi.fn(),
  sftpDownloadDir: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));

describe("FileBrowserView first load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFilesStore.setState({ perConnection: {} });
  });
  afterEach(cleanup);

  it("a fresh session resolves home and lists it — the pane must never sit on Loading forever", async () => {
    // Regression: v0.21.1 aliased the render state to a truthy stand-in
    // so the header always renders, and the initial-load guard kept
    // checking that alias — always truthy, so realpath never fired and
    // the pane loaded nothing, forever, with an empty backend log.
    (sftpRealpath as ReturnType<typeof vi.fn>).mockResolvedValue("/root");
    (sftpListDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "logs", kind: "directory", size: 0, modified: null, permissions: 0o755 },
      { name: "ip.log", kind: "file", size: 7400, modified: null, permissions: 0o644 },
    ]);

    render(<FileBrowserView connectionId="fresh" />);
    expect(await screen.findByText("logs")).toBeInTheDocument();
    expect(screen.getByText("ip.log")).toBeInTheDocument();
    expect(sftpRealpath).toHaveBeenCalledWith("fresh", ".");
    expect(sftpListDir).toHaveBeenCalledWith("fresh", "/root");
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("falls back to / when home cannot be resolved", async () => {
    (sftpRealpath as ReturnType<typeof vi.fn>).mockRejectedValue("no realpath");
    (sftpListDir as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<FileBrowserView connectionId="fresh" />);
    await vi.waitFor(() => expect(sftpListDir).toHaveBeenCalledWith("fresh", "/"));
  });

  it("a listing that fails shows the reason, not Loading", async () => {
    (sftpRealpath as ReturnType<typeof vi.fn>).mockResolvedValue("/root");
    (sftpListDir as ReturnType<typeof vi.fn>).mockRejectedValue("list directory timed out — the connection may be dead; reconnect and try again");

    render(<FileBrowserView connectionId="fresh" />);
    expect(await screen.findByText(/timed out/)).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});
