import { describe, it, expect, beforeEach } from "vitest";
import { useSessions } from "./sessions";

describe("sessions store", () => {
  beforeEach(() => {
    useSessions.setState({ sessions: [], activeId: null });
  });

  it("adds a session and sets it active", () => {
    useSessions.getState().addSession({ id: "1", label: "a", kind: "ssh" });
    expect(useSessions.getState().sessions).toHaveLength(1);
    expect(useSessions.getState().activeId).toBe("1");
  });

  it("removes a session and picks another as active if any remain", () => {
    const s = useSessions.getState();
    s.addSession({ id: "1", label: "a", kind: "ssh" });
    s.addSession({ id: "2", label: "b", kind: "ssh" });
    s.removeSession("2");
    expect(useSessions.getState().sessions.map(x => x.id)).toEqual(["1"]);
    expect(useSessions.getState().activeId).toBe("1");
  });

  it("clears activeId when the last session is removed", () => {
    const s = useSessions.getState();
    s.addSession({ id: "1", label: "a", kind: "ssh" });
    s.removeSession("1");
    expect(useSessions.getState().activeId).toBeNull();
  });
});
