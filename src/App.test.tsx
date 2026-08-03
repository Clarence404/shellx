import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  it("renders the activity rail, an empty drawer, and an empty state in the main area", () => {
    render(<App />);
    expect(screen.getByRole("navigation", { name: "activity rail" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();
    expect(screen.getByText(/a tiny, pretty terminal client/i)).toBeInTheDocument();
  });
});
