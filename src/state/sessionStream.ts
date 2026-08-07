//! One-and-only `session:data` router.
//!
//! A fresh `TerminalView` takes several ms to mount and register its byte
//! consumer (React reconcile + async `listen()` roundtrip), while the Rust
//! pump task for a new session starts emitting `session:data` immediately
//! after the connect IPC resolves. The welcome banner + PS1 prompt often
//! arrive BEFORE the per-view listener is up, so a naive per-TerminalView
//! subscribe loses those bytes on the first paint of a new tab. The
//! symptom the user sees: the freshly opened terminal is blank until they
//! hit Enter and the shell echoes a new prompt.
//!
//! This module installs a single global listener at app startup that
//! buffers bytes per session id until a consumer subscribes. Once a
//! consumer arrives, buffered bytes replay in order and every future
//! chunk passes through directly.

import { onSessionData, onConnectionClosed } from "../ipc/events";
import type { ConnectionId } from "../types/connection";

type Consumer = (chunk: Uint8Array) => void;

const subscribers = new Map<ConnectionId, Consumer>();
const buffers = new Map<ConnectionId, Uint8Array[]>();

let installed = false;

/**
 * Wire the one-and-only `session:data` listener. Call once from App's
 * mount effect. Idempotent — repeated calls no-op.
 */
export function installSessionStream(): void {
  if (installed) return;
  installed = true;

  void onSessionData(({ id, data }) => {
    const chunk = new Uint8Array(data);
    const consumer = subscribers.get(id);
    if (consumer) {
      consumer(chunk);
      return;
    }
    const buf = buffers.get(id);
    if (buf) {
      buf.push(chunk);
    } else {
      buffers.set(id, [chunk]);
    }
  });

  // Sessions that close without ever getting a consumer would otherwise
  // leak their scrollback in `buffers` forever. Drop it on close.
  void onConnectionClosed(({ id }) => {
    buffers.delete(id);
  });
}

/**
 * Subscribe a consumer to `session:data` bytes for `id`. Any bytes that
 * arrived before subscription replay immediately, in order. Returns an
 * unsubscribe function that only detaches if `consumer` is still the
 * active subscriber (so a stale cleanup from an effect that raced with
 * a re-subscribe can't kick out the current consumer).
 */
export function subscribeSession(id: ConnectionId, consumer: Consumer): () => void {
  subscribers.set(id, consumer);
  const buf = buffers.get(id);
  if (buf) {
    for (const chunk of buf) consumer(chunk);
    buffers.delete(id);
  }
  return () => {
    if (subscribers.get(id) === consumer) subscribers.delete(id);
  };
}

/**
 * Test-only hook. Vitest imports this to reset module state between tests
 * — otherwise the singleton `installed` flag survives across `beforeEach`
 * and mocks the second test would set up never run.
 */
export function _resetSessionStreamForTests(): void {
  subscribers.clear();
  buffers.clear();
  installed = false;
}
