import { COMMON_COMMANDS } from "./commonCommands";

/** One dropdown row: the full candidate text and where it came from —
 *  `h` is the locally recorded history, `c` the bundled command
 *  dictionary. The badge in the list says which. */
export interface Candidate {
  text: string;
  source: "h" | "c";
}

export const MAX_CANDIDATES = 8;

/**
 * Merges the two sources for one input line. History first — it knows
 * how YOU use a command, flags and all — then dictionary names that
 * still match and aren't already covered. Everything is a strict
 * prefix match, nothing equals the line itself (completing to what is
 * already typed helps nobody), and the whole list caps at eight rows.
 */
export function mergeCandidates(line: string, history: string[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const h of history) {
    if (!h.startsWith(line) || h === line || seen.has(h)) continue;
    seen.add(h);
    out.push({ text: h, source: "h" });
    if (out.length >= MAX_CANDIDATES) return out;
  }
  // Dictionary names only make sense while the first word is being
  // typed — `docker lo` should offer history, not the command list.
  if (!line.includes(" ")) {
    for (const c of COMMON_COMMANDS) {
      if (!c.startsWith(line) || c === line || seen.has(c)) continue;
      seen.add(c);
      out.push({ text: c, source: "c" });
      if (out.length >= MAX_CANDIDATES) return out;
    }
  }
  return out;
}
