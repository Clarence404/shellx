# CLAUDE.md — repo-scoped Claude Code instructions

Standing rules for anyone (Claude, another agent, or a human) working on this repo. Read once at task start; skim on later turns.

## Feature-branch workflow — new work does NOT land on `main` directly

**The invariant, in one line: new feature / code change → new branch → user visually verifies and explicitly confirms → merge into `main` → then release.** No step may be skipped or reordered — in particular, merging into `main` before the user's confirmation, or tagging before the merge, is never allowed.

**Every new feature, bug fix, or non-trivial change starts on its own branch.** `main` is only touched via merge / fast-forward from a feature branch that the user has explicitly asked to land. Do not commit new work directly on `main` — even if the previous cycle committed there.

The flow is:

1. **Create a feature branch** at the start of the work. Name it after the feature (kebab-case): `feat/directory-transfer`, `fix/cancel-signal`, `polish/appearance-panel`. If the user's request implies a specific scope, use that scope name.
2. **Commit the work on that branch.** Multiple commits are fine.
3. **After the user has visually verified and explicitly approves** (see Ship gate below), merge into `main` — fast-forward if linear, `--no-ff` if the branch has multiple commits and the shape is worth preserving. Push `main` first, then the tag (see Ship gate).
4. **Do NOT delete the branch on your own.** Leave it for the user to garbage-collect.
5. Emergency hotfix directly on `main` is allowed ONLY if the user explicitly asks for it in so many words (e.g. "hotfix on main directly, no branch").

Branch hygiene: never force-push `main`. Never rebase a branch that has already been pushed. If a rebase / squash is needed, ask first.

## Ship gate — user verification before every tag

**Never version-bump, commit release notes, tag, or push a tag on your own.** After every substantive code change, hand the running app back to the user for visual verification and wait for their explicit approval before starting the release sequence.

**Approval is required per release**, not once per session. A user saying "发版" for v0.6.0 does NOT authorize an automatic v0.6.1 later in the same session. Each tag needs its own explicit "发版" / "打 tag" / equivalent — silence, approval-for-a-different-thing, or a topic-change message never count.

The flow is always:

1. **Land the code changes** — normally on a feature branch per the workflow above; on `main` only when the user has explicitly asked to work directly on `main`.
2. Confirm tests + tsc pass locally.
3. **Auto-launch Tauri** — after every batch of substantive code changes finishes and passes tests, launch `pnpm tauri:dev` yourself if it's not already running (via `Start-Process cmd.exe /c "pnpm tauri:dev"` if `pnpm` is broken in bash — see the corepack workaround note further below). Do not ask the user to launch it. Do not wait for the user to say "启动" or "run it". If a previous instance is still running, HMR delivers pure frontend changes for free — but Rust changes need a rebuild, and Tauri handles that automatically once the process is up. Point out what to look at in one or two sentences after launching.
4. **Stop and wait.** Do not proceed to tagging until the user gives explicit go-ahead (e.g. "打 tag", "发版", "OK", "看好了 → 发布"). Silence is not approval. A user message about a different topic is not approval. Approval for one release is not standing approval for future releases.
5. Only after explicit approval: merge the feature branch into `main` (fast-forward or `--no-ff` as appropriate), bump the three version fields (see below), write both release-notes files (see below), **update `README.md` + `README.zh-CN.md`** if the release adds or changes anything user-visible (features, screenshots, usage — per the Docs language policy the pair moves together), commit on `main`, tag, push. A release that ships a new feature but leaves the README stale is an incomplete release.

**Corepack workaround (this environment specifically):** `pnpm` via bash sometimes hits `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` from corepack partway through a session. When that happens, launch pnpm from `cmd.exe` instead — `Start-Process -FilePath "cmd.exe" -ArgumentList "/c","pnpm tauri:dev > `"$env:TEMP\tauri-out.log`" 2>&1" -WorkingDirectory "<repo>" -WindowStyle Hidden` reliably works. Poll for `Get-Process shellx` to know when the window is up.

**When in doubt about whether a change is release-worthy:** ask. Small polish edits during a longer conversation may be intended to stack up into one bigger release, not each become a tag. Never guess.

**What the user sees between changes:** the running app via HMR (see `pnpm tauri:dev`). Do not stand up separate demos, screenshots, or throwaway builds unless asked. If the dev process exited, restart it; if it can't restart (port in use, corepack broken, etc.), diagnose and fix — do not skip verification because "the previous instance probably still shows it".

## Docs language policy

- **`README.md` and `README.zh-CN.md` are a bilingual pair — kept in strict sync.** Any change to one lands together with the equivalent change to the other, in the same commit. Structure, section order, and headings mirror each other; only the prose language differs. Do not update just one and let the other drift.
- **`docs/**` and release notes ship in English only.** Do not create `.zh-CN.md` (or any other locale suffix) versions of files under `docs/` unless the user explicitly asks — existing translated files in the tree stay as history but no new ones are added and drift is fine going forward.

## Release notes stay concise

`docs/release-notes/vX.Y.Z.md` is for shellx **users**, not for the author of the commit. Aim for a scan-and-move-on read, not an engineering journal:

- **Open with a ≤60-word TL;DR paragraph** — what changed in this version, in one sitting.
- **Then 3-5 grouped bullets**, organized by user-visible feature (not by code module). Each bullet is one to two sentences.
- **Do not explain what used to be broken** or how it broke. Only state the current behavior. If the "why" is genuinely load-bearing history, it belongs in the fix commit's message, not in release notes.
- **Do not list Under-the-hood / refactor items** unless they change observable behavior or a public API. Chore-only refactors have no place here.
- Length ceiling: the whole file should be shorter than the PR's diffstat if you can help it. If you have more to say, cut.

## Release notes flow

`.github/workflows/release.yml` auto-injects release notes into the GitHub Release body when a `v*` tag is pushed. The workflow looks for one file per tag:

- `docs/release-notes/vX.Y.Z.md`

Behaviour:

- **File present** → contents used verbatim as the Release body.
- **File missing** → a placeholder ships and the build still succeeds; do not rely on this path.

**Rule for future releases:** ship this file in the commit that precedes the tag.

## Version fields

Version lives in three files, keep them in lockstep:

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package].version`
- `src-tauri/tauri.conf.json` → `version`

Bump all three in the same commit as the release notes.
