import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PathBreadcrumb } from "./PathBreadcrumb";

describe("PathBreadcrumb", () => {
  it("splits /home/chen/apps into a root '/' chip plus 3 clickable segments", () => {
    render(<PathBreadcrumb path="/home/chen/apps" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: "/" })).toBeInTheDocument();
    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.getByText("chen")).toBeInTheDocument();
    expect(screen.getByText("apps")).toBeInTheDocument();
  });

  it("clicking a middle segment fires onNavigate with the path to that segment", () => {
    const onNavigate = vi.fn();
    render(<PathBreadcrumb path="/home/chen/apps" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("chen"));
    expect(onNavigate).toHaveBeenCalledWith("/home/chen");
  });

  it("clicking the root '/' chip navigates to /", () => {
    const onNavigate = vi.fn();
    render(<PathBreadcrumb path="/home/chen/apps" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "/" }));
    expect(onNavigate).toHaveBeenCalledWith("/");
  });

  it("root path shows single '/' segment", () => {
    render(<PathBreadcrumb path="/" onNavigate={() => {}} />);
    expect(screen.getByText("/")).toBeInTheDocument();
  });
});
