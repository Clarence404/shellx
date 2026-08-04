import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { App } from "./App";

vi.mock("./state/hosts", () => ({
  useHostsStore: Object.assign(
    (selector: any) => selector({
      hosts: [], keychainAvailable: false, loaded: false, load: vi.fn(),
      addHost: vi.fn(), updateHostById: vi.fn(), deleteHostById: vi.fn(),
    }),
    {
      getState: () => ({ hosts: [], keychainAvailable: false, loaded: false }),
      setState: vi.fn(),
    },
  ),
}));
vi.mock("./ipc/hosts", () => ({
  listHosts: vi.fn().mockResolvedValue([]),
  keychainAvailable: vi.fn().mockResolvedValue(false),
  getHostPassword: vi.fn().mockResolvedValue(null),
}));

describe("App shell", () => {
  it("renders the activity rail, an empty drawer, and an empty state in the main area", () => {
    render(<App />);
    expect(screen.getByRole("navigation", { name: "activity rail" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "drawer" })).toBeInTheDocument();
    expect(screen.getByText(/a tiny, pretty terminal client/i)).toBeInTheDocument();
  });
});
