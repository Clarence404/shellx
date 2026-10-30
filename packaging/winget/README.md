# winget manifests

Manifests for submitting ShellX to the Windows Package Manager community
repository, so `winget install Clarence404.ShellX` works.

These files are kept here because every release needs a new copy of them
with fresh URLs and hashes; starting from the previous version is quicker
than writing them again.

## Submitting a release

winget manifests live in [microsoft/winget-pkgs][repo], one folder per
version. They cannot be pushed from here — the submission is a pull
request from your own fork.

1. Fork and clone [microsoft/winget-pkgs][repo].
2. Copy this version's folder into place, keeping the layout:

   ```
   manifests/c/Clarence404/ShellX/<version>/
   ```

3. Validate and test-install locally (winget 1.6 or newer):

   ```
   winget validate --manifest manifests/c/Clarence404/ShellX/<version>
   winget install --manifest manifests/c/Clarence404/ShellX/<version>
   ```

4. Commit on a branch named for the version, push to your fork, and open
   a PR against `microsoft/winget-pkgs`. A bot runs the same validation
   and installs the package in a sandbox; a human reviews after it passes.

[repo]: https://github.com/microsoft/winget-pkgs

## Current version

`1.0.1/` is the version to submit. Earlier folders are kept so the next
one can start from a known-good copy; winget only ever needs the newest.

## Preparing the next version

Everything except the two hashes carries over. For the hashes:

```bash
V=1.2.3
for f in ShellX_${V}_x64-setup.exe ShellX_${V}_x64_en-US.msi; do
  curl -sL -o "$f" "https://github.com/Clarence404/shellx/releases/download/v${V}/$f"
  sha256sum "$f" | cut -d' ' -f1 | tr 'a-f' 'A-F'
done
```

Then update `PackageVersion` (three files), `ReleaseDate`,
`ReleaseNotesUrl`, both `InstallerUrl`s and both `InstallerSha256`s.

## What to expect on the first submission

- **The installers are unsigned.** The review bot installs in a sandbox
  and may flag SmartScreen prompts. This does not block publication, but
  the first PR for a new package usually gets a human reviewer and can
  take a few days.
- **The package identifier is permanent.** `Clarence404.ShellX` is what
  users will type; renaming it later means publishing a new package.
- **Scope.** The NSIS installer is per-user (Tauri's default, installs to
  `%LOCALAPPDATA%\ShellX`); the MSI is per-machine. Both are listed, so
  winget picks by the user's `--scope`.
