import { describe, it, expect } from "vitest";
import { notesForLanguage, ZH_MARKER } from "./releaseNotesLang";

const EN = "What's new.\n\n- **A thing.** Detail.";
const ZH = "本版更新。\n\n- **一项改动。**说明。";
const BOTH = `${EN}\n\n${ZH_MARKER}\n${ZH}`;

describe("notesForLanguage", () => {
  it("gives each language its own half", () => {
    expect(notesForLanguage(BOTH, "en")).toBe(EN);
    expect(notesForLanguage(BOTH, "zh")).toBe(ZH);
  });

  it("shows the English notes of a release that shipped before translations", () => {
    expect(notesForLanguage(EN, "zh")).toBe(EN);
    expect(notesForLanguage(EN, "en")).toBe(EN);
  });

  it("falls back to the other language rather than an empty box", () => {
    expect(notesForLanguage(`${EN}\n\n${ZH_MARKER}\n`, "zh")).toBe(EN);
    expect(notesForLanguage(`${ZH_MARKER}\n${ZH}`, "en")).toBe(ZH);
  });

  it("has nothing to show for a release with no notes at all", () => {
    expect(notesForLanguage("", "zh")).toBe("");
    expect(notesForLanguage(null, "en")).toBe("");
    expect(notesForLanguage(undefined, "en")).toBe("");
  });

  it("does not leave the marker in the text it returns", () => {
    expect(notesForLanguage(BOTH, "en")).not.toContain(ZH_MARKER);
    expect(notesForLanguage(BOTH, "zh")).not.toContain(ZH_MARKER);
  });
});
