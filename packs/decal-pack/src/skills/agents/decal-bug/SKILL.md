---
name: decal-bug
description: Register, diagnose, fix, verify, and settle Decal/Jig Bug records for observed behavior that differs from an existing contract. Use when the user reports a reproducible defect or asks to manage a Bug.
metadata:
  version: "1.16.1"
  portable: true
---

# Decal Bug

Manage an observed defect using the repository's canonical zuz ITS contract.

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
2. Compare the repository product identity in its instructions or manifest with any project, product, or repository named by the user. If they differ, or the target identity cannot be proven, stop before reading Bug records or changing files. Contract source ownership does not move the Bug record to Decal or another upstream repository.
3. Multiple repositories are in scope only when the user explicitly includes each one and each root is independently verified. Preserve the repository's own zuz ITS authoring profile when its instructions name one.
4. Read the current Bug schema and lifecycle contract under `contracts/task-work-bug/`, plus linked Tasks or Work.
5. Capture the observed result, expected result, evidence, and a testable cause. Search existing Bug records for duplicates, but do not reserve a final `BUG-###` ID in the agent.
6. If restoring the existing contract requires a new product behavior or broad redesign, preserve the Bug as evidence and link a separate Task rather than silently expanding it.

## Host routing

- In a Decal-owned session, use the advertised Decal Bug candidate/lifecycle capability and its advertised policy/interaction flow.
- Outside Decal, use the repository's portable candidate validator and lifecycle scripts when available. If none exist, follow the checked-in schema and repository authorization rules exactly.
- Do not report a candidate, preview, or local draft as a registered or fixed Bug.

## Bug record

When an independent Bug record is required by the tracking decision, register before modifying product files. Include the observation, expected behavior, cause or diagnostic plan, Remote parity, completion criteria, expected write-set, version impact, release mode, and parent Task references.

Do not create a new Bug merely because a test fails while an existing Task, Work, or Bug is still earlier than `development_complete`. If the failure belongs to that record's current implementation or verification scope, fix it there and, when useful, record the cause, correction, and rerun evidence as trial-and-error history. Create a separate Bug or Incident only for a regression observed after development completion, a defect with an independent cause/scope/closure outside the active record, or a security, data-loss, or live-service condition that requires separate tracking.

Before registering another Bug, inspect the active record, open Bugs under the same parent Task, and same-day records. Continue an existing Bug if the cause, fix, and verification scope match, adding evidence and work-log history after source-revision recheck. Similar symptoms or the same date alone do not establish duplication. Independent causes, closure conditions, post-completion regressions, and security/data-loss/service incidents remain separate. Name checked IDs and the reuse/separation reason in a new candidate; retain an already issued duplicate ID and its relationship rather than deleting or recycling it.

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

Before any external registration, lifecycle or settlement operation, read `contracts/its-guides/decal-bug/portable.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.

## Interrupted portable settlement

Before recovering interrupted portable settlement, read `contracts/its-guides/decal-bug/recovery.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.

## Safety and completion

- Preserve unrelated dirty files and other sessions' work.
- Recheck the source revision, canonical path, symlink boundary, and exact write-set before every lifecycle write.
- For a repository-owned writer outside Decal, an explicit request to settle or close the Bug authorizes the immediate isolated commit of
  only the exact settlement write-set produced by that operation. Commit it before any other edit, then run
  the repository settlement finalizer. If commit or finalization is blocked, preserve the pending marker and
  report `settlement prepared; commit pending`; do not report the Bug as durably settled. This authority does
  not include implementation files, push, merge, deploy, or a different repository.
- Prove the fix with focused regression evidence. Distinguish `fixed`, `not reproduced`, `duplicate`, and `cancelled`; only a fixed standalone Bug applies its declared patch settlement.
- Report the Bug ID, resulting status, verification evidence, commit checkpoint, and remaining release or settlement work.

## Same-issue reuse and reopen

Before proposing a related Work/Bug or reopening a record, read `contracts/its-guides/decal-bug/bookkeeping.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.

## Capability-resolved registration

Before external registration or multi-device pairing, read `contracts/its-guides/decal-bug/registration.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. Use `contracts/task-work-bug/its-register.mjs`; it never falls back to an older contract. This pointer grants no authority and never permits a Native bypass.
