import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PaneSplitter } from "./PaneSplitter";

describe("PaneSplitter", () => {
  it("double-click resets to 50", () => {
    const onChange = vi.fn();
    render(<PaneSplitter percent={70} onChange={onChange} />);
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(onChange).toHaveBeenCalledWith(50);
  });

  it("mousedown+move fires onChange with computed percent", () => {
    const onChange = vi.fn();
    render(
      <div style={{ display: "flex", width: 1000 }}>
        <div style={{ width: 500 }} />
        <PaneSplitter percent={50} onChange={onChange} />
      </div>
    );
    const sep = screen.getByRole("separator");
    fireEvent.mouseDown(sep);
    // Simulate mouse move at clientX=800 → parent is width 1000+, so ~80%
    fireEvent(window, new MouseEvent("mousemove", { clientX: 800, bubbles: true }));
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
  });
});
