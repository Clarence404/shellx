import type { CSSProperties } from "react";

/**
 * Renders the markdown subset our own `docs/release-notes/*.md` files use
 * (see CLAUDE.md's "Release notes stay concise") — a `# vX.Y.Z` title, a
 * TL;DR paragraph, then a `- **bold lead.** rest of sentence` bullet list —
 * plus the standing `---`-separated footer every release note gets appended
 * (the unsigned-installer notice). Not a general markdown parser: this is
 * exactly the shape our own generator produces, nothing more.
 *
 * The title is dropped (the version already shows next to it in every
 * caller) and so is the footer (a standing notice, not a feature).
 */
export function ReleaseNotes({ text }: { text: string }) {
  const body = text.split(/\n---\n/)[0];
  const bullets: string[] = [];
  const paragraphs: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("# ")) continue;
    if (line.startsWith("- ")) bullets.push(line.slice(2));
    else paragraphs.push(line);
  }

  const pStyle: CSSProperties = { margin: "0 0 8px", lineHeight: 1.5 };
  return (
    <div>
      {paragraphs.map((p, i) => <p key={i} style={pStyle}>{renderInline(p)}</p>)}
      {bullets.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {bullets.map((b, i) => <li key={i} style={{ lineHeight: 1.5 }}>{renderInline(b)}</li>)}
        </ul>
      )}
    </div>
  );
}

/** `**bold**` spans only — the only inline markup our release notes use. */
function renderInline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}
