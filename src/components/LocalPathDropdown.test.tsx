import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LocalPathDropdown } from "./LocalPathDropdown";

vi.mock("../ipc/local", () => ({
  localDefaultRoots: vi.fn().mockResolvedValue({
    home: "/home/chen", desktop: "/home/chen/Desktop", downloads: "/home/chen/Downloads",
  }),
}));

describe("LocalPathDropdown", () => {
  it("shows '~ Home' label when currentPath equals home", async () => {
    render(<LocalPathDropdown currentPath="/home/chen" onSelect={() => {}} />);
    await screen.findByText("~ Home");
  });

  it("opens dropdown and fires onSelect", async () => {
    const onSelect = vi.fn();
    render(<LocalPathDropdown currentPath="/home/chen" onSelect={onSelect} />);
    await screen.findByText("~ Home");
    fireEvent.click(screen.getAllByText("~ Home")[0]); // button
    fireEvent.click(await screen.findByText("Desktop"));
    expect(onSelect).toHaveBeenCalledWith("/home/chen/Desktop");
  });

  it("survives a real mousedown-then-click on a list item (mousedown/click race)", async () => {
    // Regression: the document-level mousedown listener used to close the
    // popup because the <ul> is a sibling of the trigger button, not a
    // descendant — so mousedown on an <li> closed the list before its click
    // handler fired. fireEvent.click alone doesn't reproduce this; a real
    // browser click fires mousedown then click on the same target.
    const onSelect = vi.fn();
    render(<LocalPathDropdown currentPath="/home/chen" onSelect={onSelect} />);
    await screen.findByText("~ Home");
    fireEvent.click(screen.getAllByText("~ Home")[0]); // open the dropdown
    const desktopItem = await screen.findByText("Desktop");
    fireEvent.mouseDown(desktopItem);
    fireEvent.click(desktopItem);
    expect(onSelect).toHaveBeenCalledWith("/home/chen/Desktop");
  });
});
