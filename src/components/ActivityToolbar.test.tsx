import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ActivityToolbar } from "./ActivityToolbar";

describe("ActivityToolbar", () => {
  it("renders Terminal + Files buttons", () => {
    render(<ActivityToolbar activity="terminal" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /terminal/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /files/i })).toBeInTheDocument();
  });

  it("clicking Files fires onChange('files')", () => {
    const onChange = vi.fn();
    render(<ActivityToolbar activity="terminal" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    expect(onChange).toHaveBeenCalledWith("files");
  });

  it("active button has aria-pressed=true", () => {
    render(<ActivityToolbar activity="files" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /files/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /terminal/i })).toHaveAttribute("aria-pressed", "false");
  });
});
