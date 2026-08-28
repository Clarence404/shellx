import { describe, it, expect, vi, beforeEach } from "vitest";
import { joinPath, useFtpStore } from "./ftp";
import * as ipc from "../ipc/ftp";
import type { FtpHost } from "../types/ftp";

vi.mock("../ipc/ftp", () => ({
  ftpHostList: vi.fn(),
  ftpHostSave: vi.fn(),
  ftpHostUpdate: vi.fn(),
  ftpHostDelete: vi.fn(),
  ftpHostImport: vi.fn(),
  ftpMkdir: vi.fn(),
  ftpRename: vi.fn(),
  ftpRemove: vi.fn(),
  ftpConnect: vi.fn(),
  ftpDisconnect: vi.fn(),
  ftpActiveIds: vi.fn(),
  ftpListDir: vi.fn(),
  ftpPwd: vi.fn(),
}));

function host(over: Partial<FtpHost> = {}): FtpHost {
  return {
    id: "h1", label: "产线 A", protocol: "ftp", host: "10.20.1.40", port: 21,
    username: "ftpuser", charset: "auto", passive: true,
    auth_method: "password", key_path: null, tls_mode: "explicit",
    created_at: 0, sort_order: 0,
    ...over,
  };
}

const RESET = {
  hosts: [], loaded: false, activeId: null, connected: [], connecting: [],
  cwd: "/", entries: [], listedKey: null, listing: false, error: null,
};

describe("joinPath", () => {
  it("descends without doubling the separator", () => {
    expect(joinPath("/upload", "2026-08")).toBe("/upload/2026-08");
    expect(joinPath("/upload/", "2026-08")).toBe("/upload/2026-08");
    expect(joinPath("/", "upload")).toBe("/upload");
  });

  it("climbs on .. and stops at the root", () => {
    expect(joinPath("/upload/2026-08", "..")).toBe("/upload");
    expect(joinPath("/upload", "..")).toBe("/");
    expect(joinPath("/", "..")).toBe("/");
  });

  it("keeps non-ASCII names intact", () => {
    expect(joinPath("/上报", "测试.txt")).toBe("/上报/测试.txt");
  });
});

describe("ftp store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFtpStore.setState(RESET);
  });

  it("asks the backend which connections are live rather than assuming", async () => {
    // Connections outlive a view unmount — they are held on the Rust
    // side — so remembering them in the store would go stale.
    (ipc.ftpHostList as ReturnType<typeof vi.fn>).mockResolvedValue([host()]);
    (ipc.ftpActiveIds as ReturnType<typeof vi.fn>).mockResolvedValue(["h1"]);
    await useFtpStore.getState().load();
    expect(useFtpStore.getState().connected).toEqual(["h1"]);
    expect(useFtpStore.getState().loaded).toBe(true);
  });

  it("opens where the server put us, not at the root", async () => {
    (ipc.ftpConnect as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "h1", cwd: "/upload" });
    (ipc.ftpListDir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    useFtpStore.setState({ hosts: [host()] });
    await useFtpStore.getState().connect("h1");
    expect(useFtpStore.getState().cwd).toBe("/upload");
    expect(ipc.ftpListDir).toHaveBeenCalledWith("h1", "/upload");
    expect(useFtpStore.getState().connecting).toEqual([]);
  });

  it("surfaces a failed connect and stops spinning", async () => {
    (ipc.ftpConnect as ReturnType<typeof vi.fn>).mockRejectedValue("530 Login incorrect");
    useFtpStore.setState({ hosts: [host()] });
    await useFtpStore.getState().connect("h1");
    expect(useFtpStore.getState().error).toContain("530");
    expect(useFtpStore.getState().connected).toEqual([]);
    expect(useFtpStore.getState().connecting).toEqual([]);
  });

  it("keeps the current directory when a listing fails", async () => {
    // Dropping the user out of a folder that was working, because one
    // listing errored, helps nobody.
    (ipc.ftpListDir as ReturnType<typeof vi.fn>).mockRejectedValue("550 Permission denied");
    useFtpStore.setState({
      hosts: [host()], activeId: "h1", connected: ["h1"],
      cwd: "/upload", entries: [{ name: "a", kind: "file", size: 1, modified: null, permissions: 0 }],
    });
    await useFtpStore.getState().navigate("/root");
    const s = useFtpStore.getState();
    expect(s.cwd).toBe("/upload");
    expect(s.entries).toHaveLength(1);
    expect(s.error).toContain("550");
    expect(s.listing).toBe(false);
  });

  it("marks an empty directory as listed, so nothing asks for it again", async () => {
    // The pane refreshes when the current directory has not been listed.
    // Keying that on "no rows" would spin forever on an empty folder —
    // which is the normal state of an upload directory that was just
    // cleared.
    (ipc.ftpListDir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    useFtpStore.setState({ hosts: [host()], activeId: "h1", connected: ["h1"], cwd: "/upload" });
    await useFtpStore.getState().refresh();
    expect(useFtpStore.getState().entries).toEqual([]);
    expect(useFtpStore.getState().listedKey).toBe("h1:/upload");
  });

  it("a failed navigate marks the directory that is still on screen", async () => {
    (ipc.ftpListDir as ReturnType<typeof vi.fn>).mockRejectedValue("550 denied");
    useFtpStore.setState({ hosts: [host()], activeId: "h1", connected: ["h1"], cwd: "/upload" });
    await useFtpStore.getState().navigate("/root");
    // /upload is what the user is looking at, so that is what counts as
    // listed — pointing the key at /root would re-trigger the refresh.
    expect(useFtpStore.getState().listedKey).toBe("h1:/upload");
  });

  it("does not start a second connect while one is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    (ipc.ftpConnect as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((r) => { release = r; }),
    );
    (ipc.ftpListDir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    useFtpStore.setState({ hosts: [host()] });
    const first = useFtpStore.getState().connect("h1");
    await useFtpStore.getState().connect("h1");
    expect(ipc.ftpConnect).toHaveBeenCalledTimes(1);
    release({ id: "h1", cwd: "/" });
    await first;
  });

  it("deleting the shown connection clears the pane with it", async () => {
    (ipc.ftpHostDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    useFtpStore.setState({
      hosts: [host()], activeId: "h1", connected: ["h1"], cwd: "/upload",
      entries: [{ name: "a", kind: "file", size: 1, modified: null, permissions: 0 }],
    });
    await useFtpStore.getState().deleteHost("h1");
    const s = useFtpStore.getState();
    expect(s.hosts).toEqual([]);
    expect(s.activeId).toBeNull();
    expect(s.entries).toEqual([]);
    expect(s.connected).toEqual([]);
  });

  it("disconnecting leaves the saved row alone", async () => {
    (ipc.ftpDisconnect as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    useFtpStore.setState({ hosts: [host()], activeId: "h1", connected: ["h1"] });
    await useFtpStore.getState().disconnect("h1");
    expect(useFtpStore.getState().hosts).toHaveLength(1);
    expect(useFtpStore.getState().connected).toEqual([]);
  });

  it("strips password_stored before the row reaches the list", async () => {
    (ipc.ftpHostSave as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...host(), password_stored: true,
    });
    const saved = await useFtpStore.getState().addHost({
      label: "产线 A", protocol: "ftp", host: "10.20.1.40", port: 21, username: "ftpuser",
    });
    expect("password_stored" in saved).toBe(false);
    expect(useFtpStore.getState().hosts).toHaveLength(1);
  });
});
