import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RemotePane } from "./RemotePane";
import { useRailFiles } from "../state/railFiles";
import { useSessions } from "../state/sessions";

vi.mock("../ipc/sftp", () => ({
  sftpListDir: vi.fn(async () => []),
  sftpRealpath: vi.fn(async () => "/root"),
  sftpMkdir: vi.fn(), sftpRename: vi.fn(),
  sftpRemoveFile: vi.fn(), sftpRemoveDir: vi.fn(),
}));
vi.mock("../ipc/transfers", () => ({
  sftpDownload: vi.fn(),
  sftpUpload: vi.fn(),
}));

// v0.5.6 added an OS drag-drop listener via getCurrentWindow(). In jsdom
// there's no `window.__TAURI_INTERNALS__`, so the real getCurrentWindow
// throws on the useEffect mount. Mock returns a stub whose
// onDragDropEvent resolves to a no-op unlisten fn.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

describe("RemotePane", () => {
  beforeEach(() => {
    useSessions.setState({ sessions: [], activeId: null, activeActivity: {}, connecting: {}, railView: "files" });
    useRailFiles.setState({
      leftPath: "/home/chen",
      leftEntries: [], leftLoading: false, leftError: null, leftSelected: [],
      rightHost: null, rightPath: "",
      rightEntries: [], rightLoading: false, rightError: null, rightSelected: [],
      splitterPercent: 50,
    });
  });

  it("shows empty state and 'New connection' when no host selected", () => {
    render(<RemotePane onNewConnection={() => {}} />);
    expect(screen.getByText(/pick a host to browse/i)).toBeInTheDocument();
  });

  it("double-click file downloads to leftPath", async () => {
    const { sftpDownload } = await import("../ipc/transfers");
    useSessions.setState({
      sessions: [{ id: "h1", label: "vm", kind: "ssh", host_id: null, state: "active" }],
    });
    useRailFiles.setState({
      rightHost: "h1", rightPath: "/root",
      rightEntries: [{ name: "ip.log", kind: "file", size: 10, modified: null, permissions: 0 }],
    });
    render(<RemotePane onNewConnection={() => {}} />);
    fireEvent.doubleClick(screen.getByText("ip.log"));
    expect(sftpDownload).toHaveBeenCalledWith("h1", "/root/ip.log", "/home/chen/ip.log");
  });

  it("cold-mount rehydration: rightHost + empty rightEntries → auto-loads", async () => {
    const { sftpListDir } = await import("../ipc/sftp");
    useSessions.setState({
      sessions: [{ id: "h1", label: "vm", kind: "ssh", host_id: null, state: "active" }],
      activeId: null, activeActivity: {}, connecting: {}, railView: "files",
    });
    useRailFiles.setState({
      leftPath: "/home/chen", leftEntries: [], leftLoading: false, leftError: null, leftSelected: [],
      rightHost: "h1", rightPath: "/root",
      rightEntries: [], rightLoading: false, rightError: null, rightSelected: [],
      splitterPercent: 50,
    });
    render(<RemotePane onNewConnection={() => {}} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(sftpListDir).toHaveBeenCalledWith("h1", "/root");
  });
});
