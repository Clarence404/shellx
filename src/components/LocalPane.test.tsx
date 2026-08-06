import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalPane } from "./LocalPane";
import { useRailFiles } from "../state/railFiles";

vi.mock("../ipc/local", () => ({
  localDefaultRoots: vi.fn().mockResolvedValue({ home: "/home/chen", desktop: "", downloads: "" }),
  localOpenInOs: vi.fn().mockResolvedValue(undefined),
  localMkdir: vi.fn(), localRename: vi.fn(),
  localRemoveFile: vi.fn(), localRemoveDir: vi.fn(),
  localRealpath: vi.fn(async (p: string) => p),
  localListDir: vi.fn(async () => []),
  localCopyInto: vi.fn().mockResolvedValue(undefined),
}));

// v0.5.7 added an OS drag-drop listener via getCurrentWindow(). Same
// mock RemotePane uses — jsdom has no `window.__TAURI_INTERNALS__`.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

vi.mock("../ipc/transfers", () => ({
  sftpUpload: vi.fn(),
  sftpDownload: vi.fn(),
}));

describe("LocalPane", () => {
  beforeEach(() => {
    useRailFiles.setState({
      leftPath: "/home/chen",
      leftEntries: [
        { name: "notes.md", kind: "file", size: 1, modified: null, permissions: 0 },
        { name: "docs", kind: "directory", size: 0, modified: null, permissions: 0 },
      ],
      leftLoading: false, leftError: null, leftSelected: [],
    });
  });

  it("double-click on file opens in OS, not upload", async () => {
    const { localOpenInOs } = await import("../ipc/local");
    render(<LocalPane />);
    const row = await screen.findByText("notes.md");
    fireEvent.doubleClick(row);
    expect(localOpenInOs).toHaveBeenCalledWith("/home/chen/notes.md");
  });

  it("double-click on folder navigates (setLeftPath called)", async () => {
    render(<LocalPane />);
    const setLeftPath = vi.spyOn(useRailFiles.getState(), "setLeftPath");
    const row = await screen.findByText("docs");
    fireEvent.doubleClick(row);
    expect(setLeftPath).toHaveBeenCalledWith("/home/chen/docs");
  });

  it("mounts with a persisted leftPath but empty entries → auto-loads", async () => {
    const { localListDir } = await import("../ipc/local");
    useRailFiles.setState({
      leftPath: "/home/chen",
      leftEntries: [],  // cold-restart state: path rehydrated, entries not
      leftLoading: false, leftError: null, leftSelected: [],
    });
    render(<LocalPane />);
    // Wait a tick for the effect to fire loadLeft → localListDir
    await new Promise((r) => setTimeout(r, 0));
    expect(localListDir).toHaveBeenCalledWith("/home/chen");
  });
});
