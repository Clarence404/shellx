import { vi, describe, it, expect } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { listTunnelsForHost, addTunnel } from "../tunnels";

describe("tunnel ipc wrappers", () => {
  it("listTunnelsForHost calls correct command", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listTunnelsForHost("host-id");
    expect(invoke).toHaveBeenCalledWith("tunnel_list_for_host", { hostId: "host-id" });
  });

  it("addTunnel passes rule through", async () => {
    const rule = {
      id: "r1",
      host_id: "h1",
      label: "DB",
      local_port: 5432,
      remote_host: "db",
      remote_port: 5432,
      enabled: true,
      sort_order: 0,
      created_at: 0,
    };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(rule);
    const result = await addTunnel({
      host_id: "h1",
      label: "DB",
      local_port: 5432,
      remote_host: "db",
      remote_port: 5432,
    });
    expect(result.label).toBe("DB");
  });
});
