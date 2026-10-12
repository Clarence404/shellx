// Puts a release's notes into the updater manifest (latest.json).
//
// tauri-action uploads latest.json with an EMPTY `notes` field — it does not
// copy the Release body into it — so the app's "what's new" dialog (which
// shows `Update.body`, i.e. this field) had nothing to display. The release
// workflow runs this after every platform job has finished writing the
// manifest, so the notes come from the same docs/release-notes/<tag>.md files
// the GitHub Release page is built from.
//
//   node scripts/inject-update-notes.mjs <latest.json> <notes.md> [<notes.zh-CN.md>]
//
// Both languages travel in the one `notes` string, separated by a marker
// line: the updater manifest schema has a single notes field, and adding a
// second one risks a stricter deserializer rejecting the whole manifest. The
// app splits on the marker and shows the half matching its UI language.
//
// A missing notes file leaves that half empty rather than failing the release.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Separates the English half from the Chinese one. An HTML comment, so a
 *  manifest read by anything that renders markdown degrades to "both
 *  languages, English first" rather than showing a stray delimiter. */
export const ZH_MARKER = "<!--shellx:zh-CN-->";

function tidy(s) {
  return (s ?? "").replace(/\r\n/g, "\n").trim();
}

/** Returns the manifest with `notes` set; everything else is untouched — in
 *  particular the per-platform signatures, which cover the installers, not
 *  this file. With no Chinese half, `notes` is exactly the English text, the
 *  way it was before translations existed. */
export function injectNotes(manifest, notes, notesZh) {
  const en = tidy(notes);
  const zh = tidy(notesZh);
  return { ...manifest, notes: zh ? `${en}\n\n${ZH_MARKER}\n${zh}` : en };
}

function read(path, label) {
  if (existsSync(path)) return readFileSync(path, "utf8");
  console.warn(`::warning::${path} not found — leaving the ${label} notes empty`);
  return "";
}

function main(argv) {
  const [manifestPath, notesPath, notesZhPath] = argv;
  if (!manifestPath || !notesPath) {
    console.error("usage: inject-update-notes.mjs <latest.json> <notes.md> [<notes.zh-CN.md>]");
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const en = read(notesPath, "English");
  const zh = notesZhPath ? read(notesZhPath, "Chinese") : "";
  // A translation with nothing to translate means the arguments are wrong.
  // This shipped once: a YAML line continuation that bash read as a literal
  // argument, shifting every path by one. Fail loudly — the rest of the
  // release is already published, and only this manifest is at stake.
  if (!tidy(en) && tidy(zh)) {
    console.error("::error::English notes are empty but Chinese notes are not — check the argument order");
    return 1;
  }
  const out = injectNotes(manifest, en, zh);
  writeFileSync(manifestPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`notes for ${out.version}: ${out.notes.length} chars`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
