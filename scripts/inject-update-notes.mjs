// Puts a release's notes into the updater manifest (latest.json).
//
// tauri-action uploads latest.json with an EMPTY `notes` field — it does not
// copy the Release body into it — so the app's "what's new" card (which shows
// `Update.body`, i.e. this field) had nothing to display. The release
// workflow runs this after every platform job has finished writing the
// manifest, so the notes come from the same docs/release-notes/<tag>.md file
// the GitHub Release page is built from.
//
//   node scripts/inject-update-notes.mjs <latest.json> <notes.md>
//
// A missing notes file leaves `notes` empty rather than failing the release.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Returns the manifest with `notes` set; everything else is untouched —
 *  in particular the per-platform signatures, which cover the installers,
 *  not this file. */
export function injectNotes(manifest, notes) {
  return { ...manifest, notes: notes.replace(/\r\n/g, "\n").trim() };
}

function main(argv) {
  const [manifestPath, notesPath] = argv;
  if (!manifestPath || !notesPath) {
    console.error("usage: inject-update-notes.mjs <latest.json> <notes.md>");
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const haveNotes = existsSync(notesPath);
  if (!haveNotes) console.warn(`::warning::${notesPath} not found — leaving notes empty`);
  const out = injectNotes(manifest, haveNotes ? readFileSync(notesPath, "utf8") : "");
  writeFileSync(manifestPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`notes for ${out.version}: ${out.notes.length} chars`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
