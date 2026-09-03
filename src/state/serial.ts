import { create } from "zustand";
import * as ipc from "../ipc/serial";
import { closeSession } from "../ipc/commands";
import { onConnectionClosed } from "../ipc/events";
import { lineSummary, type SerialLineSettings, type SerialPortInfo, type SerialProfile } from "../types/serial";

/** A live (or recently closed) serial terminal inside the Serial view.
    Deliberately NOT a row in useSessions: serial sessions render embedded
    in the Serial view, not as tabs in the global workspace. */
export interface SerialSession {
  id: string;
  port: string;
  label: string;
  /** "115200 · 8N1" */
  line: string;
  /** Kept so a closed session can reconnect with one click. */
  spec: SerialLineSettings & { port: string; label: string };
  state: "active" | "closed";
}

interface SerialStore {
  profiles: SerialProfile[];
  ports: SerialPortInfo[];
  loaded: boolean;
  /** A scan is in flight — the refresh button spins on this. */
  scanning: boolean;
  /** When the last scan finished (ms epoch); 0 = never. Proof to the eye
      that the click did something even when the list didn't change. */
  lastScan: number;
  /** Open serial terminals, in open order. Entries stay after the port
      closes (state "closed") so scrollback survives until dismissed. */
  open: SerialSession[];
  /** Which open terminal the main pane shows; null = the ports page. */
  activeId: string | null;

  load: () => Promise<void>;
  refreshPorts: () => Promise<void>;
  add: (p: ipc.NewSerialProfile) => Promise<SerialProfile>;
  update: (id: string, patch: Partial<ipc.NewSerialProfile>) => Promise<void>;
  remove: (id: string) => Promise<void>;

  /** Open the port (or focus the session that already has it). */
  connect: (spec: SerialLineSettings & { port: string; label: string }) => Promise<void>;
  select: (id: string | null) => void;
  /** Close the OS port; the entry stays as "closed" until dismissed. */
  disconnect: (id: string) => Promise<void>;
  /** Drop the entry (and close the port first if still open). */
  dismiss: (id: string) => Promise<void>;
}

export const useSerialStore = create<SerialStore>((set, get) => ({
  profiles: [],
  ports: [],
  loaded: false,
  scanning: false,
  lastScan: 0,
  open: [],
  activeId: null,

  load: async () => {
    set({ scanning: true });
    try {
      const [profiles, ports] = await Promise.all([
        ipc.serialProfileList(),
        ipc.serialListPorts(),
      ]);
      set({ profiles, ports, loaded: true, lastScan: Date.now() });
    } finally {
      set({ scanning: false });
    }
  },

  refreshPorts: async () => {
    set({ scanning: true });
    try {
      const ports = await ipc.serialListPorts();
      set({ ports, lastScan: Date.now() });
    } finally {
      set({ scanning: false });
    }
  },

  add: async (p) => {
    const created = await ipc.serialProfileSave(p);
    set((st) => ({ profiles: [...st.profiles, created] }));
    return created;
  },

  update: async (id, patch) => {
    const updated = await ipc.serialProfileUpdate(id, patch);
    set((st) => ({
      profiles: st.profiles.map((p) => (p.id === id ? updated : p)),
    }));
  },

  remove: async (id) => {
    await ipc.serialProfileDelete(id);
    set((st) => ({ profiles: st.profiles.filter((p) => p.id !== id) }));
  },

  connect: async (spec) => {
    // One session per port: focus the live one instead of fighting the
    // OS for a port that is already exclusively open.
    const existing = get().open.find((s) => s.port === spec.port && s.state === "active");
    if (existing) {
      get().select(existing.id);
      return;
    }
    const info = await ipc.openSerialSession(spec);
    const session: SerialSession = {
      id: info.id,
      port: spec.port,
      label: spec.label,
      line: lineSummary(spec),
      spec,
      state: "active",
    };
    set((st) => ({
      // A dismissed-on-reconnect: replace any stale closed entry for the
      // same port so the list doesn't collect corpses.
      open: [...st.open.filter((s) => s.port !== spec.port || s.state === "active"), session],
      activeId: session.id,
    }));
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("shellx:refit", { detail: session.id }));
    });
  },

  select: (id) => {
    set({ activeId: id });
    if (id) {
      queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent("shellx:refit", { detail: id }));
      });
    }
  },

  disconnect: async (id) => {
    try { await closeSession(id); } catch { /* backend may already be gone */ }
    set((st) => ({
      open: st.open.map((s) => (s.id === id ? { ...s, state: "closed" as const } : s)),
    }));
  },

  dismiss: async (id) => {
    const s = get().open.find((x) => x.id === id);
    if (s && s.state === "active") {
      try { await closeSession(id); } catch { /* ignore */ }
    }
    set((st) => {
      const open = st.open.filter((x) => x.id !== id);
      return {
        open,
        activeId: st.activeId === id ? (open[open.length - 1]?.id ?? null) : st.activeId,
      };
    });
  },
}));

let loadedOnce = false;
export function loadSerialOnce() {
  if (loadedOnce) return;
  loadedOnce = true;
  void useSerialStore.getState().load();
  // The port vanishing under us (USB unplugged, driver stopped) surfaces
  // as connection:closed — mark the entry so the header offers reconnect.
  void onConnectionClosed(({ id }) => {
    const st = useSerialStore.getState();
    if (st.open.some((s) => s.id === id)) {
      useSerialStore.setState({
        open: st.open.map((s) => (s.id === id ? { ...s, state: "closed" as const } : s)),
      });
    }
  });
}
