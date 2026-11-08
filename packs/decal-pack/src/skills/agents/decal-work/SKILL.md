---
name: decal-work
description: Register and manage a bounded Work item when independent tracking is needed or explicitly requested. First check small-change exemptions and existing records; commit, push, and verification steps alone do not need Work.
metadata:
  version: "1.16.1"
  portable: true
---

# Decal Work

Manage a bounded Work item using the repository's canonical zuz ITS contract.

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
2. Compare the repository product identity in its instructions or manifest with any project, product, or repository named by the user. If they differ, or the target identity cannot be proven, stop before reading Work records or changing files. Contract source ownership does not move the Work record to Decal or another upstream repository.
3. Multiple repositories are in scope only when the user explicitly includes each one and each root is independently verified. Preserve the repository's own zuz ITS authoring profile when its instructions name one.
4. Read the current schema and lifecycle contract under `contracts/task-work-bug/`, plus any linked Task.
5. Search canonical Work records for numeric duplicates, including padded legacy aliases, but do not reserve a final `WORK-<number>` ID in the agent. The approved canonical-default-branch writer assigns it under the shared lock.
6. Derive version settlement fields with the repository helper when one exists. Do not invent `null`, version, release mode, or source revision values.

## Host routing

- In a Decal-owned session, use the advertised Decal Work candidate/lifecycle capability and its advertised policy/interaction flow.
- Outside Decal, use the repository's portable candidate validator and lifecycle scripts when available. If they are absent, follow the checked-in schema and repository authorization rules exactly.
- A preview or candidate is not a canonical Work record until the approved writer or portable fallback has created it.

## Work boundary

Use Work for a bounded improvement that is not an observed product defect: wording or style adjustments, small refactors, focused test or documentation reinforcement, and other finite execution units. Link an existing parent Task through `taskRefs` when applicable. Do not use Work to hide a broad feature or a defect with an independently testable cause.

When a new record is required by the tracking decision, register before implementation with observed context, desired outcome, completion criteria, expected write-set, version/Remote impact, release mode, and parent Task references.

Before registering another Work, inspect the active work, open Work records under the same parent Task, and same-day records. If the goal, acceptance criteria, and release/settlement unit are shared, append the new step and evidence to the existing ID after source-revision recheck. The date alone is not a merge rule. A distinct outcome or release unit needs a separate linked record; preserve already issued duplicate IDs and their relationship instead of deleting or recycling them. State the checked IDs and reuse/separation reason in a new candidate.

While the Work is earlier than `development_complete`, test failures found while implementing or verifying its existing scope are normal development feedback. Fix them within the Work and, when useful, record the cause, correction, and rerun evidence in its work log. Do not automatically create a Bug. Split out a Bug or Incident only for a regression observed after development completion, a defect with an independent cause/scope/closure outside the Work, or a security, data-loss, or live-service condition that requires separate tracking.

## Canonical location

Work and Bug are **file-level records**. They are never rows in the Task index.

```
docs/work-items/work/WORK-<number>.md
docs/work-items/bugs/BUG-<number>.md
```

Never add a `## Work` or `## Bugs` section to `docs/tasks/index.md`; that index is Task-only and such a
section breaks the registry contract. Link a parent Task through `taskRefs` instead. If the canonical
directory is missing, the repository needs a Project Pack update rather than a hand-made section.

## Portable writer

Before any external registration, lifecycle or settlement operation, read `contracts/its-guides/decal-work/portable.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.

## Interrupted portable settlement

Before recovering interrupted portable settlement, read `contracts/its-guides/decal-work/recovery.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.

## Safety and completion

- Preserve unrelated dirty files and other sessions' staged state.
- Revalidate the canonical target, source revision, symlink boundary, and exact write-set before each write.
- For a repository-owned writer outside Decal, an explicit request to settle or close the Work authorizes the immediate isolated commit of
  only the exact settlement write-set produced by that operation. Commit it before any other edit, then run
  the repository settlement finalizer. If commit or finalization is blocked, preserve the pending marker and
  report `settlement prepared; commit pending`; do not report the Work as durably settled. This authority does
  not include implementation files, push, merge, deploy, or a different repository.
- Move through the project's Work lifecycle; implementation completion does not by itself authorize release, settlement, push, or merge.
- Report the Work ID, resulting status, evidence, commit checkpoint, and remaining settlement work.

## Same-issue reuse and reopen

Before proposing a related Work/Bug or reopening a record, read `contracts/its-guides/decal-work/bookkeeping.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.

## Capability-resolved registration

Before external registration or multi-device pairing, read `contracts/its-guides/decal-work/registration.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. Use `contracts/task-work-bug/its-register.mjs`; it never falls back to an older contract. This pointer grants no authority and never permits a Native bypass.
