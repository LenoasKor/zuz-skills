# Portable lifecycle and settlement — v8

This additive contract leaves published v1–v7 bytes unchanged. Use it only from
an approved, verified Decal Pack release and select a project profile explicitly.
Source code or local fixture success is not proof that a release has been signed,
published or installed. Release and consumer adoption evidence is recorded
separately; never replace an existing immutable archive under the same version.

## Implemented and tested

- Explicit project profile; no discovery of version paths or arbitrary hooks.
- Independent legacy `desktop`/`remote` impact channels map to named products.
  Those field names remain compatible with existing ITS records; they do not
  require a Decal Desktop/Remote product.
- JSON pointer versions (including both package-lock root versions), literal
  Cargo `[package].version`, named local Cargo.lock package, plain VERSION file.
  Unsupported/ambiguous formats are rejected; dependency versions are untouched.
- `engine: repository` delegates to the existing project engine and refuses a
  second portable bump. A profile is opt-in project configuration, not an
  installation default. Primer-managed consumers still require `skill_sync`.
- Already-closed standalone Work/Bug settlement: approved preview, patch or
  no-version result, exact Git commit, shared pending marker and finalization.
- Task lifecycle and completion, including one exact Task-batch transaction:
  Task minor first, then numeric Work IDs, then numeric Bug IDs. Normal Task
  completion requires checked criteria and evidence bound to the current HEAD/tree.
- Work/Bug normal forward lifecycle, required completion evidence and typed
  closure reasons, using the same lock and exact-commit transaction. Existing
  blocked/reopen records are not silently treated as normal forward transitions.
- Interrupted preparation can resume or roll back known before/after bytes.
  Unknown edits, live-owner locks and another engine's journal are preserved.
- The complete recovery journal must fit within 16 MiB, including before/after
  contents and JSON escaping. Oversized plans are rejected before any write;
  divide independent work into separately reviewed settlements instead of
  bypassing the limit or splitting an atomic Task-batch release.
- Separate Git roots, main/master, unrelated dirty preservation, concurrent
  calls, stale source/HEAD, staged changes, duplicate fields, symlinks and
  hardlinks are covered by disposable local fixtures.

## Explicit profile example (Showcase-shaped fixture, not installed)

Commit the project-approved `.decal/settlement-profile.json` with the actual
product version sources before using the runner. This shortened example is only
for a JSON-only fixture; the real Showcase profile must include its approved
Tauri/Cargo/lock mirrors as well.

```json
{
  "schema": "zuz.its.settlement-profile/v1",
  "engine": "portable",
  "channels": { "desktop": "showcase", "remote": null },
  "products": [{
    "id": "showcase",
    "files": [{ "path": "product/package.json", "format": "json", "pointers": ["/version"] }]
  }]
}
```

Versionless projects use null channels and an empty products array. An impact
requiring an unconfigured product is blocked. No shell commands, network,
package installation or application runtime are required by the settlement code.

## Current CLI (external host only)

Before invocation validate the installed contract. The manifest detects changed
or missing package files; authenticity still comes from the approved signed Pack
archive and installation receipt, not a locally editable checksum list. Task
operations additionally validate the existing pinned Task registry chain.

```sh
node contracts/task-work-bug/v8/verify-contract.mjs
node contracts/task-work-bug/v8/settle-work-item.mjs --root /absolute/project --kind work --id WORK-001 --dry-run
node contracts/task-work-bug/v8/settle-work-item.mjs --root /absolute/project --kind work --id WORK-001 --write --approved-plan-digest sha256:PREVIEW_DIGEST
node contracts/task-work-bug/v8/finalize.mjs --root /absolute/project
```

Task requests use a JSON file and `task-lifecycle.mjs --root /absolute/project
--request /absolute/request.json --dry-run`. Apply the same request with `--write
--approved-plan-digest sha256:PREVIEW_DIGEST`. Example development transition:

```json
{
  "schema": "zuz.its.task-lifecycle-request/v1",
  "taskId": "1",
  "mode": "transition",
  "target": "development_complete"
}
```

For completion use `mode: "complete"` and `details.verification`; for recorded
Smoke use `mode: "test-pass"` with target `release_ready` or `completed`.
The verification object uses schema `zuz.its.completion-verification/v1`,
`outcome: "passed"`, `source: "clean-snapshot" | "trusted-ci"`, exact
`verifiedHead` and `verifiedTree`, string `recordId`, `targetStatus`,
`confirmedBy: "user" | "ai"`, UTC `confirmedAt`, `environment`, `summary`,
and a nonempty `evidence` string array. Collect these from tests actually run
against that committed snapshot or trusted CI. This runner validates the binding
and records the caller's attestation; it does not run the tests or authenticate
a CI service merely because `source` says `trusted-ci`. Never fabricate evidence
or use results from unrelated dirty code. A deployment still needs its own
artifact/Build ID and release authorization.

Work/Bug requests use `work-item-lifecycle.mjs` with the same preview/apply flags:

```json
{
  "schema": "zuz.its.work-item-lifecycle-request/v1",
  "kind": "work",
  "id": "WORK-001",
  "target": "in_progress",
  "expectedSourceRevision": "sha256:CURRENT_DOCUMENT_DIGEST",
  "timestamp": "2026-09-06T00:00:00.000Z"
}
```

Keep the request timestamp unchanged between preview and apply. The normal
forward flow is `new → planned/confirmed → in_progress → development_complete
→ release_ready → closed`. `development_complete` also requires `summary` and
nonempty `evidence`; normal closure requires `reason: completed` (Work) or
`reason: fixed` (Bug). Abnormal closure can stop an open item without inventing
development evidence: Work `cancelled`, `duplicate`, `not_needed`; Bug
`duplicate`, `cannot_reproduce`, `wont_fix`, `not_needed`. Duplicate requires
a same-kind, non-self `duplicateOf`. Closure does not apply a version until the
separate settlement operation. Existing blocked/reopen support remains with
the repository's explicit lifecycle path; this normal-forward CLI does not
invent missing unblock/reopen metadata.

Approval is bound to the root, HEAD, project profile, source bytes and exact
result bytes. It authorizes this settlement commit only, not implementation
commits, merge, push, deployment or another project's work. Decal-owned sessions
continue to use Native authority rather than pretending to be external hosts.

Finalization after a successful exact commit is automatic. A failed commit
preserves the pending marker. Inspect the cause and use `recover.mjs --root
/absolute/project --approved-plan-digest sha256:ORIGINAL_DIGEST --action resume`
after correcting it. `--action rollback` restores only the recorded before bytes
when no commit has occurred. Mixed/unknown edits and malformed or other-owner
markers are rejected. A dead-PID lock may be reclaimed only with
`--writers-paused`, after actually coordinating that no writers are running;
the flag never permits removing a live owner's lock. Recovery is not permission
to abandon another session's work. Incident release/version policy is not
invented here.

## Installation and use

Select the `task-work-bug` module to install this contract and its provider
instructions together. Preserve modified/unknown files and delegate
Primer-managed projects to `skill_sync`. Installing the module neither creates
a Task registry nor selects version files. Do not settle real user tickets as
test fixtures. Existing project engines remain authoritative where configured.

Node.js and Git are sufficient for the portable runner. A Decal login, release
stage reader, running app or network service is not a settlement dependency.
Application build/deployment policies and permissions remain separate.
