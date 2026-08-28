# Transfer view — SFTP / FTP / FTPS

A rail view of its own, with its own connection list and a WinSCP-style
dual pane. Browsing and transferring by hand — no polling, no auto-pull.

Motivating case: customer production lines that report data over plain
FTP. Those machines are old, they are on a factory network, and their
filenames are very likely GBK. SFTP is here too because a file-transfer
page that cannot speak the one protocol shellx is best at would be an
odd thing to build.

Working name for the rail item is "Transfer". Calling it FTP while it
speaks SFTP — the only encrypted one of the three — would need
explaining forever.

## Decisions

**Its own rail item, not a protocol field on saved hosts.** A saved host
is an SSH machine with a terminal, tunnels and a monitor. A connection
here is a file endpoint and nothing else. Folding them together would
mean a host form that swaps half its fields and four activity tabs that
come and go.

**Its own table, `transfer_hosts`, with a `protocol` column** —
`sftp` | `ftp` | `ftps`. No migration on `hosts`, no branching in any
existing SSH path.

**An SFTP connection here is a separate record from the saved SSH host,
even for the same machine.** The two can then have their own names and
their own default directories, and neither list surprises the other when
a row is deleted. The cost — one machine's address maintained in two
places — is accepted deliberately; the alternative makes "delete this
row" ambiguous, which is worse. An import-from-saved-hosts flow (the
same checkbox preview the ssh-config import uses) keeps the retyping
down.

**suppaftp, on `tokio` + `tokio-rustls-ring`.** Verified below.

**Never `list()` or `mlsd()`.** See Encoding.

## SFTP costs almost nothing here

The twelve `sftp_*` commands already take a session id and work against
`SessionManager`. All this page needs is a session with no shell — the
transport and the SFTP subsystem, nothing else. `open_connection`
already has the shape for it (`tunnels_only` opens a transport without a
shell); this adds a files-only path that opens no tab.

So the frontend picks the command family from the connection's protocol
— `sftp_*` or `ftp_*` — and everything downstream is shared.

## The FTP client

New module `src-tauri/src/ftp/`:

- `client.rs` — one live connection: connect, auth, TLS upgrade, cwd,
  raw-byte listing, retr/stor streams.
- `listing.rs` — pure, unit-tested: parse MLSD lines, POSIX `LIST` lines,
  and DOS/IIS `LIST` lines into the same `Entry` the SFTP side returns.
- `charset.rs` — pure, unit-tested: bytes ↔ String for `utf8` / `gbk` /
  `auto`.
- `manager.rs` — live connections keyed by session id, the shape
  `SessionManager` has for SSH.

### Encoding — the one real landmine

FTP has no defined charset for filenames. A production-line box in China
is likely to speak GBK.

**suppaftp's `list()` and `mlsd()` decode the data channel with
`String::from_utf8_lossy`** (`async_ftp/tokio_ftp.rs:867`). A GBK
filename becomes U+FFFD before it reaches our code, and the bytes are
gone for good.

The way through: `custom_data_command()` is public and returns the raw
`DataStream`. We send `MLSD` / `LIST` ourselves, read bytes, and decode
with `encoding_rs`. Paths going out are encoded back before they hit the
control channel.

A rule, not a preference: **nothing in `ftp/` may call `list()` or
`mlsd()`.**

Per connection: `auto` (UTF-8, falling back to GBK on invalid
sequences), `utf8`, or `gbk`. `auto` is the default; the manual lock
exists because GBK bytes are occasionally valid UTF-8, and on that file
auto guesses wrong.

SFTP has neither setting — the protocol fixes filenames as UTF-8. The
form drops the field rather than disabling it.

### Listing

`MLSD` first: defined grammar, real types and timestamps. On `500`/`502`
fall back to `LIST` and try the POSIX parser, then the DOS one. The
winning path is remembered per connection.

Parse failures degrade per line — an unparseable line becomes a name
with no metadata, never a failed listing.

### Connection

Passive (PASV/EPSV) by default, with an active-mode toggle for boxes
that only do PORT. FTPS is explicit (`AUTH TLS`, port 21) by default,
implicit (990) by choice; the two cannot be told apart reliably, so a
failed handshake says which one to try instead of surfacing a TLS error.

Plain FTP sends the password and every byte in the clear. The form says
so under the protocol switch, and the connection row and remote pane
both carry a `plaintext` tag. It is not blocked — the factory case is
real — but nobody should have to remember it.

## IPC

`ftp_connect`, `ftp_disconnect`, `ftp_list_dir`, `ftp_mkdir`,
`ftp_rename`, `ftp_remove_file`, `ftp_remove_dir`, `ftp_download`,
`ftp_upload`, `ftp_download_dir`, `ftp_upload_dir`, plus
`transfer_host_*` CRUD mirroring `ipc/hosts.rs`.

Transfers go through the existing `TransferManager`: same queue,
concurrency limit, progress events, pause / resume / cancel.
`resume_transfer(offset)` covers restart-at-offset; a server that
refuses `REST` reports "cannot resume" rather than silently restarting.

Passwords go to the same keychain under a `transfer:{id}` account.

## Frontend

- `railView` gains `"transfer"`, between Files and Tunnels.
- `TransferView` — drawer (connections) + `LocalPane` | `PaneSplitter` |
  remote pane + `TransferStripSection`. Only the remote pane is new.
- `TransferHostForm` — one form, protocol-driven: the protocol switch
  reshapes what is below it.
- Reuses `state/hostSelection.ts` unchanged — it is pure and keyed by
  id, so Ctrl/Shift multi-select and batch delete come free.
- The remote pane's path bar carries the tags that explain nine out of
  ten FTP problems: charset, transfer mode, and plaintext-or-encrypted.
  SFTP shows only `encrypted`.

## Milestones

Each ends somewhere the app can be opened and judged.

1. **Connect and browse.** FTP module, charset, listing parsers,
   `ftp_connect` / `ftp_list_dir`, rail item, drawer, form, remote pane.
   Plain FTP only.
2. **SFTP in the same page.** Files-only session, protocol dispatch,
   import-from-saved-hosts.
3. **Move files.** Download and upload, single and directory, on the
   existing transfer queue, with resume.
4. **The rest.** mkdir / rename / delete, FTPS both modes, active mode,
   charset override, plaintext tags, config-bundle block.

## Not in scope

Polling or auto-pull on a schedule. SCP, WebDAV, S3. FTP through a
proxy.

## Verified before writing this

On this Windows box, 2026-08-28, against suppaftp 10.0.2:

- Features `tokio` + `tokio-rustls-ring` exist and compile. No
  `aws-lc-rs` in the tree, so the NASM problem that pinned russh to
  `ring` does not come back.
- It resolves to `ring` 0.17.14 and `rustls` 0.23.43 — the versions
  shellx already builds. One crypto stack, not two.
- `custom_data_command` is public and returns the raw `DataStream`,
  which is what makes the encoding rule above possible.
- `resume_transfer(offset)`, `retr_as_stream`, `put_with_stream`,
  `append_with_stream`, `active_mode` / `set_mode`,
  `connect_secure_implicit` and `into_secure` are all present.
