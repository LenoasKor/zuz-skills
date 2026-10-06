---
name: decal-incident
description: Register and manage zuz ITS Incident tickets for real service interruption or quality degradation.
metadata:
  version: "1.5.2"
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
2. Read repository instructions, `contracts/zuz-its/v3` for identity and read compatibility, and the installed `contracts/zuz-its/v5` transition profile when present. Preserve published v1–v3 bytes as immutable compatibility inputs.
3. Preserve existing zuz ITS records and search current Incident records before reserving an ID.
4. Capture the observed impact, affected services, occurrence and detection times, classification tags, response state, and evidence.
5. Preserve unrelated dirty files and reject symlink, path escape, duplicate identity, or stale revision targets.

## Portable writer

Outside Decal, require the adopted v16 Incident-only main-authority profile and validate its manifest/dependencies. It preserves the v9 semantic intent while allowing a
linked feature or detached worktree to request registration. First preview the semantic candidate; the final `INC-<number>`
identity remains pending until the authorized writer runs:

```sh
node contracts/task-work-bug/v16/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json --dry-run
```

Only after applicable user authority or explicit repository automatic policy authorizes that exact scope, write the same intent with the returned digest. The digest binds the same authorized semantic intent; it is not evidence of a human click or a new permission grant:

```sh
node contracts/task-work-bug/v16/register-ticket.mjs \
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

## Chat reference

Use `@incident:INC-7` or `@incident:INC-7[title]` when referencing the Incident in a Decal conversation. Never guess a missing ID.

## Same-issue reuse and reopen

Before a new Work/Bug, inspect the current record and same-parent open/closed records. Use Native `issueReview` with checked IDs/revisions, decision (`distinct`, `reuse`, `reopen`) and scope rationale. Identical Work goal/acceptance/release unit or Bug cause/fix/verification scope uses the existing ID. Date or symptom similarity alone is insufficient. Closed records use the formal reopen operation and retain earlier completion and version history; duplicate/cancelled/unfixed records and independently settled task-batch release units are separated. When the project adopts the portable engine and v12 is installed, read `contracts/task-work-bug/v12/README.md` and use its revision-bound `work-item-bookkeeping.mjs`. Repository lifecycle engines stay canonical. Never hand-edit a closed record into a developing status or overwrite historical evidence.

## Preserving registration locks

For Task/Work/Bug registration, `compatibility.portablePreservingRegistration` advertises `task-work-bug/v15`; use their installed v15 profile after validation. Incident registration uses only the adopted v16 profile above, not the v15 writer. v15 retains the v10 canonical-main resolver, existing intent/approval digest, exact registration commit and idempotent receipt. It waits at most five minutes, supports cancellation, and preserves locks belonging to terminated owners. An owner-terminated or unknown result requires inspection; never delete the lock or repeat an ambiguous write. A repository adapter explicitly selecting v15 is equivalent.

Hosts without the installed v16 Incident profile must keep the Incident request blocked and require an update or an explicitly supported repository canonical engine; do not generate nested legacy Incident output or claim that legacy registration preserves dead-owner locks. This selection changes no Native fallback, cross-project, publication, lifecycle or settlement authority.

## Canonical Incident registration profile

For Incident registration, require the explicitly adopted `task-work-bug/v16` Incident-only profile and its installed manifest plus actual dependency validation. Use `contracts/task-work-bug/v16/register-ticket.mjs` with the same nested v9 semantic intent, dry-run, approved digest and exact registration commit flow. It emits top-level canonical Incident fields and validates them using the actual v5 consumer before any write. v15 remains the preserving registration path for Task/Work/Bug only; neither v15 nor v10 Incident output is a direct fallback for the v5 lifecycle consumer. If v16 is unavailable or validation fails, preserve the request and require a Pack update rather than generate a noncanonical record. Existing repository canonical registration engines remain canonical when explicitly supported; do not silently migrate old nested Incident records.

This profile changes no Native grant, lifecycle/settlement, cross-project, publication or installation authority. Missing/rejected advertised Native capability stays blocked; Native sessions never invoke the external writer. Candidate capability is not Native advertisement. Existing v15 waiting/cancellation/dead-owner preservation applies unchanged through the pinned lock implementation.

The v5 consumer checks exact UTC chronological order across arbitrary fractional precision without truncation, preserves original record values and body bytes, and retains existing status/ownership/lock/revision rules. The v16 producer and v5 lifecycle form the supported Incident path; old v4 is immutable and is not a safe direct fallback for this advertised exact-time profile.
