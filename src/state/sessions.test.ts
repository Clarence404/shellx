import { describe, it, expect, beforeEach } from "vitest";
import { useSessions } from "./sessions";
import type { TunnelStatus } from "../types/tunnel";

describe("sessions store", () => {
  beforeEach(() => {
    useSessions.setState({ sessions: [], activeId: null });
  });

  it("adds a session and sets it active", () => {
    useSessions.getState().addSession({ id: "1", label: "a", kind: "ssh", host_id: null, state: "active" });
    expect(useSessions.getState().sessions).toHaveLength(1);
    expect(useSessions.getState().activeId).toBe("1");
  });

  it("removes a session and picks another as active if any remain", () => {
    const s = useSessions.getState();
    s.addSession({ id: "1", label: "a", kind: "ssh", host_id: null, state: "active" });
    s.addSession({ id: "2", label: "b", kind: "ssh", host_id: null, state: "active" });
    s.removeSession("2");
    expect(useSessions.getState().sessions.map(x => x.id)).toEqual(["1"]);
    expect(useSessions.getState().activeId).toBe("1");
  });

  it("clears activeId when the last session is removed", () => {
    const s = useSessions.getState();
    s.addSession({ id: "1", label: "a", kind: "ssh", host_id: null, state: "active" });
    s.removeSession("1");
    expect(useSessions.getState().activeId).toBeNull();
  });

  it("hostIsConnected() reflects whether a session with that host_id exists", () => {
    const s = useSessions.getState();
    expect(s.hostIsConnected("h1")).toBe(false);
    s.addSession({ id: "1", label: "a", kind: "ssh", host_id: "h1", state: "active" });
    expect(useSessions.getState().hostIsConnected("h1")).toBe(true);
    expect(useSessions.getState().hostIsConnected("h2")).toBe(false);
  });
});

describe("tunnelStatuses", () => {
  beforeEach(() => useSessions.setState({ tunnelStatuses: {} }));

  it("setTunnelStatus adds new entry", () => {
    const status: TunnelStatus = { rule_id: "r1", session_id: "s1", status: "active" };
    useSessions.getState().setTunnelStatus("s1", status);
    expect(useSessions.getState().tunnelStatuses["s1"]).toHaveLength(1);
  });

  it("setTunnelStatus updates existing entry", () => {
    const store = useSessions.getState();
    store.setTunnelStatus("s1", { rule_id: "r1", session_id: "s1", status: "active" });
    store.setTunnelStatus("s1", { rule_id: "r1", session_id: "s1", status: "error", error: "bind failed" });
    const entries = useSessions.getState().tunnelStatuses["s1"];
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("error");
  });

  it("clearTunnelStatuses removes session entry", () => {
    useSessions.getState().setTunnelStatus("s1", { rule_id: "r1", session_id: "s1", status: "active" });
    useSessions.getState().clearTunnelStatuses("s1");
    expect(useSessions.getState().tunnelStatuses["s1"]).toBeUndefined();
  });
});
