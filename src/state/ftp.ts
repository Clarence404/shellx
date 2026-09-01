import { create } from "zustand";
import * as ipc from "../ipc/ftp";
import { localIsDir } from "../ipc/local";
import { logPush } from "../ipc/logs";
import type { GestureGroup } from "../ipc/transfers";
import type { FtpEntry, FtpHost, SaveFtpHostArgs, UpdateFtpHostArgs } from "../types/ftp";

/** Joins a directory and a child the way a server path works: always
 *  forward slashes, never a doubled one, and `..` climbs. */
export function joinPath(cwd: string, name: string): string {
  if (name === "..") {
    const up = cwd.replace(/\/+$/, "").replace(/\/[^/]*$/, "");
    return up === "" ? "/" : up;
  }
  return `${cwd.replace(/\/+$/, "")}/${name}`;
}

interface State {
  hosts: FtpHost[];
  loaded: boolean;
  /** The connection whose directory the remote pane is showing. */
  activeId: string | null;
  /** Ids with a live connection on the Rust side. */
  connected: string[];
  /** Ids currently mid-connect, so the row can say so. */
  connecting: string[];
  /** Where the active connect is, WinSCP-style: opening the session, or
   *  already connected and reading the first directory. The connecting
   *  panel narrates it. Null when nothing is connecting. */
  connectPhase: "session" | "listing" | null;
  cwd: string;
  entries: FtpEntry[];
  /** `id:path` of the last listing that came back, successful or not.
   *  The pane keys its auto-refresh on this rather than on whether it
   *  has any rows — an empty directory is a real answer, and counting
   *  rows would ask for it again forever. */
  listedKey: string | null;
  listing: boolean;
  error: string | null;
  /** A directory the user tried to ENTER and the server refused —
   *  permission denied, mostly. Shown as a modal (the click deserves a
   *  clear answer), unlike `error`, which annotates the listing that is
   *  already on screen. */
  navError: string | null;
  /** `id:path` → the last listing that came back. FTP opens a fresh
   *  data connection per LIST — 3-4 round trips, whole seconds on a
   *  far-away server — so revisiting a directory shows the cached rows
   *  instantly while the fetch revalidates in the background. This is
   *  the same trick WinSCP's directory cache plays. Dropped per
   *  connection on connect / disconnect. */
  listingCache: Record<string, FtpEntry[]>;

  load: () => Promise<void>;
  addHost: (args: SaveFtpHostArgs) => Promise<FtpHost>;
  updateHost: (args: UpdateFtpHostArgs) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;
  importFromHosts: (hostIds: string[]) => Promise<number>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  navigate: (path: string) => Promise<void>;
  /** Queue a transfer into / out of the current directory. `kind` is
   *  what the source pane knows about the entry; OS drops pass "unknown"
   *  and the local filesystem is asked. */
  upload: (
    localAbs: string,
    name: string,
    kind: "file" | "directory" | "unknown",
    group?: GestureGroup,
  ) => Promise<void>;
  download: (name: string, kind: "file" | "directory", localDir: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string, isDir: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

/** How many subdirectories of any one directory join the warm queue —
 *  a directory of hundreds of folders must not monopolise it. */
const PREFETCH_MAX = 16;
/** How deep below the directory on screen the warm walks. */
const PREFETCH_DEPTH = 3;
/** Total listings one warm walk may spend. The typical report-server
 *  tree (a handful of state folders, date subfolders below) fits whole;
 *  a giant tree gets its first levels and the rest stays click-time. */
const PREFETCH_BUDGET = 64;

/** Bumped whenever the user navigates, so a stale warm loop stops
 *  competing for the control channel the moment a real click needs it. */
let prefetchGen = 0;

/** Quietly LISTs the subdirectories of what is on screen, one at a
 *  time, straight into the cache. This is what makes the FIRST click
 *  into a folder instant, not just the second: on a far-away server a
 *  listing costs 3-4 round trips, and the seconds the user spends
 *  looking at a directory are exactly enough to fetch its children.
 *  Runs on the same control channel as real navigation — a user click
 *  waits behind at most the one LIST already in flight. */
/** Subdirectory names of a listing, ready for the warm queue. */
function subdirPaths(base: string, rows: FtpEntry[]): string[] {
  return rows
    .filter((e) => e.kind === "directory" && e.name !== "..")
    .slice(0, PREFETCH_MAX)
    .map((e) => joinPath(base, e.name));
}

/** Fetches a set of directories into the cache — two workers, matching
 *  the backend's warm-connection pool. Resolves when every path is
 *  either cached or given up on; it never throws. */
async function warmMany(id: string, paths: string[], gen: number): Promise<void> {
  const queue = [...paths];
  const worker = async () => {
    for (;;) {
      if (gen !== prefetchGen) return;
      const st = useFtpStore.getState();
      if (st.activeId !== id) return;
      const path = queue.shift();
      if (!path) return;
      const key = `${id}:${path}`;
      if (st.listingCache[key]) continue;
      try {
        // The _bg variant runs on its own connection — warming can
        // never make a real click wait.
        const rows = await ipc.ftpListDirBg(id, path);
        useFtpStore.setState((s) => ({
          listingCache: { ...s.listingCache, [key]: rows },
        }));
      } catch {
        // A failure ends this worker quietly — the warm is a hint, not
        // a promise, and errors belong to real navigation only.
        return;
      }
    }
  };
  await Promise.all([worker(), worker()]);
}

/** Walks the tree under `base` into the cache, breadth-first within the
 *  budget: children first, then grandchildren — the order the user is
 *  most likely to click. `levelOne` resolves when the immediate
 *  children are done (the connect flow holds its panel on it); `all`
 *  when the walk has finished or given up. */
function startWarmWalk(
  id: string,
  base: string,
  entries: FtpEntry[],
): { levelOne: Promise<void>; all: Promise<void> } {
  const gen = ++prefetchGen;
  const level1 = subdirPaths(base, entries);
  const levelOne = warmMany(id, level1, gen);
  const all = levelOne.then(async () => {
    let frontier = level1;
    let budget = PREFETCH_BUDGET - level1.length;
    for (let depth = 2; depth <= PREFETCH_DEPTH && budget > 0; depth++) {
      const next: string[] = [];
      const cache = useFtpStore.getState().listingCache;
      for (const p of frontier) {
        const rows = cache[`${id}:${p}`];
        if (rows) next.push(...subdirPaths(p, rows));
      }
      const take = next.slice(0, budget);
      if (take.length === 0) return;
      budget -= take.length;
      await warmMany(id, take, gen);
      frontier = take;
    }
  });
  return { levelOne, all };
}

/** The most recent walk, so the connect flow can hold its "reading
 *  remote directory" panel until the first level is actually cached. */
let lastWalk: { levelOne: Promise<void> } | null = null;

/** Forgets every cached listing that belongs to one connection. */
function dropCacheFor(
  cache: Record<string, FtpEntry[]>,
  id: string,
): Record<string, FtpEntry[]> {
  const next: Record<string, FtpEntry[]> = {};
  for (const [k, v] of Object.entries(cache)) {
    if (!k.startsWith(`${id}:`)) next[k] = v;
  }
  return next;
}

/** Every remote change ends the same way: do it, then re-read the
 *  directory so the pane shows what the server actually has rather than
 *  what we assumed it would have. A failure leaves the listing alone and
 *  puts the reason on screen. */
async function mutate(
  get: () => State,
  set: (partial: Partial<State>) => void,
  run: (id: string) => Promise<void>,
): Promise<void> {
  const id = get().activeId;
  if (!id) return;
  try {
    await run(id);
  } catch (e) {
    set({ error: String(e) });
    return;
  }
  await get().refresh();
}

export const useFtpStore = create<State>((set, get) => ({
  hosts: [],
  loaded: false,
  activeId: null,
  connected: [],
  connecting: [],
  connectPhase: null,
  cwd: "/",
  entries: [],
  listedKey: null,
  listing: false,
  error: null,
  navError: null,
  listingCache: {},

  load: async () => {
    // Live connections outlive a view unmount — they are held on the
    // Rust side — so the list of what is connected has to be asked for,
    // not remembered.
    const [hosts, connected] = await Promise.all([
      ipc.ftpHostList(),
      ipc.ftpActiveIds().catch(() => [] as string[]),
    ]);
    set({ hosts, connected, loaded: true });
  },

  addHost: async (args) => {
    const saved = await ipc.ftpHostSave(args);
    const { password_stored, ...host } = saved;
    set((s) => ({ hosts: [...s.hosts, host] }));
    return host;
  },

  updateHost: async (args) => {
    const saved = await ipc.ftpHostUpdate(args);
    const { password_stored, ...host } = saved;
    set((s) => ({ hosts: s.hosts.map((h) => (h.id === host.id ? host : h)) }));
  },

  deleteHost: async (id) => {
    await ipc.ftpHostDelete(id);
    set((s) => ({
      hosts: s.hosts.filter((h) => h.id !== id),
      connected: s.connected.filter((x) => x !== id),
      ...(s.activeId === id ? { activeId: null, entries: [], listedKey: null, cwd: "/" } : {}),
    }));
  },

  importFromHosts: async (hostIds) => {
    const added = await ipc.ftpHostImport(hostIds);
    set((s) => ({ hosts: [...s.hosts, ...added] }));
    return added.length;
  },

  connect: async (id) => {
    if (get().connecting.includes(id)) return;
    // Focus the row now, not when it succeeds: the pane shows the
    // connecting animation for whichever row it is pointed at, and on
    // failure that is also where the error belongs.
    set((s) => ({
      connecting: [...s.connecting, id],
      connectPhase: "session",
      activeId: id,
      entries: [],
      listedKey: null,
      error: null,
      // A fresh session starts with a fresh cache for this server —
      // whatever changed while we were away must not show as truth.
      listingCache: dropCacheFor(s.listingCache, id),
    }));
    try {
      const { cwd } = await ipc.ftpConnect(id);
      set((s) => ({
        connected: s.connected.includes(id) ? s.connected : [...s.connected, id],
        activeId: id,
        cwd,
        listedKey: null,
        connectPhase: "listing",
      }));
      // Still inside the connecting screen: the panel narrates "reading
      // remote directory…" and only hands over to the pane when the
      // rows are actually there — the WinSCP order of events.
      await get().refresh();
      // …and then some: hold the panel until the immediate children are
      // cached too, so the first click after it disappears is instant.
      // The race is a backstop — a server that refuses the warm
      // connections must not trap the user on the panel.
      if (lastWalk) {
        await Promise.race([
          lastWalk.levelOne,
          new Promise((r) => setTimeout(r, 15_000)),
        ]);
      }
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set((s) => ({
        connecting: s.connecting.filter((x) => x !== id),
        connectPhase: null,
      }));
    }
  },

  disconnect: async (id) => {
    await ipc.ftpDisconnect(id).catch(() => {});
    set((s) => ({
      connected: s.connected.filter((x) => x !== id),
      listingCache: dropCacheFor(s.listingCache, id),
      ...(s.activeId === id ? { entries: [], listedKey: null } : {}),
    }));
  },

  setActive: (id) => set({ activeId: id, entries: [], listedKey: null, error: null }),

  navigate: async (path) => {
    const id = get().activeId;
    if (!id) return;
    const key = `${id}:${path}`;
    // A real click owns the control channel: any warm loop still
    // running for the previous directory stands down now.
    prefetchGen++;
    // Click-to-content timing, straight into the shared log stream:
    // shown_ms is what the user felt (0-ish on a cache hit), server_ms
    // is when the server's own answer replaced it. Pairs with the Rust
    // side's per-phase "ftp data command finished" line.
    const t0 = performance.now();
    const cached = get().listingCache[key];
    if (cached) {
      // Seen this directory before: show it NOW, then revalidate. The
      // fetch below still runs — the swap when it lands is invisible
      // unless the server actually changed.
      set({ entries: cached, cwd: path, listedKey: key, listing: true, error: null });
    } else {
      set({ listing: true, error: null });
    }
    try {
      const entries = await ipc.ftpListDir(id, path);
      set((s) => {
        const listingCache = { ...s.listingCache, [key]: entries };
        // Apply to the screen only if this directory is still the one
        // being shown — a slow reply for a folder the user already left
        // must not overwrite where they are now.
        return s.activeId === id && (!cached || s.cwd === path)
          ? { entries, cwd: path, listedKey: key, listingCache }
          : { listingCache };
      });
      void logPush({
        level: "info",
        category: "sftp",
        message: "ftp navigate timing",
        fields: {
          path,
          cache_hit: !!cached,
          shown_ms: Math.round(cached ? 0 : performance.now() - t0),
          server_ms: Math.round(performance.now() - t0),
        },
      });
      // Fire-and-forget: warm the tree under this directory while the
      // user reads it, so their next click lands on the cache.
      lastWalk = startWarmWalk(id, path, entries);
      void lastWalk.levelOne;
    } catch (e) {
      // Keep the directory that was on screen: dropping the user out of
      // a working folder because one listing failed helps nobody. The
      // key still moves, so a failure is not retried on every render.
      // The key names the directory still on screen, not the one that
      // failed — otherwise the pane would see "not listed yet" and ask
      // again on every render.
      if (path !== get().cwd) {
        // The user clicked INTO a directory and was refused (permission,
        // usually) — that deserves a modal answer, not a line of red
        // text above the directory they are still in.
        set({ navError: String(e), listedKey: `${id}:${get().cwd}` });
      } else {
        set({ error: String(e), listedKey: `${id}:${get().cwd}` });
      }
    } finally {
      set({ listing: false });
    }
  },

  upload: async (localAbs, name, kind, group) => {
    const id = get().activeId;
    if (!id) return;
    const dst = joinPath(get().cwd, name);
    try {
      const isDir = kind === "unknown" ? await localIsDir(localAbs) : kind === "directory";
      if (isDir) await ipc.ftpUploadDir(id, localAbs, dst);
      else await ipc.ftpUpload(id, localAbs, dst, group);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  download: async (name, kind, localDir) => {
    const id = get().activeId;
    if (!id) return;
    const src = joinPath(get().cwd, name);
    // The local join is deliberately naive: localDir comes from the
    // local pane, which already normalizes to forward slashes.
    const dst = localDir === "/" ? `/${name}` : `${localDir}/${name}`;
    try {
      if (kind === "directory") await ipc.ftpDownloadDir(id, src, dst);
      else await ipc.ftpDownload(id, src, dst);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  mkdir: async (path) => {
    await mutate(get, set, (id) => ipc.ftpMkdir(id, path));
  },

  rename: async (from, to) => {
    await mutate(get, set, (id) => ipc.ftpRename(id, from, to));
  },

  remove: async (path, isDir) => {
    await mutate(get, set, (id) => ipc.ftpRemove(id, path, isDir));
  },

  refresh: async () => {
    await get().navigate(get().cwd);
  },

  clearError: () => set({ error: null }),
}));
