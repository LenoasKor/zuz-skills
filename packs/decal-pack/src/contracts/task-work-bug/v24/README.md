# zuz ITS LAN pairing trust contract v24

v24 fixes two weaknesses of the v19 and v23 pairing client and keeps the v19 network wire format, so a v24 client works
with an older authority (v19, v23, and Decal's own v21) and an older client works with a v24 authority. Published v1-v20,
v22 and v23 bytes are unchanged. The flow, commands and exit codes of the v19 README still apply except as stated here.

## What was wrong

1. `pair` took the first device that answered discovery. The project id is not secret, so another device on the network
   could answer first and approve itself. The approval tag proved nothing, because it is computed from the session
   shared with that same device. The client stored the key and reported `paired` with no card on the real main device.
2. On macOS and Linux the key file was written with a mode that applies only on creation, through symbolic links and
   not atomically; nothing checked it on read; and `.decal/its-lan-client.json` could be committed by accident.

## Pairing on the second device

```sh
node contracts/task-work-bug/v24/lan-client.mjs pair --root . --label "Windows PC"
# {"status":"pending","sas":"123 456",...}                     the main device should now show a card with this code
# {"status":"awaiting_local_confirmation","sas":"123 456",...}  exit code 5; not paired yet

node contracts/task-work-bug/v24/lan-client.mjs pair-confirm --root . --sas "123 456"   # {"status":"paired",...}
node contracts/task-work-bug/v24/lan-client.mjs pair-cancel --root .                    # no card, or a different code
```

**The meaning of `pair-confirm`: the user saw this same code on the main device's approval card.** It is not "the client
printed this code". Before running it, an agent asks the user what the main device showed. If no card appeared, or the
code differs, run `pair-cancel`.

- More than one answer: `pair` stops with `authority_ambiguous` and lists every answer. Ask the user which is the main
  device, then use `--authority HOST:PORT`, which must be an address and port that answered (`authority_not_answered`
  otherwise). Answers are told apart by address and port. Labels are self-declared, so they never merge two answers.
  One main device with two network interfaces therefore also stops here; that is the intended safe result.
- Pending state: the approved result is kept in `.decal/its-lan-client.pending.json` for ten minutes
  (`DECAL_ITS_PAIR_CONFIRM_TTL_MS`). `check_code_mismatch` keeps it for a retyped code, five wrong codes remove it, and
  after expiry `pair-confirm` answers `pending_pairing_expired` and removes it. When the main device approved a request
  that is then cancelled or expires, revoke that device there; the wire format has no way to withdraw it.
- Nothing uses a pending pairing. `register` refuses with `pairing_awaiting_local_confirmation`, `flush` answers
  `not_paired`, and `contracts/task-work-bug/its-register.mjs` stops with `pairing_required` while it is live, whether
  or not an authority answers at that moment. It does not register locally, because an authority was just seen.
- An existing pairing stays active until `pair-confirm` replaces it, and a pairing made by an older contract keeps
  working without pairing again.

## What this does and does not prove

The check code authenticates the pairing only when a person compares it with the main device. Nothing in code can stop
an AI from passing the code the client printed. `.decal/its-lan-client.pending.json` holds the code as well. The guard
is the documented step in which the user confirms the code from the main device. The separate step makes that decision
visible and stops silent activation; it does not replace the decision.

Other limits:

- A paired authority is trusted. `applyBundle` merges what it sends into the client's main, and has no path allow-list
  because the authority's main legitimately carries other commits. Pair only with a device you control.
- A rogue device that is the only one answering causes no ambiguity. Only the card check catches it.
- Discovery and pairing requests are not encrypted and an answer can arrive after the two-second window.

## Storage on macOS and Linux

`authority-storage.mjs` replaces `readJson` and `writePrivateJson`, and the v24 authority and client use it for every
file. Windows keeps the owner-only DACL route of v22 and v23.

- Writing: a missing directory is created 0700. The file is written to an exclusive no-follow temporary file with mode
  0600, synced, and renamed over the target atomically. A target or parent that is a symbolic link is refused.
- Reading: the file is opened no-follow and checked through the open descriptor. It is refused
  (`unsafe_private_storage`) when it is a link, has another owner or other hard links, or has any group or other bit
  set. The refusal says to run `chmod 600`. Older 0600 files load unchanged.
- Existing directories with wider permissions: the device home (`~/.decal/its-authority`, or `DECAL_ITS_HOME`) belongs to
  this tool and is tightened to 0700 on the next write, but never when it is the user's home or `/`. A project's `.decal`
  is the user's directory and may hold other tools' files, so it is never changed. A common 0755 or group-writable
  `.decal` is accepted, because the checks on the file itself protect the key there: others cannot read a 0600 file, and
  a replaced file fails the owner check. A world-writable directory, a link, or one owned by someone else is refused.

## Windows files made before the DACL check

A `.decal/its-lan-client.json` written before v23 has an inherited ACL. v23 refuses it with `unsafe_private_storage`, so
the paired device is stuck. v24 migrates it when the DACL is its only fault: a regular file, not a link, one hard link,
realpath equal to the expected path, owned by the current user, and valid JSON with the client schema. It is rewritten
through the private directory and atomic rename route, verified with `assertPrivate`, and the result of that command
carries `migrated: true` and a note. The key is never printed. A file with another owner, including one owned by the
Administrators group after an elevated run, or a link, a hard link, malformed content or the wrong schema still fails
with `unsafe_private_storage` and is left untouched.

**The old key may have been readable by other accounts under the old ACL. Migration only stops further exposure; it does
not undo any earlier one. Revoking the device on the main device and pairing again is the stronger option.**

The authority's `lan-authority.json` gets the same migration with its own schema, because it holds the device list and
cannot be regenerated, and an authority that cannot start strands every paired device. The same warning applies to its
device keys and admin token, which are not rotated automatically. `lan-admin.json` is not migrated: `serve` replaces it at
start-up without reading it, so restarting the authority fixes it. Old outbox entries are not migrated and still refuse.

## Keeping the key out of Git

Before a key is written, `pair` and `pair-confirm` add the exact paths of the pending and active files to the
repository's local exclude file, resolved with `git rev-parse --git-path info/exclude` so linked worktrees work. No
tracked `.gitignore` is touched. `client_key_tracked` refuses pairing when either path is already tracked, and
`client_key_not_excluded` refuses it when a `.gitignore` rule re-includes the path. A pairing made by an older contract
gets the exclude entry on its next use, and `status` reports `keyTrackedByGit`. Files with other names under `.decal`,
such as the outbox, are not covered, and `git add -f` is not prevented.

## Not included

No push, merge to a remote, deploy, lifecycle completion, version settlement, other repository, or connection outside
the local network. Decal's native pairing flow keeps its own v21 client until that repository adopts this contract.
