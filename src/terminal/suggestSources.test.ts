import { describe, it, expect } from "vitest";
import { mergeCandidates, MAX_CANDIDATES } from "./suggestSources";

describe("mergeCandidates", () => {
  it("history first, then dictionary, deduplicated", () => {
    const got = mergeCandidates("sud", ["sudo docker ps", "sudo passwd root"]);
    expect(got[0]).toEqual({ text: "sudo docker ps", source: "h" });
    expect(got[1]).toEqual({ text: "sudo passwd root", source: "h" });
    // Dictionary rows follow: sudo / sudoedit / sudu is not a command.
    expect(got.some((c) => c.text === "sudo" && c.source === "c")).toBe(true);
    expect(got.some((c) => c.text === "sudoedit" && c.source === "c")).toBe(true);
  });

  it("a history row identical to a dictionary name wins the row", () => {
    const got = mergeCandidates("sud", ["sudo"]);
    expect(got.filter((c) => c.text === "sudo")).toEqual([{ text: "sudo", source: "h" }]);
  });

  it("nothing equals the line itself", () => {
    const got = mergeCandidates("sudo", ["sudo"]);
    expect(got.some((c) => c.text === "sudo")).toBe(false);
  });

  it("the dictionary stays out once a second word starts", () => {
    const got = mergeCandidates("docker lo", ["docker logs -f 6499"]);
    expect(got).toEqual([{ text: "docker logs -f 6499", source: "h" }]);
  });

  it("caps at eight rows", () => {
    const history = Array.from({ length: 20 }, (_, i) => `git command-${i}`);
    expect(mergeCandidates("git", history)).toHaveLength(MAX_CANDIDATES);
  });
});
