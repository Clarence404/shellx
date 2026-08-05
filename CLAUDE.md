# CLAUDE.md — repo-scoped Claude Code instructions

Standing rules for anyone (Claude, another agent, or a human) working on this repo. Read once at task start; skim on later turns.

## Bilingual README

Every user-facing documentation change MUST land in both language files, in the same commit:

- `README.md` — English (canonical / default)
- `README.zh-CN.md` — 简体中文

Both files carry a language switcher on line 3:

- In `README.md`: `**English** · [简体中文](./README.zh-CN.md)`
- In `README.zh-CN.md`: `[English](./README.md) · **简体中文**`

**When a section changes:** update BOTH files. Never let them drift — if the English README learns a new feature or a new command, the Chinese README learns the same thing in the same PR. Section order and headings mirror each other so a reader can eyeball whether they're in sync.

**When adding a new top-level section** (e.g. a Migration guide): add it to both files. Do not create English-only or Chinese-only sections.

**Style:** the Chinese README is a genuine translation, not a machine dump. Keep code blocks, CLI commands, file paths, package names, and error strings identical across both files — those are not translated. Prose is translated; jargon that has a natural Chinese form (e.g. "标签页" for "tabs", "抽屉" for "drawer") uses it, jargon that doesn't (e.g. "trait", "toolchain") stays in English.

**Future extra languages:** same pattern — `README.<locale>.md`, add a chip to every existing README's language switcher line, keep in sync.

## Release notes flow

`.github/workflows/release.yml` auto-injects `docs/release-notes/<TAG>.md` into the GitHub Release body when a `v*` tag is pushed. For every release, the last commit before the tag must include a new file `docs/release-notes/vX.Y.Z.md` covering that version. CI falls back to a placeholder if the file is missing, but do not rely on that.

## Version fields

Version lives in three files, keep them in lockstep:

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package].version`
- `src-tauri/tauri.conf.json` → `version`

Bump all three in the same commit as the release notes.
