import { describe, it, expect, beforeEach, vi } from "vitest";
import { useHostsStore } from "./hosts";

// Mock IPC wrappers
vi.mock("../ipc/hosts", () => ({
  listHosts: vi.fn(),
  saveHost: vi.fn(),
  updateHost: vi.fn(),
  deleteHost: vi.fn(),
  keychainAvailable: vi.fn(),
}));

import * as ipc from "../ipc/hosts";

describe("hosts store", () => {
  beforeEach(() => {
    useHostsStore.setState({ hosts: [], keychainAvailable: false, loaded: false });
    vi.clearAllMocks();
  });

  it("load() fetches hosts and keychain flag from IPC", async () => {
    (ipc.listHosts as any).mockResolvedValue([
      { id: "a", label: "prod-1", host: "10.0.0.1", port: 22, username: "chen",
        notes: null, created_at: 100, last_connected_at: null, sort_order: 100 },
    ]);
    (ipc.keychainAvailable as any).mockResolvedValue(true);

    await useHostsStore.getState().load();
    const state = useHostsStore.getState();
    expect(state.hosts).toHaveLength(1);
    expect(state.hosts[0].label).toBe("prod-1");
    expect(state.keychainAvailable).toBe(true);
    expect(state.loaded).toBe(true);
  });

  it("addHost() calls IPC and appends to state", async () => {
    (ipc.saveHost as any).mockResolvedValue({
      id: "b", label: "new", host: "h", port: 22, username: "u",
      notes: null, created_at: 200, last_connected_at: null, sort_order: 200,
      password_stored: true,
    });

    const result = await useHostsStore.getState().addHost({
      label: "new", host: "h", port: 22, username: "u",
    });
    expect(ipc.saveHost).toHaveBeenCalledOnce();
    expect(useHostsStore.getState().hosts).toHaveLength(1);
    expect(useHostsStore.getState().hosts[0].id).toBe("b");
    expect(result.password_stored).toBe(true);
  });

  it("addHost() surfaces password_stored=false without dropping the saved host from state", async () => {
    (ipc.saveHost as any).mockResolvedValue({
      id: "c", label: "new2", host: "h", port: 22, username: "u",
      notes: null, created_at: 300, last_connected_at: null, sort_order: 300,
      password_stored: false,
    });

    const result = await useHostsStore.getState().addHost({
      label: "new2", host: "h", port: 22, username: "u", password: "secret",
    });
    expect(result.password_stored).toBe(false);
    expect(useHostsStore.getState().hosts).toHaveLength(1);
    expect(useHostsStore.getState().hosts[0].id).toBe("c");
    // password_stored must not leak into stored HostInfo
    expect((useHostsStore.getState().hosts[0] as any).password_stored).toBeUndefined();
  });

  it("deleteHostById() removes from state", async () => {
    useHostsStore.setState({
      hosts: [
        { id: "a", label: "a", host: "h", port: 22, username: "u",
          notes: null, created_at: 100, last_connected_at: null, sort_order: 100,
          auth_method: "password", key_path: null, connection_mode: "terminal_only" },
        { id: "b", label: "b", host: "h", port: 22, username: "u",
          notes: null, created_at: 200, last_connected_at: null, sort_order: 200,
          auth_method: "password", key_path: null, connection_mode: "terminal_only" },
      ],
      keychainAvailable: false, loaded: true,
    });
    (ipc.deleteHost as any).mockResolvedValue(undefined);

    await useHostsStore.getState().deleteHostById("a");
    expect(useHostsStore.getState().hosts.map(h => h.id)).toEqual(["b"]);
  });
});
