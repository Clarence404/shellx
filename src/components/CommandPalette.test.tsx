import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";
import type { HostInfo } from "../types/host";

const HOSTS: HostInfo[] = [
  { id: "1", label: "prod-1", host: "10.0.0.1", port: 22, username: "chen",
    notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
    auth_method: "password", key_path: null },
  { id: "2", label: "db-master", host: "10.0.0.2", port: 22, username: "root",
    notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
    auth_method: "password", key_path: null },
  { id: "3", label: "stage-web", host: "stage.example.com", port: 22, username: "deploy",
    notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
    auth_method: "password", key_path: null },
];

vi.mock("../state/hosts", () => ({
  useHostsStore: (selector: any) => selector({ hosts: HOSTS }),
}));

describe("CommandPalette", () => {
  it("renders all hosts when input is empty", () => {
    render(<CommandPalette open onClose={() => {}} onConnect={() => {}} />);
    expect(screen.getByText("prod-1")).toBeInTheDocument();
    expect(screen.getByText("db-master")).toBeInTheDocument();
    expect(screen.getByText("stage-web")).toBeInTheDocument();
  });

  it("filters by substring on label / host / username", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} onConnect={() => {}} />);
    const input = screen.getByPlaceholderText(/type to search/i);
    await user.type(input, "prod");
    expect(screen.getByText("prod-1")).toBeInTheDocument();
    expect(screen.queryByText("db-master")).not.toBeInTheDocument();
  });

  it("Enter triggers onConnect with the selected host", async () => {
    const onConnect = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} onConnect={onConnect} />);
    const input = screen.getByPlaceholderText(/type to search/i);
    await user.type(input, "db");
    await user.keyboard("{Enter}");
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }));
  });
});
