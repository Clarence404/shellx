import { invoke } from "@tauri-apps/api/core";
import { onTransferDone } from "./ipc/transfers";

/**
 * Dragging a file out of the window and into the OS.
 *
 * The webview cannot do this itself — HTML5 drag events stop at the
 * window edge — so the Rust side starts a real OS drag with a list of
 * local paths. A local row hands its path over directly; a remote row is
 * staged first: downloaded through the ordinary transfer queue into a
 * per-gesture temp folder, and the copy is what leaves the window. The
 * same trade WinSCP makes, with the queue strip as the progress bar.
 */

export const dragOut = (paths: string[]) =>
  invoke<void>("drag_out", { args: { paths } });

const stagingDir = () => invoke<string>("drag_out_staging_dir");

/**
 * Runs `start` (which queues one or more transfers and returns their
 * ids) and resolves once every one of them has finished, true when all
 * of them succeeded.
 *
 * The subscription is live before `start` is called, and events that
 * arrive before the ids are known are buffered — a small file on a fast
 * link can finish before the invoke that started it returns, and an
 * await wired up afterwards would hang forever.
 */
export async function awaitTransfers(start: () => Promise<string[]>): Promise<boolean> {
  const finished = new Map<string, boolean>();
  let pending: Set<string> | null = null;
  let settle: (ok: boolean) => void = () => {};
  let failed = false;
  const all = new Promise<boolean>((r) => { settle = r; });

  const unlisten = await onTransferDone((ev) => {
    const ok = ev.state.kind === "done";
    if (pending === null) {
      finished.set(ev.transfer_id, ok);
      return;
    }
    if (!pending.has(ev.transfer_id)) return;
    pending.delete(ev.transfer_id);
    if (!ok) failed = true;
    if (pending.size === 0) settle(!failed);
  });

  try {
    const ids = await start();
    if (ids.length === 0) return true;
    const set = new Set(ids);
    // Drain what finished while the invoke was in flight.
    for (const [id, ok] of finished) {
      if (set.has(id)) {
        set.delete(id);
        if (!ok) failed = true;
      }
    }
    if (set.size === 0) return !failed;
    pending = set;
    return await all;
  } finally {
    unlisten();
  }
}

/**
 * Stages a remote entry and starts the OS drag once it has fully
 * landed. `start` receives the staging destination (dir + name already
 * joined) and returns the transfer ids to wait for.
 *
 * The user is holding the button outside the window the whole time; if
 * they let go before the download finishes, the drag simply starts and
 * immediately cancels — nothing is dropped anywhere, and the staged
 * copy is left in the temp folder for the OS to clean up.
 */
export async function dragOutRemote(
  name: string,
  start: (dest: string) => Promise<string[]>,
): Promise<void> {
  const dir = await stagingDir();
  const dest = `${dir.replace(/[\\/]+$/, "")}/${name}`;
  const ok = await awaitTransfers(() => start(dest));
  if (ok) await dragOut([dest]);
}
