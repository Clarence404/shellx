import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs build script, no type declarations
import { injectNotes } from "./inject-update-notes.mjs";

const MANIFEST = {
  version: "0.35.0",
  notes: "",
  pub_date: "2026-10-12T03:14:19.788Z",
  platforms: {
    "windows-x86_64": { signature: "SIG-WIN", url: "https://example.com/shellx.exe" },
    "linux-x86_64": { signature: "SIG-LIN", url: "https://example.com/shellx.AppImage" },
  },
};

describe("injectNotes", () => {
  it("fills the notes and leaves everything else — signatures included — alone", () => {
    const out = injectNotes(MANIFEST, "# v0.35.0\n\nHello.\n\n- **A.** b\n");
    expect(out.notes).toBe("# v0.35.0\n\nHello.\n\n- **A.** b");
    expect(out.version).toBe("0.35.0");
    expect(out.platforms).toEqual(MANIFEST.platforms);
    expect(out.pub_date).toBe(MANIFEST.pub_date);
  });

  it("normalises Windows line endings so the app never sees stray \\r", () => {
    expect(injectNotes(MANIFEST, "a\r\nb\r\n").notes).toBe("a\nb");
  });

  it("does not mutate its input", () => {
    injectNotes(MANIFEST, "x");
    expect(MANIFEST.notes).toBe("");
  });
});

describe("the command line", () => {
  const run = (...args: string[]) => execFileSync("node", ["scripts/inject-update-notes.mjs", ...args], { encoding: "utf8" });

  it("rewrites latest.json in place from a notes file", () => {
    const dir = mkdtempSync(join(tmpdir(), "notes-"));
    try {
      writeFileSync(join(dir, "latest.json"), JSON.stringify(MANIFEST));
      writeFileSync(join(dir, "v.md"), "# v0.35.0\n\nWhat's new.\n");
      run(join(dir, "latest.json"), join(dir, "v.md"));
      const written = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
      expect(written.notes).toContain("What's new.");
      expect(written.platforms["windows-x86_64"].signature).toBe("SIG-WIN");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a missing notes file leaves notes empty instead of failing the release", () => {
    const dir = mkdtempSync(join(tmpdir(), "notes-"));
    try {
      writeFileSync(join(dir, "latest.json"), JSON.stringify({ ...MANIFEST, notes: "stale" }));
      run(join(dir, "latest.json"), join(dir, "does-not-exist.md"));
      expect(JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")).notes).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
