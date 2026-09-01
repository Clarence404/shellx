import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SnippetPalette } from "./SnippetPalette";
import { useSnippetsStore } from "../state/snippets";
import { useSessions } from "../state/sessions";

vi.mock("../ipc/snippets", () => ({
  snippetList: vi.fn().mockResolvedValue([]),
  snippetSave: vi.fn(),
  snippetUpdate: vi.fn().mockResolvedValue(undefined),
  snippetDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ipc/commands", () => ({
  writeSessionInput: vi.fn().mockResolvedValue(undefined),
}));
import { writeSessionInput } from "../ipc/commands";
import * as ipc from "../ipc/snippets";

const bytes = (s: string) => Array.from(new TextEncoder().encode(s));

function snippet(over: Partial<import("../types/snippets").Snippet> = {}) {
  return {
    id: "s1", name: "查磁盘", command: "df -h | grep -v tmpfs",
    autoEnter: false, sortOrder: 0, createdAt: 0,
    ...over,
  };
}

describe("SnippetPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSnippetsStore.setState({ list: [], loaded: true });
    useSessions.setState({
      sessions: [{ id: "sess1", label: "vm", kind: "ssh", host_id: null, state: "active" } as never],
      activeId: "sess1",
    });
  });
  afterEach(cleanup);

  it("filters by name or command and Enter sends the command, unexecuted", async () => {
    const user = userEvent.setup();
    useSnippetsStore.setState({ list: [
      snippet(),
      snippet({ id: "s2", name: "看日志", command: "tail -f /var/log/nginx/error.log" }),
    ] });
    const onClose = vi.fn();
    render(<SnippetPalette open onClose={onClose} />);

    await user.type(screen.getByPlaceholderText("Type to filter snippets…"), "磁盘");
    expect(screen.queryByText("看日志")).toBeNull();
    await user.keyboard("{Enter}");
    // No trailing \r: the user reads it before running it.
    expect(writeSessionInput).toHaveBeenCalledWith("sess1", bytes("df -h | grep -v tmpfs"));
    expect(onClose).toHaveBeenCalled();
  });

  it("a snippet marked auto-enter runs on pick", async () => {
    const user = userEvent.setup();
    useSnippetsStore.setState({ list: [snippet({ autoEnter: true })] });
    render(<SnippetPalette open onClose={() => {}} />);
    await user.click(screen.getByText("查磁盘"));
    expect(writeSessionInput).toHaveBeenCalledWith("sess1", bytes("df -h | grep -v tmpfs\r"));
  });

  it("a snippet with blanks asks for them and previews the result", async () => {
    const user = userEvent.setup();
    useSnippetsStore.setState({ list: [
      snippet({ id: "s3", name: "重启服务", command: "systemctl restart ${svc}" }),
    ] });
    render(<SnippetPalette open onClose={() => {}} />);
    await user.click(screen.getByText("重启服务"));

    await user.type(screen.getByLabelText("svc"), "nginx");
    expect(screen.getByText("systemctl restart nginx")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Insert" }));
    expect(writeSessionInput).toHaveBeenCalledWith("sess1", bytes("systemctl restart nginx"));
  });

  it("without an active terminal it says so instead of sending nowhere", async () => {
    const user = userEvent.setup();
    useSessions.setState({ sessions: [], activeId: null });
    useSnippetsStore.setState({ list: [snippet()] });
    render(<SnippetPalette open onClose={() => {}} />);
    expect(screen.getByText(/No active terminal/)).toBeInTheDocument();
    await user.click(screen.getByText("查磁盘"));
    expect(writeSessionInput).not.toHaveBeenCalled();
  });

  it("manage mode saves a new snippet", async () => {
    const user = userEvent.setup();
    (ipc.snippetSave as ReturnType<typeof vi.fn>).mockResolvedValue(
      snippet({ id: "new1", name: "n", command: "c", autoEnter: true }),
    );
    render(<SnippetPalette open onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Manage snippets" }));
    await user.click(screen.getByRole("button", { name: "New snippet" }));
    await user.type(screen.getByLabelText("Snippet name"), "n");
    await user.type(screen.getByLabelText("Snippet command"), "c");
    await user.click(screen.getByLabelText(/Press Enter automatically/));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(ipc.snippetSave).toHaveBeenCalledWith({ name: "n", command: "c", autoEnter: true }));
    expect(useSnippetsStore.getState().list.some((s) => s.id === "new1")).toBe(true);
  });

  it("manage mode deletes", async () => {
    const user = userEvent.setup();
    useSnippetsStore.setState({ list: [snippet()] });
    render(<SnippetPalette open onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Manage snippets" }));
    await user.click(screen.getByRole("button", { name: "Delete 查磁盘" }));
    await waitFor(() => expect(ipc.snippetDelete).toHaveBeenCalledWith("s1"));
    expect(useSnippetsStore.getState().list).toHaveLength(0);
  });
});
