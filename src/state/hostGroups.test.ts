import { describe, it, expect, beforeEach } from "vitest";
import {
  buildView, groupNames, matchesQuery, splitHighlight, loadCollapsed, saveCollapsed,
} from "./hostGroups";
import type { HostInfo } from "../types/host";

let n = 0;
function host(label: string, group: string | null = null, over: Partial<HostInfo> = {}): HostInfo {
  n += 1;
  return {
    id: `h${n}`, label, host: `10.0.0.${n}`, port: 22, username: "deploy", notes: null,
    created_at: 0, last_connected_at: null, sort_order: n, auth_method: "password",
    key_path: null, connection_mode: "terminal_only", group_name: group,
    ...over,
  };
}
const none = new Set<string>();
const offline = () => false;
const labels = (v: ReturnType<typeof buildView>) =>
  v.items.map((i) => (i.kind === "host" ? i.host.label : i.kind === "group" ? `[${i.name}]` : "[ungrouped]"));

beforeEach(() => { n = 0; localStorage.clear(); });

describe("groupNames", () => {
  it("lists each group once, sorted, ignoring blanks", () => {
    const hosts = [host("a", "test"), host("b", "prod"), host("c", "prod"), host("d", "  "), host("e")];
    expect(groupNames(hosts)).toEqual(["prod", "test"]);
  });

  it("sorts numerically and handles Chinese names", () => {
    const hosts = [host("a", "区10"), host("b", "区2"), host("c", "生产")];
    const names = groupNames(hosts);
    expect(names.indexOf("区2")).toBeLessThan(names.indexOf("区10"));
  });
});

describe("buildView — no groups", () => {
  it("is the flat list it always was: no headers at all", () => {
    const hosts = [host("web"), host("db")];
    const v = buildView(hosts, "", none, offline);
    expect(labels(v)).toEqual(["web", "db"]);
    expect(v.visibleIds).toEqual(hosts.map((h) => h.id));
  });
});

describe("buildView — grouped", () => {
  const hosts = () => [host("web1", "prod"), host("cache"), host("stg", "test"), host("web2", "prod")];

  it("puts groups alphabetically first, keeps each group's own order, and ungrouped last", () => {
    expect(labels(buildView(hosts(), "", none, offline))).toEqual([
      "[prod]", "web1", "web2", "[test]", "stg", "[ungrouped]", "cache",
    ]);
  });

  it("counts members and how many are online", () => {
    const hs = hosts();
    const online = new Set([hs[0].id]);
    const v = buildView(hs, "", none, (id) => online.has(id));
    const prod = v.items.find((i) => i.kind === "group" && i.name === "prod");
    expect(prod).toMatchObject({ total: 2, online: 1, open: true });
  });

  it("leaves a collapsed group's members out of the visible ids", () => {
    const hs = hosts();
    const v = buildView(hs, "", new Set(["prod"]), offline);
    expect(labels(v)).toEqual(["[prod]", "[test]", "stg", "[ungrouped]", "cache"]);
    expect(v.visibleIds).toEqual([hs[2].id, hs[1].id]);
    expect(v.items[0]).toMatchObject({ kind: "group", name: "prod", total: 2, open: false });
  });

  it("omits the Ungrouped label when everything is grouped", () => {
    const v = buildView([host("a", "x"), host("b", "x")], "", none, offline);
    expect(labels(v)).toEqual(["[x]", "a", "b"]);
  });
});

describe("matchesQuery", () => {
  const h = host("Web-01", "Prod", { host: "10.1.2.3", username: "Deploy" });

  it("matches label, address, username and group, case-insensitively", () => {
    for (const q of ["web", "10.1.2", "deploy", "prod", "WEB-01"]) expect(matchesQuery(h, q)).toBe(true);
  });
  it("does not match something else", () => expect(matchesQuery(h, "nope")).toBe(false));
  it("a blank query matches everything", () => {
    expect(matchesQuery(h, "")).toBe(true);
    expect(matchesQuery(h, "   ")).toBe(true);
  });
});

describe("buildView — searching", () => {
  it("shows only matching hosts and drops groups with none", () => {
    const hs = [host("web1", "prod"), host("db1", "prod"), host("web9", "test"), host("nas")];
    const v = buildView(hs, "db", none, offline);
    expect(labels(v)).toEqual(["[prod]", "db1"]);
    expect(v.matchCount).toBe(1);
  });

  it("expands a collapsed group that has a match", () => {
    const hs = [host("web1", "prod"), host("db1", "prod")];
    const v = buildView(hs, "db", new Set(["prod"]), offline);
    expect(v.items[0]).toMatchObject({ kind: "group", open: true, total: 1 });
    expect(v.visibleIds).toEqual([hs[1].id]);
  });

  it("a group-name hit brings in the whole group", () => {
    const hs = [host("a", "prod"), host("b", "prod"), host("c", "test")];
    expect(labels(buildView(hs, "prod", none, offline))).toEqual(["[prod]", "a", "b"]);
  });

  it("can match nothing", () => {
    const v = buildView([host("a", "x")], "zzz", none, offline);
    expect(v.items).toEqual([]);
    expect(v.visibleIds).toEqual([]);
    expect(v.matchCount).toBe(0);
  });

  it("counts online only among the matches", () => {
    const hs = [host("web1", "prod"), host("db1", "prod")];
    const v = buildView(hs, "db", none, () => true);
    expect(v.items[0]).toMatchObject({ total: 1, online: 1 });
  });
});

describe("splitHighlight", () => {
  it("marks the matched slice", () => {
    expect(splitHighlight("web-01", "b-0")).toEqual([
      { text: "we", hit: false }, { text: "b-0", hit: true }, { text: "1", hit: false },
    ]);
  });
  it("keeps the original casing of the text", () => {
    expect(splitHighlight("Web", "WEB")).toEqual([{ text: "Web", hit: true }]);
  });
  it("is one plain segment with no query or no hit", () => {
    expect(splitHighlight("web", "")).toEqual([{ text: "web", hit: false }]);
    expect(splitHighlight("web", "x")).toEqual([{ text: "web", hit: false }]);
  });
});

describe("collapsed state persistence", () => {
  it("round-trips through localStorage", () => {
    saveCollapsed(new Set(["prod", "test"]));
    expect([...loadCollapsed()].sort()).toEqual(["prod", "test"]);
  });
  it("starts empty, and survives junk in storage", () => {
    expect(loadCollapsed().size).toBe(0);
    localStorage.setItem("shellx.hostGroupsCollapsed", "{not json");
    expect(loadCollapsed().size).toBe(0);
    localStorage.setItem("shellx.hostGroupsCollapsed", JSON.stringify([1, "ok", null]));
    expect([...loadCollapsed()]).toEqual(["ok"]);
  });
});
