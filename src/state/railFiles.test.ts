import { describe, it, expect, beforeEach, vi } from "vitest";
import { useRailFiles } from "./railFiles";

describe("useRailFiles", () => {
  beforeEach(() => {
    localStorage.clear();
    useRailFiles.setState({
      leftPath: "",
      leftEntries: [], leftLoading: false, leftError: null, leftSelected: [],
      rightHost: null, rightPath: "",
      rightEntries: [], rightLoading: false, rightError: null, rightSelected: [],
      splitterPercent: 50,
    });
  });

  it("splitter defaults to 50", () => {
    expect(useRailFiles.getState().splitterPercent).toBe(50);
  });

  it("setSplitter clamps to [20, 80]", () => {
    useRailFiles.getState().setSplitter(10);
    expect(useRailFiles.getState().splitterPercent).toBe(20);
    useRailFiles.getState().setSplitter(90);
    expect(useRailFiles.getState().splitterPercent).toBe(80);
    useRailFiles.getState().setSplitter(65);
    expect(useRailFiles.getState().splitterPercent).toBe(65);
  });

  it("toggleSelectLeft multi vs single adds and replaces", () => {
    useRailFiles.getState().toggleSelectLeft("a", false);
    expect(useRailFiles.getState().leftSelected).toEqual(["a"]);
    useRailFiles.getState().toggleSelectLeft("b", false);
    expect(useRailFiles.getState().leftSelected).toEqual(["b"]);
    useRailFiles.getState().toggleSelectLeft("c", true);
    expect(useRailFiles.getState().leftSelected).toEqual(["b", "c"]);
    useRailFiles.getState().toggleSelectLeft("b", true);
    expect(useRailFiles.getState().leftSelected).toEqual(["c"]);
  });
});
