import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { App } from "./App";

const mockHostsState = {
  hosts: [] as Array<{ id: string; label: string; host: string; port: number; username: string; notes: string | null; created_at: number; last_connected_at: number | null; sort_order: number }>,
  keychainAvailable: false,
  loaded: false,
  load: vi.fn(),
  addHost: vi.fn(),
  updateHostById: vi.fn(),
  deleteHostById: vi.fn(),
};

vi.mock("./state/hosts", () => ({
  useHostsStore: Object.assign(
    (selector: any) => selector(mockHostsState),
    {
      getState: () => mockHostsState,
      setState: vi.fn(),
    },
  ),
}));
vi.mock("./ipc/hosts", () => ({
  listHosts: vi.fn().mockResolvedValue([]),
  keychainAvailable: vi.fn().mockResolvedValue(false),
  getHostPassword: vi.fn().mockResolvedValue(null),
}));

describe("App shell", () => {
  afterEach(() => {
    mockHostsState.hosts = [];
    cleanup();
  });

  it("renders the activity rail, an empty drawer, and an empty state in the main area", () => {
    render(<App />);
    expect(screen.getByRole("navigation", { name: "activity rail" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();
    expect(screen.getByText(/a tiny, pretty terminal client/i)).toBeInTheDocument();
  });

  it("empty state shows the primary 'New connection' CTA when no hosts are saved", () => {
    mockHostsState.hosts = [];
    render(<App />);
    // Scope to the main region — Drawer footer and TabBar ＋ button share the same aria-label
    // (deferred v0.3 minor: disambiguate these labels).
    const main = screen.getByRole("main");
    expect(within(main).getByRole("button", { name: /new connection/i })).toBeInTheDocument();
    expect(within(main).queryByText(/pick a host from the sidebar/i)).not.toBeInTheDocument();
  });

  it("empty state guides to the sidebar (no duplicate CTA) when hosts exist", () => {
    mockHostsState.hosts = [
      {
        id: "id-1", label: "prod-1", host: "10.0.0.1", port: 22, username: "chen",
        notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
      },
    ];
    render(<App />);
    const main = screen.getByRole("main");
    expect(within(main).getByText(/pick a host from the sidebar/i)).toBeInTheDocument();
    // The primary "New connection" button in the empty state is gone from the main region.
    // Drawer footer and TabBar ＋ still have it — that's the design (they remain accessible).
    expect(within(main).queryByRole("button", { name: /new connection/i })).toBeNull();
  });
});
