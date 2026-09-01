import { describe, it, expect } from "vitest";
import { extractPlaceholders, fillPlaceholders } from "./placeholders";

describe("snippet placeholders", () => {
  it("finds unique names in order of first appearance", () => {
    expect(extractPlaceholders("systemctl restart ${svc} && systemctl status ${svc}"))
      .toEqual(["svc"]);
    expect(extractPlaceholders("scp ${file} ${host}:${file}"))
      .toEqual(["file", "host"]);
  });

  it("a command with no blanks has none", () => {
    expect(extractPlaceholders("df -h")).toEqual([]);
  });

  it("fills every occurrence, and leaves unknown names visible", () => {
    expect(fillPlaceholders("echo ${a} ${a} ${b}", { a: "x" })).toBe("echo x x ${b}");
  });

  it("CJK placeholder names work", () => {
    expect(extractPlaceholders("systemctl restart ${服务名}")).toEqual(["服务名"]);
    expect(fillPlaceholders("systemctl restart ${服务名}", { 服务名: "nginx" }))
      .toBe("systemctl restart nginx");
  });
});
