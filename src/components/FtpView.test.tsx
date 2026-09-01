import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FtpView } from "./FtpView";
import { useFtpStore } from "../state/ftp";
import * as ipc from "../ipc/ftp";
import { useHostsStore } from "../state/hosts";
import { useSessions } from "../state/sessions";
import type { FtpHost } from "../types/ftp";
import type { HostInfo } from "../types/host";

vi.mock("../ipc/ftp", () => ({
  ftpHostList: vi.fn().mockResolvedValue([]),
  ftpHostSave: vi.fn(),
  ftpHostUpdate: vi.fn(),
  ftpHostDelete: vi.fn().mockResolvedValue(undefined),
  ftpHostImport: vi.fn(),
  ftpMkdir: vi.fn(),
  ftpRename: vi.fn(),
  ftpRemove: vi.fn(),
  ftpUpload: vi.fn(),
  ftpDownload: vi.fn(),
  ftpUploadDir: vi.fn(),
  ftpDownloadDir: vi.fn(),
  ftpConnect: vi.fn(),
  ftpDisconnect: vi.fn().mockResolvedValue(undefined),
  ftpActiveIds: vi.fn().mockResolvedValue([]),
  ftpListDir: vi.fn().mockResolvedValue([]),
  ftpListDirBg: vi.fn().mockResolvedValue([]),
  ftpPwd: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("../ipc/local", () => ({ localIsDir: vi.fn().mockResolvedValue(false) }));
vi.mock("../ipc/hosts", () => ({
  listHosts: vi.fn().mockResolvedValue([]),
  keychainAvailable: vi.fn().mockResolvedValue(false),
  saveHost: vi.fn(), updateHost: vi.fn(), deleteHost: vi.fn(),
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
    username: "ftpuser", charset: "auto", passive: true,
    auth_method: "password", key_path: null, tls_mode: "explicit", created_at: 0, sort_order: 0,
    ...over,
  };
}

describe("FtpView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFtpStore.setState({
      hosts: [], loaded: true, activeId: null, connected: [], connecting: [],
      cwd: "/", entries: [], listedKey: null, listing: false, error: null,
    });
    useHostsStore.setState({ hosts: [], keychainAvailable: false, loaded: true });
    useSessions.setState({ drawerCollapsed: false });
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
    // The path is a breadcrumb, the same one the Files view uses, so it
    // renders as segments rather than one string.
    expect(screen.getByText("upload")).toBeInTheDocument();
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

  it("the form keeps charset and transfer mode under Advanced, and drops them for SFTP", async () => {
    const user = userEvent.setup();
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));

    // Folded away on creation — the defaults are right nine times out
    // of ten — but there for FTP once Advanced opens.
    expect(screen.queryByLabelText("Filename encoding")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Advanced settings/ }));
    expect(screen.getByLabelText("Filename encoding")).toBeInTheDocument();
    expect(screen.getByLabelText("Transfer mode")).toBeInTheDocument();

    // …and gone for SFTP, where neither concept exists.
    await user.selectOptions(screen.getByLabelText("File protocol"), "sftp");
    expect(screen.queryByLabelText("Filename encoding")).toBeNull();
    expect(screen.queryByLabelText("Transfer mode")).toBeNull();
  });

  it("protocol and encryption both move the default port with them", async () => {
    const user = userEvent.setup();
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));

    // FTP is the default, so the port starts at 21.
    expect(document.querySelector('input[value="21"]')).not.toBeNull();
    await user.selectOptions(screen.getByLabelText("File protocol"), "sftp");
    await waitFor(() => expect(document.querySelector('input[value="22"]')).not.toBeNull());
    await user.selectOptions(screen.getByLabelText("File protocol"), "ftp");
    await waitFor(() => expect(document.querySelector('input[value="21"]')).not.toBeNull());
    // Implicit TLS lives on 990; going back to explicit restores 21.
    await user.selectOptions(screen.getByLabelText("Encryption"), "implicit");
    await waitFor(() => expect(document.querySelector('input[value="990"]')).not.toBeNull());
    await user.selectOptions(screen.getByLabelText("Encryption"), "explicit");
    await waitFor(() => expect(document.querySelector('input[value="21"]')).not.toBeNull());
  });

  it("anonymous login fills the username and locks both credential fields", async () => {
    const user = userEvent.setup();
    (ipc.ftpHostSave as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...host(), password_stored: false,
    });
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));

    await user.type(screen.getByPlaceholderText("10.20.1.40"), "10.20.1.40");
    await user.click(screen.getByLabelText("Anonymous login"));
    const userInput = screen.getByPlaceholderText("ftpuser") as HTMLInputElement;
    expect(userInput.value).toBe("anonymous");
    expect(userInput).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ipc.ftpHostSave).toHaveBeenCalled());
    const args = (ipc.ftpHostSave as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args).toMatchObject({ username: "anonymous" });
    expect("password" in args).toBe(false);
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

  it("offers key authentication for SFTP under Advanced, and only for SFTP", async () => {
    const user = userEvent.setup();
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));
    await user.click(screen.getByRole("button", { name: /Advanced settings/ }));

    // FTP has no key authentication, so the dropdown is not there at all.
    expect(screen.queryByLabelText("Authentication")).toBeNull();

    await user.selectOptions(screen.getByLabelText("File protocol"), "sftp");
    await user.selectOptions(screen.getByLabelText("Authentication"), "publickey");

    // A key replaces the password field rather than sitting beside it.
    expect(screen.getByText("Private key")).toBeInTheDocument();
    expect(screen.getByText("Key passphrase")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("leave blank to keep the stored one")).toBeNull();
  });

  it("will not save a key connection with no key chosen", async () => {
    const user = userEvent.setup();
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));
    await user.click(screen.getByRole("button", { name: /Advanced settings/ }));
    await user.selectOptions(screen.getByLabelText("File protocol"), "sftp");
    await user.selectOptions(screen.getByLabelText("Authentication"), "publickey");
    await user.type(screen.getByPlaceholderText("10.20.1.40"), "10.0.0.5");
    await user.type(screen.getByPlaceholderText("ftpuser"), "deploy");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("~/.ssh/id_ed25519"), "/home/me/.ssh/id_ed25519");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("sends the key path and leaves the passphrase out when blank", async () => {
    const user = userEvent.setup();
    (ipc.ftpHostSave as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...host({ protocol: "sftp" }), password_stored: false,
    });
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));
    await user.click(screen.getByRole("button", { name: /Advanced settings/ }));
    await user.selectOptions(screen.getByLabelText("File protocol"), "sftp");
    await user.selectOptions(screen.getByLabelText("Authentication"), "publickey");
    await user.type(screen.getByPlaceholderText("10.20.1.40"), "10.0.0.5");
    await user.type(screen.getByPlaceholderText("ftpuser"), "deploy");
    await user.type(screen.getByPlaceholderText("~/.ssh/id_ed25519"), "/home/me/.ssh/id_ed25519");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ipc.ftpHostSave).toHaveBeenCalled());
    const args = (ipc.ftpHostSave as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args).toMatchObject({
      protocol: "sftp", auth_method: "publickey", key_path: "/home/me/.ssh/id_ed25519", port: 22,
    });
    // An empty passphrase would overwrite whatever the keychain holds,
    // so it is omitted rather than sent blank.
    expect("passphrase" in args).toBe(false);
  });

  it("picking a TLS option makes the row FTPS, without a third protocol", async () => {
    const user = userEvent.setup();
    (ipc.ftpHostSave as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...host({ protocol: "ftps" }), password_stored: false,
    });
    render(<FtpView />);
    await user.click(screen.getByRole("button", { name: /New FTP connection/ }));
    await user.selectOptions(screen.getByLabelText("Encryption"), "implicit");
    await user.type(screen.getByPlaceholderText("10.20.1.40"), "10.20.1.40");
    await user.type(screen.getByPlaceholderText("ftpuser"), "ftpuser");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ipc.ftpHostSave).toHaveBeenCalled());
    const args = (ipc.ftpHostSave as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args).toMatchObject({ protocol: "ftps", tls_mode: "implicit", port: 990 });
  });

  function savedHost(over: Partial<HostInfo> = {}): HostInfo {
    return {
      id: "s1", label: "192.168.3.250", host: "192.168.3.250", port: 22, username: "root",
      notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
      auth_method: "password", key_path: null, connection_mode: "terminal_only",
      ...over,
    } as HostInfo;
  }

  it("imports saved hosts as SFTP rows, leaving the ones already here unticked", async () => {
    const user = userEvent.setup();
    useHostsStore.setState({
      hosts: [savedHost(), savedHost({ id: "s2", label: "web-1", host: "web.example.com" })],
    });
    // The first one is already an SFTP row at the same address.
    useFtpStore.setState({
      hosts: [host({
        id: "f1", protocol: "sftp", host: "192.168.3.250", port: 22, username: "root",
      })],
    });
    (ipc.ftpHostImport as ReturnType<typeof vi.fn>).mockResolvedValue([
      host({ id: "f2", protocol: "sftp", label: "web-1", host: "web.example.com" }),
    ]);
    render(<FtpView />);

    await user.click(screen.getByRole("button", { name: "Import from saved hosts" }));
    expect(await screen.findByText("Already here")).toBeInTheDocument();
    // Only the new one is offered by default, so the button says 1.
    await user.click(screen.getByRole("button", { name: "Import 1" }));

    await waitFor(() => expect(ipc.ftpHostImport).toHaveBeenCalledWith(["s2"]));
    expect(useFtpStore.getState().hosts.map((h) => h.id)).toEqual(["f1", "f2"]);
  });

  it("shows the same connecting animation the Hosts view uses", async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    (ipc.ftpConnect as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((r) => { release = r; }),
    );
    useFtpStore.setState({ hosts: [host()] });
    render(<FtpView />);

    await user.click(screen.getByRole("button", { name: "产线 A" }));
    expect(await screen.findByText("Connecting to 产线 A…")).toBeInTheDocument();
    // The default subtitle names an SSH session, which is not what a
    // plain FTP connection is doing.
    expect(screen.getByText("Opening the control connection.")).toBeInTheDocument();

    release({ id: "h1", cwd: "/upload" });
    await waitFor(() => expect(screen.queryByText("Connecting to 产线 A…")).toBeNull());
  });

  it("names the SSH session when the row is SFTP", async () => {
    const user = userEvent.setup();
    (ipc.ftpConnect as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    useFtpStore.setState({ hosts: [host({ protocol: "sftp", label: "web-1" })] });
    render(<FtpView />);

    await user.click(screen.getByRole("button", { name: "web-1" }));
    expect(await screen.findByText("Establishing the SSH session.")).toBeInTheDocument();
  });

  it("a failed connect leaves the reason on screen with a way to retry", async () => {
    const user = userEvent.setup();
    (ipc.ftpConnect as ReturnType<typeof vi.fn>).mockRejectedValue("530 Login incorrect");
    useFtpStore.setState({ hosts: [host()] });
    render(<FtpView />);

    await user.click(screen.getByRole("button", { name: "产线 A" }));
    // Nothing is live, so without this the reason would never be seen.
    expect(await screen.findByText(/530 Login incorrect/)).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("the connection list collapses on the same toggle the Hosts drawer uses", async () => {
    const user = userEvent.setup();
    useFtpStore.setState({ hosts: [host()] });
    const { rerender } = render(<FtpView />);
    expect(screen.getByLabelText("ftp connections")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse drawer" }));
    expect(useSessions.getState().drawerCollapsed).toBe(true);
    rerender(<FtpView />);
    expect(screen.queryByLabelText("ftp connections")).toBeNull();
    // The panes keep the whole width rather than leaving a gap.
    expect(screen.getByTestId("local-pane")).toBeInTheDocument();
  });

  it("renames and deletes through the same row menu the Files view uses", async () => {
    const user = userEvent.setup();
    (ipc.ftpRemove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (ipc.ftpListDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "old.dat", kind: "file", size: 10, modified: null, permissions: 0 },
    ]);
    useFtpStore.setState({
      hosts: [host()], activeId: "h1", connected: ["h1"], cwd: "/upload",
    });
    render(<FtpView />);
    await screen.findByText("old.dat");

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("old.dat") });
    await user.click(await screen.findByText("Delete"));
    // The path is joined against the directory on screen, not sent bare.
    await waitFor(() =>
      expect(ipc.ftpRemove).toHaveBeenCalledWith("h1", "/upload/old.dat", false));
    // And the directory is re-read rather than the row being removed
    // locally, so what shows is what the server actually has.
    await waitFor(() => expect(ipc.ftpListDir).toHaveBeenCalledWith("h1", "/upload"));
  });

  it("a refused delete leaves the listing alone and says why", async () => {
    const user = userEvent.setup();
    (ipc.ftpRemove as ReturnType<typeof vi.fn>).mockRejectedValue("550 Directory not empty");
    (ipc.ftpListDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "logs", kind: "directory", size: 0, modified: null, permissions: 0 },
    ]);
    useFtpStore.setState({
      hosts: [host()], activeId: "h1", connected: ["h1"], cwd: "/upload",
    });
    render(<FtpView />);
    await screen.findByText("logs");

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("logs") });
    await user.click(await screen.findByText("Delete"));
    expect(await screen.findByText(/550 Directory not empty/)).toBeInTheDocument();
    expect(screen.getByText("logs")).toBeInTheDocument();
  });
});
