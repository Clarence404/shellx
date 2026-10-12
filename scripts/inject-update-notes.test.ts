import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs build script, no type declarations
import { injectNotes, ZH_MARKER } from "./inject-update-notes.mjs";

const MANIFEST = {
  version: "0.35.0",
  notes: "",
  pub_date: "2026-10-12T03:14:19.788Z",
  platforms: {
    "windows-x86_64": { signature: "SIG-WIN", url: "https://example.com/shellx.exe" },
    "linux-x86_64": { signature: "SIG-LIN", url: "https://example.com/shellx.AppImage" },
  },
};

const ZH = "本版更新。";

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

  it("carries both languages in the one notes field, English first", () => {
    const out = injectNotes(MANIFEST, "English notes.", ZH);
    expect(out.notes).toBe(`English notes.\n\n${ZH_MARKER}\n${ZH}`);
  });

  it("leaves the marker out when there is no translation, as before", () => {
    expect(injectNotes(MANIFEST, "English only.", "").notes).toBe("English only.");
    expect(injectNotes(MANIFEST, "English only.").notes).toBe("English only.");
  });

  it("does not mutate its input", () => {
    injectNotes(MANIFEST, "x", ZH);
    expect(MANIFEST.notes).toBe("");
  });
});

describe("the command line", () => {
  const run = (...args: string[]) => execFileSync("node", ["scripts/inject-update-notes.mjs", ...args], { encoding: "utf8" });

  /** Each case gets its own temp dir with a manifest already written. */
  function inTempDir(body: (dir: string) => void, manifest: object = MANIFEST) {
    const dir = mkdtempSync(join(tmpdir(), "notes-"));
    try {
      writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest));
      body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const written = (dir: string) => JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));

  it("rewrites latest.json in place from a notes file", () => {
    inTempDir((dir) => {
      writeFileSync(join(dir, "v.md"), "# v0.35.0\n\nWhat's new.\n");
      run(join(dir, "latest.json"), join(dir, "v.md"));
      expect(written(dir).notes).toContain("What's new.");
      expect(written(dir).platforms["windows-x86_64"].signature).toBe("SIG-WIN");
    });
  });

  it("takes both files and marks the halves", () => {
    inTempDir((dir) => {
      writeFileSync(join(dir, "v.md"), "What's new.\n");
      writeFileSync(join(dir, "v.zh-CN.md"), `${ZH}\n`);
      run(join(dir, "latest.json"), join(dir, "v.md"), join(dir, "v.zh-CN.md"));
      expect(written(dir).notes).toBe(`What's new.\n\n${ZH_MARKER}\n${ZH}`);
    });
  });

  it("a missing translation still ships the English half", () => {
    inTempDir((dir) => {
      writeFileSync(join(dir, "v.md"), "English only.\n");
      run(join(dir, "latest.json"), join(dir, "v.md"), join(dir, "nope.zh-CN.md"));
      expect(written(dir).notes).toBe("English only.");
    });
  });

  it("a missing notes file leaves notes empty instead of failing the release", () => {
    inTempDir((dir) => {
      run(join(dir, "latest.json"), join(dir, "does-not-exist.md"));
      expect(written(dir).notes).toBe("");
    }, { ...MANIFEST, notes: "stale" });
  });
});
