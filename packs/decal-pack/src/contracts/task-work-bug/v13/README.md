# ITS scoped execution v13

Published v1-v12 bytes are immutable. Registration remains v10 and settlement v9/v11.
`task-body.mjs` appends factual evidence after target and registry-identity validation. It cannot change lifecycle, version metadata, summaries or completion receipts. Portable usage requires an explicit portable profile; repository engines use their own registered adapter. The v9 transaction still owns locking, exact commit and finalization.

`execution-policy.mjs` contains shared decisions; it is not an authority grant. A host supplies verified evidence. Only the current operation and its required guarantees gate that operation. Remote disposition is required/not-applicable/deferred alongside the existing parity token. Legacy missing disposition requires classification, never silent reclassification. Observation does not attest the newest build. Restart reuse preserves root, request, app, termination, preview, cost and permission scope. Verified main advance is allowed; foreign dirty sources are not. Waiting probes are read-only, capped at five minutes, and never replay an unknown mutation. Corrections require not-created and are limited to one.

New capabilities remain disabled until the implementing adapter advertises them. This package does not grant cross-project access, deployment, lifecycle or Native bypass authority.

## Portable owned text edits

Use `owned-edit-cli.mjs --root <canonical-root> --operation capture|apply|preview|commit|inspect --request <plain-json-file>`. Capture requires `relative`, `taskId` and an `ownerId`. Apply requires the returned token, ownerId, expectedSourceRevision, and a unique literal find/replace. The tool records the actual before/after bytes itself; submitting a diff afterwards is unsupported. Preview binds token, ownerId, message, verification and `independent: true`; commit requires the same input and `--approved-plan-digest` from preview, with applicable user/repository commit authority.

The initial support is a single tracked UTF-8 text file (up to 1 MiB), stable HEAD/branch, active Task revision, no staged changes to that file, and no commit hooks. Other staged files and unrelated edits remain intact. The host must evaluate semantic independence; a mechanical patch alone cannot establish it. The edit journal lives in Git-private storage with a local integrity seal. This detects altered workspace receipts, but is not a security boundary against the operating-system account that owns the repository. Native must bind its own session/lease/grant and must not invoke this external CLI.

Unknown/interrupted writes require inspect; applying/committing receipts are preserved and not blindly replayed. A successful commit receipt reuses the existing commit after checking its ancestry and target blob. Read-only inspection does not create storage or integrity keys. No lock deletion or other-session termination is a recovery path.
