import { describe, it, expect } from "vitest";
import { needsPasteConfirm } from "./pasteGuard";

describe("needsPasteConfirm", () => {
  it("a short single line pastes straight through", () => {
    expect(needsPasteConfirm("ls -la")).toBe(false);
  });

  it("any line break asks first — it would execute on arrival", () => {
    expect(needsPasteConfirm("cd /tmp\nls")).toBe(true);
    expect(needsPasteConfirm("cd /tmp\r\nls")).toBe(true);
  });

  it("a trailing newline alone still executes, so it still asks", () => {
    expect(needsPasteConfirm("rm -rf ./build\n")).toBe(true);
  });

  it("a very long single line asks too", () => {
    expect(needsPasteConfirm("x".repeat(501))).toBe(true);
    expect(needsPasteConfirm("x".repeat(500))).toBe(false);
  });
});
