---
name: decal-task
description: Register and manage Decal/Jig Task records for new features or broad product changes. Use when the user asks to create, plan, update, complete, or settle a Task.
metadata:
  version: "1.21.1"
  portable: true
---

# Decal Task

Manage a project Task using the repository's canonical zuz ITS contract.

## Tracking decision first

Read `contracts/its-tracking-policy.md` from the verified project root before proposing a ticket. It is the shared registration decision, not an extra approval step. Exempt operations return to the requested work without issuing a ticket; matching scope continues its existing record. The procedures below apply only when a ticket is needed or the user explicitly requests one. A session, commit, push, or verification step does not itself need a Work.

## Repository authority boundary

Treat the Git root containing the invocation context as the only active project. A mention, link,
dependency, companion repository, contract source, or shared Pack does not authorize access to another
project. Before reading another project's contents beyond a root/product-identity probe, running a command
there, or changing its files or Git state, obtain explicit current-user approval naming the repository root
and allowed operation scope for the current task. Verify the approved root independently and follow that
repository's own instructions. Commit, push, deploy, delete, and other external effects remain separate
authorities unless the approval explicitly includes them.

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


## Before changing files

1. Resolve the process working directory and, in Git repositories, `git rev-parse --show-toplevel`. Read the repository instructions from that resolved root only.
2. Compare the repository product identity in its instructions or manifest with any project, product, or repository named by the user. If they differ, or the target identity cannot be proven, stop before reading a Task registry or changing files. Report the mismatch and ask the user to open or start a task in the intended repository.
3. Treat Decal as the distributor and possible contract source, not as the owner of every installed project's work records. Never switch to the Decal repository or another upstream source merely because it owns a contract. Multiple repositories are in scope only when the user explicitly includes each one and each root is independently verified.
4. Locate the canonical registry inside the verified target root. Prefer `docs/tasks/index.md`; use `docs/slices/index.md` only when a complete legacy registry exists. If neither registry exists, report `initialization-required`; if only part of either registry exists or both claim to be canonical, stop and report the conflict.
5. Require the repository-approved authoring profile and its pinned contract manifests. For the standard Project Pack this is `contracts/task-work-bug/v1` through `v10`; a repository-owned adapter is valid only when the repository instructions explicitly name it and it preserves the pinned consumer contracts. If the required chain or profile is absent, modified, symlinked, or newer than the available validator, stop before writing and request the repository's prescribed Pack or authoring update. Never infer a Task schema from the existing index alone.
6. Registration and shared-registry changes require the full verified profile validator (`node contracts/task-work-bug/v4/validate-task-index.mjs --root .`). For append-only factual Task evidence, a project adopting v13 may use `contracts/task-work-bug/v13/task-body.mjs` with its portable profile, or its explicitly registered repository adapter. That path validates target identity/revision/schema and registry identity, preserving structural fields and unknown content without reading unrelated document bodies. Never skip a failing validator without that supported path. Missing or ambiguous registry, duplicate IDs and unsafe target paths still block the affected write. A state/index change uses the canonical lifecycle engine and its required consistency checks.
7. Search existing records before reserving an ID. Preserve unknown fields and user-authored sections.
8. Before issuing a related Work or Bug within this Task, check its open children and same-day tickets. Reuse a matching Work's goal, acceptance criteria, and release unit or a matching Bug's cause, fix, and verification scope; record the reuse or separation reason. A new ID is for independent scope, not merely another step of this Task.

## Host routing

- In a Decal-owned session, use the advertised Decal Task candidate/lifecycle capability. Remote input remains Decal-owned and routes through the Desktop Host; never invoke the portable writer as a Remote-side Git mutation. Check the requested operation and its mandatory guarantees, not unrelated operations. If its capability is absent or reports a stale host, hold that action and dependent steps, continue independent authorized work, and report the required Decal update or refresh. Do not imitate a Native approval or receipt in text.
- Outside Decal, before registration, initialization or lifecycle changes, read `contracts/its-guides/decal-task/portable.md`. Use the stable `contracts/task-work-bug/its-register.mjs --kind task` entry; never choose a numbered registration writer. Missing guidance holds that operation; no Native bypass or additional authority is granted.

## Task boundary

Use a Task for a new feature, a broad redesign, or work spanning multiple product surfaces, protocols, storage contracts, or release units. Use Work for a bounded improvement and Bug for an observed defect that restores an existing contract.

When a new record is required by the tracking decision, register before implementation. Record scope, exclusions, completion criteria, dependencies, version impact, Remote parity, expected write-set, context budget, and the planned `App.tsx` impact when the repository requires them.

While the Task is earlier than `development_complete`, test failures found while implementing or verifying its existing scope are normal development feedback. Fix them within the Task and, when useful, record the cause, correction, and rerun evidence in its work log. Do not automatically create a Bug. Split out a Bug or Incident only for a regression observed after development completion, a defect with an independent cause/scope/closure outside the Task, or a security, data-loss, or live-service condition that requires separate tracking.

## Interrupted portable settlement

Before recovering interrupted portable settlement, read `contracts/its-guides/decal-task/recovery.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.

## Safety and completion

Before status transitions, completion or settlement, read `contracts/its-guides/decal-task/completion.md`. Preserve unrelated changes and existing approvals; do not equate implementation, commit, Smoke, release or settlement. Missing guidance blocks only the affected operation.

## Same-issue reuse and reopen

Before proposing a related Work/Bug or reopening a record, read `contracts/its-guides/decal-task/bookkeeping.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.

## Capability-resolved registration

Before external registration or multi-device pairing, read `contracts/its-guides/decal-task/registration.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. Use `contracts/task-work-bug/its-register.mjs`; it never falls back to an older contract. This pointer grants no authority and never permits a Native bypass.
