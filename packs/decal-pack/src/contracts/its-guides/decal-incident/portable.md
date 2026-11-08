## Portable writer

Outside Decal, register through the stable entry `contracts/task-work-bug/its-register.mjs`, which resolves the `register-incident` capability (the Incident-only main-authority profile) and validates its manifest and dependencies before running it; never name a contract version yourself. It preserves the v9 semantic intent while allowing a
linked feature or detached worktree to request registration. First preview the semantic candidate; the final `INC-<number>`
identity remains pending until the authorized writer runs:

```sh
node contracts/task-work-bug/its-register.mjs --kind ticket \
  --root . --intent /path/to/approved-intent.json --dry-run
```

Only after applicable user authority or explicit repository automatic policy authorizes that exact scope, write the same intent with the returned digest. The digest binds the same authorized semantic intent; it is not evidence of a human click or a new permission grant:

```sh
node contracts/task-work-bug/its-register.mjs --kind ticket \
  --root . --intent /path/to/approved-intent.json \
  --approved-digest sha256:<dry-run digest> --write
```

The broker resolves an allowed `origin/HEAD` or one unambiguous local `main`/`master`, then locates the one
existing worktree that owns that branch and allocates the Incident there under the shared repository lock.
It never changes the caller's branch or worktree. Missing, ambiguous, mismatched, or changing authority is
rejected. The approval includes only that exact registration commit, not push, merge, deploy, lifecycle
completion, or settlement.

For external portable lifecycle changes, prefer `contracts/zuz-its/v5/transition-incident.mjs` after validating its installed manifest and approved Pack receipt. Repository lifecycle engines stay canonical: use their supported Incident command instead of bypassing them with a direct packaged writer. If neither the v5 writer nor a compatible approved repository engine is available, fail-closed for mutation and report the required update; the old v3 writer is not a direct mutation fallback. Keep v3 identity, schema, padded aliases and read compatibility. The normal flow remains `new → confirmed → in_progress → development_complete → release_ready → closed`; completion requires recovery time and evidence, and resolved closure requires completed recovery evidence.

A packaged candidate profile does not advertise or authorize a Native capability. In a Decal-owned session, never invoke the external transition writer: use only its advertised Native lifecycle capability, and preserve a blocked request when that capability is missing or rejected. External Codex, Claude, Gemini and ACP sessions may use the validated portable profile within actual user or repository authority. This transition permission does not include Git commit, release/version settlement, publishing or installation.
