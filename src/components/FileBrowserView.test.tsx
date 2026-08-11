import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FileBrowserView } from "./FileBrowserView";

vi.mock("../state/files", () => ({
  useFilesStore: (selector: any) => selector({
    perConnection: {
      "c1": {
        cwd: "/home/chen",
        entries: [
          { name: "config", kind: "directory", size: 0, modified: null, permissions: 0o755 },
          { name: "notes.md", kind: "file", size: 1024, modified: null, permissions: 0o644 },
        ],
        loading: false, error: null, selectedNames: [],
      },
    },
    loadDir: vi.fn(),
    select: vi.fn(),
    clearSelection: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../ipc/sftp", () => ({
  sftpMkdir: vi.fn(),
  sftpRename: vi.fn(),
  sftpRemoveFile: vi.fn(),
  sftpRemoveDir: vi.fn(),
}));

vi.mock("../ipc/transfers", () => ({
  sftpUpload: vi.fn(),
  sftpDownload: vi.fn(),
}));

describe("FileBrowserView", () => {
  it("renders the two entries in the mocked cwd", () => {
    render(<FileBrowserView connectionId="c1" />);
    expect(screen.getByText("config")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });

  it("renders the breadcrumb path segments", () => {
    render(<FileBrowserView connectionId="c1" />);
    // POSIX paths get a standalone root "/" chip (click target for jumping
    // to root), followed by bare directory labels.
    expect(screen.getByRole("button", { name: "/" })).toBeInTheDocument();
    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.getByText("chen")).toBeInTheDocument();
  });
});
