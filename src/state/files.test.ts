import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFilesStore } from "./files";

vi.mock("../ipc/sftp", () => ({
  sftpListDir: vi.fn(),
}));
import * as ipc from "../ipc/sftp";

describe("files store", () => {
  beforeEach(() => {
    useFilesStore.setState({ perConnection: {} });
    vi.clearAllMocks();
  });

  it("loadDir populates entries for that connection", async () => {
    (ipc.sftpListDir as any).mockResolvedValue([
      { name: "a", kind: "file", size: 10, modified: null, permissions: 0 },
    ]);
    await useFilesStore.getState().loadDir("c1", "/tmp");
    const st = useFilesStore.getState().perConnection["c1"];
    expect(st.cwd).toBe("/tmp");
    expect(st.entries).toHaveLength(1);
  });

  it("loadDir records an error and clears loading on IPC failure", async () => {
    (ipc.sftpListDir as any).mockRejectedValue(new Error("boom"));
    await useFilesStore.getState().loadDir("c1", "/tmp");
    const st = useFilesStore.getState().perConnection["c1"];
    expect(st.loading).toBe(false);
    expect(st.error).toContain("boom");
  });

  it("select() toggles single and multi selection, clear() removes connection state", () => {
    useFilesStore.setState({
      perConnection: {
        c1: { cwd: "/tmp", entries: [], loading: false, error: null, selectedNames: [] },
      },
    });
    useFilesStore.getState().select("c1", "a", false);
    expect(useFilesStore.getState().perConnection["c1"].selectedNames).toEqual(["a"]);

    useFilesStore.getState().select("c1", "b", true);
    expect(useFilesStore.getState().perConnection["c1"].selectedNames).toEqual(["a", "b"]);

    useFilesStore.getState().clearSelection("c1");
    expect(useFilesStore.getState().perConnection["c1"].selectedNames).toEqual([]);

    useFilesStore.getState().clear("c1");
    expect(useFilesStore.getState().perConnection["c1"]).toBeUndefined();
  });
});
