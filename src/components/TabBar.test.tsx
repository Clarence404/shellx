import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("renders an active tab at full opacity with pointer events enabled", () => {
    render(
      <TabBar
        tabs={[{ id: "1", title: "one", state: "active" }]}
        activeTabId="1"
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    const tab = screen.getByRole("tab", { name: /one/i });
    expect(tab.style.opacity).toBe("1");
    expect(tab.style.pointerEvents).toBe("auto");
  });

  it("fades a closed tab: opacity 0.4, grayscale filter, pointer-events none", () => {
    render(
      <TabBar
        tabs={[{ id: "1", title: "one", state: "closed" }]}
        activeTabId="1"
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    const tab = screen.getByRole("tab", { name: /one/i });
    expect(tab.style.opacity).toBe("0.4");
    expect(tab.style.filter).toContain("grayscale(0.6)");
    expect(tab.style.pointerEvents).toBe("none");
  });

  it("a tab with no state defaults to fully visible/interactive", () => {
    render(
      <TabBar
        tabs={[{ id: "1", title: "one" }]}
        activeTabId="1"
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    const tab = screen.getByRole("tab", { name: /one/i });
    expect(tab.style.opacity).toBe("1");
    expect(tab.style.pointerEvents).toBe("auto");
  });

  it("clicking select still fires onSelect for an active tab", () => {
    const onSelect = vi.fn();
    render(
      <TabBar
        tabs={[{ id: "1", title: "one", state: "active" }]}
        activeTabId="1"
        onSelect={onSelect}
        onClose={() => {}}
      />
    );
    screen.getByRole("tab", { name: /one/i }).click();
    expect(onSelect).toHaveBeenCalledWith("1");
  });
});
