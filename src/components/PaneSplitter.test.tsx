import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PaneSplitter } from "./PaneSplitter";

describe("PaneSplitter", () => {
  it("double-click resets to 50 via onCommit (not onChange)", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<PaneSplitter percent={70} onChange={onChange} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(onCommit).toHaveBeenCalledWith(50);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("mousedown+move fires onChange (draft) per move, and onCommit once on mouseup", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <div style={{ display: "flex", width: 1000 }}>
        <div style={{ width: 500 }} />
        <PaneSplitter percent={50} onChange={onChange} onCommit={onCommit} />
      </div>
    );
    const sep = screen.getByRole("separator");
    fireEvent.mouseDown(sep);
    // Simulate mouse move at clientX=800 → parent is width 1000+, so ~80%
    fireEvent(window, new MouseEvent("mousemove", { clientX: 800, bubbles: true }));
    fireEvent(window, new MouseEvent("mousemove", { clientX: 810, bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
