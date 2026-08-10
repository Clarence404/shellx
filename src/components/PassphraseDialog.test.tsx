import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PassphraseDialog } from "./PassphraseDialog";

describe("PassphraseDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <PassphraseDialog open={false} keyName="id_ed25519" attempt={1} error={null}
        onSubmit={() => {}} onCancel={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("submits with remember flag", () => {
    const onSubmit = vi.fn();
    render(<PassphraseDialog open keyName="id_ed25519" attempt={1} error={null}
      onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: /解锁并连接/ }));
    expect(onSubmit).toHaveBeenCalledWith("s3cret", true);
  });

  it("shows retry counter and error styling on attempt 2", () => {
    render(<PassphraseDialog open keyName="id_ed25519" attempt={2}
      error="passphrase 不正确，请重新输入" onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/2\/3/)).toBeInTheDocument();
    expect(screen.getByText(/不正确/)).toBeInTheDocument();
  });

  it("cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(<PassphraseDialog open keyName="id_ed25519" attempt={1} error={null}
      onSubmit={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("Escape calls onCancel", () => {
    const onCancel = vi.fn();
    render(<PassphraseDialog open keyName="id_ed25519" attempt={1} error={null}
      onSubmit={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("Enter submits current value", () => {
    const onSubmit = vi.fn();
    render(<PassphraseDialog open keyName="id_ed25519" attempt={1} error={null}
      onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: "mypassword" } });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("mypassword", true);
  });

  it("remember checkbox defaults to checked and can be toggled", () => {
    const onSubmit = vi.fn();
    render(<PassphraseDialog open keyName="id_ed25519" attempt={1} error={null}
      onSubmit={onSubmit} onCancel={() => {}} />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /解锁并连接/ }));
    expect(onSubmit).toHaveBeenCalledWith("", false);
  });
});
