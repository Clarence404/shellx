import { describe, it, expect } from "vitest";
import { ShadowLine } from "./shadowLine";

describe("ShadowLine", () => {
  it("mirrors plain typing and backspace", () => {
    const s = new ShadowLine();
    s.feed("git statsu");
    s.feed("\x7f\x7f");
    s.feed("us");
    expect(s.line).toBe("git status");
    expect(s.valid).toBe(true);
  });

  it("Enter submits the line and starts a fresh trustworthy one", () => {
    const s = new ShadowLine();
    s.feed("ls -la");
    expect(s.feed("\r")).toEqual(["ls -la"]);
    expect(s.line).toBe("");
    expect(s.valid).toBe(true);
  });

  it("a pasted script submits every line it carries", () => {
    const s = new ShadowLine();
    expect(s.feed("cd /tmp\rls\r")).toEqual(["cd /tmp", "ls"]);
  });

  it("Tab hands the line to the shell and gives up until the next line", () => {
    const s = new ShadowLine();
    s.feed("cd Doc\t");
    expect(s.valid).toBe(false);
    // Whatever Enter runs now is the shell's business, not ours…
    expect(s.feed("\r")).toEqual([]);
    // …but the next line starts clean.
    s.feed("pwd");
    expect(s.valid).toBe(true);
    expect(s.line).toBe("pwd");
  });

  it("arrow keys (any escape sequence) invalidate without absorbing the letters", () => {
    const s = new ShadowLine();
    s.feed("echo hi");
    s.feed("\x1b[D"); // ArrowLeft
    expect(s.valid).toBe(false);
    expect(s.line).toBe("");
  });

  it("Ctrl+C and Ctrl+U both mean a fresh, trustworthy line", () => {
    const s = new ShadowLine();
    s.feed("half a comm");
    s.feed("\x03");
    expect(s.valid).toBe(true);
    expect(s.line).toBe("");

    s.feed("rm -rf /oops\x15");
    expect(s.line).toBe("");
    expect(s.valid).toBe(true);
  });

  it("Ctrl+W kills the last word only", () => {
    const s = new ShadowLine();
    s.feed("git commit -m message");
    s.feed("\x17");
    expect(s.line).toBe("git commit -m ");
  });

  it("readline shortcuts it cannot follow invalidate", () => {
    const s = new ShadowLine();
    s.feed("some line\x01"); // Ctrl+A — cursor to start
    expect(s.valid).toBe(false);
  });

  it("an empty Enter submits nothing", () => {
    const s = new ShadowLine();
    expect(s.feed("\r")).toEqual([]);
    expect(s.feed("   \r")).toEqual([]);
  });

  it("pushText mirrors an accepted suggestion", () => {
    const s = new ShadowLine();
    s.feed("git st");
    s.pushText("atus");
    expect(s.line).toBe("git status");
    expect(s.feed("\r")).toEqual(["git status"]);
  });

  it("CJK input is mirrored, not mangled", () => {
    const s = new ShadowLine();
    s.feed('echo "你好"');
    expect(s.line).toBe('echo "你好"');
  });
});
