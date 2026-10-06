---
name: decal-incident
description: Register and manage zuz ITS Incident tickets for real service interruption or quality degradation.
metadata:
  version: "1.5.1"
  portable: true
---

# Decal Incident

Manage a zuz ITS Incident using the repository's installed portable contract.

## Repository authority boundary

Treat the Git root containing the invocation context as the only active project. Access to another repository requires explicit current-user approval naming its root and operation scope. Commit, push, deploy, delete, and settlement are separate authorities unless explicitly included.

## Automatic bookkeeping and mandatory reporting

Within the requested repository and task scope, an explicit user or repository automatic policy
may authorize registration, factual Task updates and ordinary isolated commits without another
approval question. Recheck the source revision, exact write-set and authority; preserve unrelated work.
Dry-run digests bind the same validated input, not an invented user click. Without applicable authority,
obtain it. This does not authorize another repository, registry initialization, installation, changed
scope, lifecycle completion, Smoke facts, version settlement, push, merge or deployment.

Use policy-authorized Native receipts directly. If an older host only offers a pending candidate,
use the common interaction panel and its existing grant; never bypass Native through direct files or
external fallback. Report kind/ID, create/reuse/reopen, checked records and decision reason, changes,
verification, canonical receipt/commit and remaining work after every operation.


## Incident boundary

Use Incident only for an actual operational interruption or quality degradation that requires response, resolution, or follow-up. Use Bug for a product implementation defect. Link them when appropriate, but do not automatically create a Bug or Task for every Incident.

Incident is a zuz ITS Issue with its own stable `INC-###` namespace and canonical path:

`docs/work-items/incidents/INC-<number>.md`

## Before changing files

1. Resolve and verify the current Git root and repository identity.
2. Read repository instructions, `contracts/zuz-its/v3` for identity and read compatibility, and the installed `contracts/zuz-its/v4` transition profile when present. Preserve published v1–v3 bytes as immutable compatibility inputs.
3. Preserve existing zuz ITS records and search current Incident records before reserving an ID.
4. Capture the observed impact, affected services, occurrence and detection times, classification tags, response state, and evidence.
5. Preserve unrelated dirty files and reject symlink, path escape, duplicate identity, or stale revision targets.

## Portable writer

Outside Decal, use the v10 main-authority broker. It preserves the v9 semantic intent while allowing a
linked feature or detached worktree to request registration. First preview the semantic candidate; the final `INC-<number>`
identity remains pending until the authorized writer runs:

```sh
node contracts/task-work-bug/v10/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json --dry-run
```

Only after the current user approves that exact scope, write the same intent with the returned digest:

```sh
node contracts/task-work-bug/v10/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json \
  --approved-digest sha256:<dry-run digest> --write
```

The broker resolves an allowed `origin/HEAD` or one unambiguous local `main`/`master`, then locates the one
existing worktree that owns that branch and allocates the Incident there under the shared repository lock.
It never changes the caller's branch or worktree. Missing, ambiguous, mismatched, or changing authority is
rejected. The approval includes only that exact registration commit, not push, merge, deploy, lifecycle
completion, or settlement.

For external portable lifecycle changes, prefer `contracts/zuz-its/v4/transition-incident.mjs` after validating its installed manifest and approved Pack receipt. Repository lifecycle engines stay canonical: use their supported Incident command instead of bypassing them with a direct packaged writer. If neither the v4 writer nor a compatible approved repository engine is available, fail-closed for mutation and report the required update; the old v3 writer is not a direct mutation fallback. Keep v3 identity, schema, padded aliases and read compatibility. The normal flow remains `new → confirmed → in_progress → development_complete → release_ready → closed`; completion requires recovery time and evidence, and resolved closure requires completed recovery evidence.

A packaged candidate profile does not advertise or authorize a Native capability. In a Decal-owned session, never invoke the external transition writer: use only its advertised Native lifecycle capability, and preserve a blocked request when that capability is missing or rejected. External Codex, Claude, Gemini and ACP sessions may use the validated portable profile within actual user or repository authority. This transition permission does not include Git commit, release/version settlement, publishing or installation.

## Chat reference

Use `@incident:INC-7` or `@incident:INC-7[title]` when referencing the Incident in a Decal conversation. Never guess a missing ID.

## Same-issue reuse and reopen

Before a new Work/Bug, inspect the current record and same-parent open/closed records. Use Native `issueReview` with checked IDs/revisions, decision (`distinct`, `reuse`, `reopen`) and scope rationale. Identical Work goal/acceptance/release unit or Bug cause/fix/verification scope uses the existing ID. Date or symptom similarity alone is insufficient. Closed records use the formal reopen operation and retain earlier completion and version history; duplicate/cancelled/unfixed records and independently settled task-batch release units are separated. When the project adopts the portable engine and v12 is installed, read `contracts/task-work-bug/v12/README.md` and use its revision-bound `work-item-bookkeeping.mjs`. Repository lifecycle engines stay canonical. Never hand-edit a closed record into a developing status or overwrite historical evidence.

## Preserving registration locks

When `compatibility.portablePreservingRegistration` advertises `task-work-bug/v15` and its installed verifier passes, use the same commands above from `contracts/task-work-bug/v15/` instead of `v10/`. v15 retains the v10 canonical-main resolver, existing intent/approval digest, exact registration commit and idempotent receipt. It waits at most five minutes, supports cancellation, and preserves locks belonging to terminated owners. An owner-terminated or unknown result requires inspection; never delete the lock or repeat an ambiguous write. A repository adapter explicitly selecting v15 is equivalent.

Hosts without this installed capability keep their pinned v10 path; do not claim that legacy registration preserves dead-owner locks. This selection changes no Native fallback, cross-project, publication, lifecycle or settlement authority.
