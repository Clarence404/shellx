import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ReleaseNotes } from "./ReleaseNotes";

const SAMPLE = `# v0.33.2

Two terminal input fixes: pasting a multi-line file no longer mangles indentation.

- **Paste no longer staircases indentation.** Editors ask for a marker; shellx sends it.
- **Command suggestions work again.** Click and Enter both just fill in the line.
---

> Installers below are unsigned.`;

describe("ReleaseNotes", () => {
  it("drops the title heading and the footer, keeping the TL;DR paragraph and bullets", () => {
    render(<ReleaseNotes text={SAMPLE} />);
    expect(screen.queryByText(/v0\.33\.2/)).not.toBeInTheDocument();
    expect(screen.getByText(/pasting a multi-line file/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/Installers below are unsigned/)).not.toBeInTheDocument();
  });

  it("renders **bold** spans as real <strong> elements", () => {
    render(<ReleaseNotes text={SAMPLE} />);
    const strong = screen.getByText("Paste no longer staircases indentation.");
    expect(strong.tagName).toBe("STRONG");
  });

  it("handles a body with no bullets at all", () => {
    render(<ReleaseNotes text={"# v1.0.0\n\nJust a paragraph, no list."} />);
    expect(screen.getByText("Just a paragraph, no list.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
