import type { Language } from "../i18n";

/** Separates the English half of a manifest's `notes` from the Chinese
 *  one. Written by `scripts/inject-update-notes.mjs`; the two must match. */
export const ZH_MARKER = "<!--shellx:zh-CN-->";

/**
 * Pick the half of a release's notes that matches the UI language.
 *
 * Releases before v0.36.1 shipped English only and have no marker, so
 * those notes are returned whole whichever language is set — showing the
 * English text beats showing nothing. A release whose translation was
 * missing at build time behaves the same way.
 */
export function notesForLanguage(notes: string | null | undefined, lang: Language): string {
  if (!notes) return "";
  const at = notes.indexOf(ZH_MARKER);
  if (at === -1) return notes.trim();
  const en = notes.slice(0, at).trim();
  const zh = notes.slice(at + ZH_MARKER.length).trim();
  if (lang === "zh") return zh || en;
  return en || zh;
}
