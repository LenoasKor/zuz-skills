# zuz ITS v4 — Incident transition preservation

This additive, unpublished contract preserves published v1–v3 bytes. It replaces
only the external-host Incident transition writer. Registration, Git commits,
release/version settlement, publishing and installation remain separate actions.

Invoke `node contracts/zuz-its/v4/transition-incident.mjs --root /absolute/project
--id INC-7 --status confirmed --expected-source-revision sha256:CURRENT_REVISION`.
The existing v3 forward/blocked/recovery/completion/closure arguments and padded
aliases remain supported. No Git repository or new settlement profile is required.
Presence of `DECAL_SESSION_ID`, including an empty value, rejects the external
writer with `native_authority_required` before locking or writing.

The writer validates this package and its pinned immutable dependencies, requires
a canonical root, and reuses v9's `.decal-slice-completion.lock`. While holding the
lock it resolves the existing physical alias, rejects unsafe targets and validates
every required canonical header field before the v3 parser sees header-only input.
Missing/duplicate header fields cannot be supplied by body examples. Unknown
fields, ID, createdAt, schema, body, newline style and file permission mode remain
unchanged outside the existing transition blocks.

After writing and syncing a private temporary file, it rechecks source bytes,
revision, file identity and mode immediately before rename. A detected edit
rejects with `stale_source_revision`, removes only its own temporary, preserves
the edited record and releases its owned lock. Cooperative concurrent calls use
the same lock and stale requests fail instead of reverting another transition.
Malformed/live/dead-owner existing locks are never silently removed: the inherited
bounded acquisition fails and the existing lock is preserved for explicit recovery.

This final check is not an OS-level compare-and-swap. A noncooperative process
that writes after the final comparison and before rename can still race. It does
not isolate malicious local filesystem actors, authenticate editable checksum
lists, run tests itself or guarantee all OS/provider environments. Authenticity
requires the approved signed Pack and installation receipt; run the separate
fixture tests and `node contracts/zuz-its/v4/verify-contract.mjs` for verification.
