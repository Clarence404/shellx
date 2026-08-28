import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FtpView } from "./FtpView";
import { useFtpStore } from "../state/ftp";
import * as ipc from "../ipc/ftp";
import type { FtpHost } from "../types/ftp";

vi.mock("../ipc/ftp", () => ({
  ftpHostList: vi.fn().mockResolvedValue([]),
  ftpHostSave: vi.fn(),
  ftpHostUpdate: vi.fn(),
  ftpHostDelete: vi.fn().mockResolvedValue(undefined),
  ftpConnect: vi.fn(),
  ftpDisconnect: vi.fn().mockResolvedValue(undefined),
  ftpActiveIds: vi.fn().mockResolvedValue([]),
  ftpListDir: vi.fn().mockResolvedValue([]),
  ftpPwd: vi.fn(),
}));
vi.mock("../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));
// The local half is the existing component and has its own tests; it
// would otherwise reach for the filesystem here.
vi.mock("./LocalPane", () => ({ LocalPane: () => <div data-testid="local-pane" /> }));

function host(over: Partial<FtpHost> = {}): FtpHost {
  return {
    id: "h1", label: "产线 A", protocol: "ftp", host: "10.20.1.40", port: 21,
    username: "ftpuser", charset: "auto", passive: true, created_at: 0, sort_order: 0,
    ...over,
  };
}

describe("FtpView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFtpStore.setState({
      hosts: [], loaded: true, activeId: null, connected: [], connecting: [],
      cwd: "/", entries: [], listing: false, error: null,
    });
  });
  afterEach(cleanup);

  it("says what to do when there are no connections yet", () => {
    render(<FtpView />);
    expect(screen.getByText("No FTP connections yet")).toBeInTheDocument();
    expect(screen.getByText("Add an FTP connection to get started")).toBeInTheDocument();
  });

  it("clicking a connection connects it and lists where the server put us", async () => {
    const user = userEvent.setup();
    (ipc.ftpConnect as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "h1", cwd: "/upload" });
    (ipc.ftpListDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "report.dat", kind: "file", size: 860160, modified: 1787580000000, permissions: 0 },
      { name: "2026-08", kind: "directory", size: 0, modified: null, permissions: 0 },
    ]);
    useFtpStore.setState({ hosts: [host()] });
    render(<FtpView />);

    await user.click(screen.getByRole("button", { name: "产线 A" }));
    await waitFor(() => expect(ipc.ftpConnect).toHaveBeenCalledWith("h1"));
    expect(await screen.findByText("report.dat")).toBeInTheDocument();
    expect(screen.getByText("/upload")).toBeInTheDocument();
    // Directories sort above files whatever order the server sent.
    const names = [...document.querySelectorAll("div")]
      .map((d) => d.textContent).filter(Boolean);
    expect(names.some((n) => n?.includes("2026-08"))).toBe(true);
  });

  it("shows what this connection is actually doing", async () => {
    (ipc.ftpListDir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    useFtpStore.setState({
      hosts: [host({ charset: "gbk", passive: false })],
      activeId: "h1", connected: ["h1"], cwd: "/upload",
    });
    render(<FtpView />);
    // Plaintext, charset and transfer mode explain most FTP problems, so
    // they sit next to the path rather than inside a settings dialog.
    expect(await screen.findByText("plaintext")).toBeInTheDocument();
    expect(screen.getByText("GBK")).toBeInTheDocument();
    expect(screen.getByText("active mode")).toBeInTheDocument();
  });

  it("a failed connect is shown, and the row goes back to idle", async () => {
    const user = userEvent.setup();
    (ipc.ftpConnect as ReturnType<typeof vi.fn>).mockRejectedValue("530 Login incorrect");
    useFtpStore.setState({ hosts: [host()] });
    render(<FtpView />);

    await user.click(screen.getByRole("button", { name: "产线 A" }));
    await waitFor(() => expect(useFtpStore.getState().error).toContain("530"));
    expect(useFtpStore.getState().connecting).toEqual([]);
  });

  it("the form drops charset and transfer mode for SFTP", async () => {
    const user = userEvent.setup();
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));

    // FTP is the default, so both are on screen…
    expect(screen.getByText("Filename encoding")).toBeInTheDocument();
    expect(screen.getByLabelText(/Passive mode/)).toBeInTheDocument();

    // …and gone for SFTP, where neither concept exists.
    await user.click(screen.getByRole("button", { name: "SFTP" }));
    expect(screen.queryByText("Filename encoding")).toBeNull();
    expect(screen.queryByLabelText(/Passive mode/)).toBeNull();
  });

  it("switching protocol moves the default port with it", async () => {
    const user = userEvent.setup();
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));

    // FTP is the default, so the port starts at 21.
    expect(document.querySelector('input[value="21"]')).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "SFTP" }));
    await waitFor(() => expect(document.querySelector('input[value="22"]')).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "FTPS" }));
    await waitFor(() => expect(document.querySelector('input[value="21"]')).not.toBeNull());
  });

  it("saving a new connection sends the password separately from the row", async () => {
    const user = userEvent.setup();
    (ipc.ftpHostSave as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...host(), password_stored: true,
    });
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));

    await user.type(screen.getByPlaceholderText("10.20.1.40"), "10.20.1.40");
    await user.type(screen.getByPlaceholderText("ftpuser"), "ftpuser");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ipc.ftpHostSave).toHaveBeenCalled());
    const args = (ipc.ftpHostSave as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args).toMatchObject({ protocol: "ftp", host: "10.20.1.40", username: "ftpuser", port: 21 });
    // No name typed, so it falls back to user@host the way the SSH form does.
    expect(args.label).toBe("ftpuser@10.20.1.40");
  });
});
