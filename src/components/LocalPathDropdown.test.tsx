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
});
