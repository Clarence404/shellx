import { render, screen, within, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { App } from "./App";
import { useSessions } from "./state/sessions";

let capturedClosedHandler: ((e: { id: string; reason: string }) => void) | null = null;

vi.mock("./ipc/events", () => ({
  onConnectionClosed: vi.fn((h: (e: { id: string; reason: string }) => void) => {
    capturedClosedHandler = h;
    return Promise.resolve(() => {});
  }),
}));

// TerminalView/FileBrowserView are heavy (real xterm.js / real Tauri IPC calls
// on mount) and irrelevant to the App-level wiring under test here — stub them
// out, same spirit as FileBrowserView.test.tsx stubbing its own Tauri deps.
vi.mock("./components/TerminalView", () => ({ TerminalView: () => null }));
vi.mock("./components/FileBrowserView", () => ({ FileBrowserView: () => null }));
vi.mock("./components/LocalPane", () => ({ LocalPane: () => null }));

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

const mockTransfersState = {
  list: [] as Array<{ id: string; connection_id: string }>,
  loading: false,
  loadInitial: vi.fn(),
  applyStarted: vi.fn(),
  applyProgress: vi.fn(),
  applyDone: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
};

vi.mock("./state/transfers", () => ({
  useTransfersStore: Object.assign(
    (selector: any) => selector(mockTransfersState),
    {
      getState: () => mockTransfersState,
      setState: vi.fn(),
    },
  ),
}));
vi.mock("./ipc/transfers", () => ({
  onTransferStarted: vi.fn().mockResolvedValue(() => {}),
  onTransferProgress: vi.fn().mockResolvedValue(() => {}),
  onTransferDone: vi.fn().mockResolvedValue(() => {}),
}));

describe("App shell", () => {
  afterEach(() => {
    // Unmount first — resetting the (real, shared) sessions store while a
    // previous test's <App/> is still mounted and subscribed would trigger a
    // React state update outside of act().
    cleanup();
    mockHostsState.hosts = [];
    useSessions.setState({
      sessions: [], activeId: null, activeActivity: {}, connecting: {},
      railView: "hosts", drawerCollapsed: false,
    });
    capturedClosedHandler = null;
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

  it("onConnectionClosed fades the tab (marks it closed) then removes it 300ms later", async () => {
    render(<App />);

    await act(async () => {
      useSessions.getState().addSession({ id: "s1", label: "server-a", kind: "ssh", host_id: null, state: "active" });
    });
    // Flush the microtask queue so the async onConnectionClosed(...).then(...) in
    // App's effect has run and captured the handler.
    await act(async () => {});
    expect(capturedClosedHandler).not.toBeNull();

    vi.useFakeTimers();
    try {
      act(() => {
        capturedClosedHandler!({ id: "s1", reason: "eof" });
      });
      expect(useSessions.getState().sessions.find((s) => s.id === "s1")?.state).toBe("closed");
      expect(useSessions.getState().sessions.map((s) => s.id)).toContain("s1");

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(useSessions.getState().sessions.find((s) => s.id === "s1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders RailFilesView (and hides the drawer) when rail view is 'files'", async () => {
    render(<App />);
    // Sanity: drawer is present in default "hosts" view
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();

    // Switch rail view
    await act(async () => {
      useSessions.setState({ railView: "files" });
    });

    // Drawer gone, main content should announce itself
    expect(screen.queryByRole("complementary", { name: "drawer" })).toBeNull();
    expect(screen.getByTestId("rail-files-view")).toBeInTheDocument();
  });

  it("Ctrl+Shift+B toggles drawer collapse on non-Files views", async () => {
    render(<App />);
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, shiftKey: true, bubbles: true }));
    });
    expect(screen.queryByRole("complementary", { name: "drawer" })).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, shiftKey: true, bubbles: true }));
    });
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();
  });

  it("plain Ctrl+B does NOT toggle drawer (leaves it free for terminal readline)", async () => {
    render(<App />);
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true }));
    });
    // Drawer should still be present — Ctrl+B alone did nothing
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();
  });

  it("clicking the currently-active rail icon toggles the drawer", async () => {
    render(<App />);
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();
    const hostsIcon = screen.getByRole("button", { name: "Hosts" });
    await act(async () => { hostsIcon.click(); });
    expect(screen.queryByRole("complementary", { name: "drawer" })).toBeNull();
    await act(async () => { hostsIcon.click(); });
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();
  });

  it("switching to a different rail icon force-opens the drawer", async () => {
    render(<App />);
    // Collapse first
    await act(async () => {
      useSessions.setState({ drawerCollapsed: true });
    });
    expect(screen.queryByRole("complementary", { name: "drawer" })).toBeNull();
    // Click a different icon (Settings) — drawer should open
    const settings = screen.getByRole("button", { name: "Settings" });
    await act(async () => { settings.click(); });
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();
  });
});
