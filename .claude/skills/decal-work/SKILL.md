---
name: decal-work
description: Register and manage bounded Decal/Jig Work items such as small improvements, wording or style changes, focused refactors, tests, or documentation. Use when the user asks to create, update, complete, or settle Work.
metadata:
  version: "1.11.0"
  portable: true
---

# Decal Work

Manage a bounded Work item using the repository's canonical zuz ITS contract.

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

Register before implementation with observed context, desired outcome, completion criteria, expected write-set, version/Remote impact, release mode, and parent Task references.

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

When the repository ships `contracts/task-work-bug/v10/`, use it instead of hand-writing a record. The
dry-run returns no final ID. From a linked feature or detached worktree, the broker locates the one
existing canonical `main`/`master` worktree and runs the unchanged v9 writer there. It never switches,
detaches, creates, or removes a worktree. Missing, ambiguous, or changing main authority fails closed.
The receipt reports both the requesting worktree and the authority worktree.

```sh
node contracts/task-work-bug/v10/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json --dry-run

node contracts/task-work-bug/v10/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json \
  --approved-digest sha256:<dry-run digest> --write
```

Lifecycle steps use the same revision binding. Work starts at `new → planned → in_progress → development_complete`.
When `contracts/task-work-bug/v11/` is installed, use its v2 lifecycle request and bind the currently observed
project release stage to the preview digest. Explicit stored `live` follows `development_complete → release_ready
→ closed`. Explicit stored `pre_live`, or a missing/null/legacy `unset` stage marked `defaulted`, closes normally
from `development_complete` after the required verification and Smoke; do not create `release_ready`. Never infer
`live`. This branch does not authorize settlement, deployment, cost, secrets, or external-service effects.

If the project explicitly adopts the packaged v11 runner, read `contracts/task-work-bug/v11/README.md`
and validate its manifest. Use `v11/work-item-lifecycle.mjs` for release-stage-aware normal transitions and
`v17/settle-work-item.mjs --kind work` for closed standalone settlement. Preview, approve, and apply
the same exact plan digest; commit/finalize are included. Task-batch items settle with their release
Task, not separately. When the committed `config/its-settlement.json` sets `mode: release`, closing does
not settle: the record keeps `pending`, the settlement runner returns `deferred_to_release`, and the
version is applied once at release with `v17/release-settle.mjs` (separately approved). A missing file
keeps per-ticket settlement. The approved project profile must name its version sources. Preserve existing
repository engines, user modifications and unrelated dirty files. Do not fall back to the unlocked v5
writer after a v11 rejection. A project that only has the published v9 runner retains its legacy
`development_complete → release_ready → closed` flow until its Pack is updated. The following v5 path is only for an older, explicitly pinned installation:

```sh
node contracts/task-work-bug/v5/transition-work-item.mjs \
  --root . --kind work --id WORK-### --status <status> \
  --expected-source-revision sha256:<current revision>
```

`development_complete` additionally requires `--summary` and at least one `--evidence`. `closed` requires
`--reason`. A repository that ships its own lifecycle scripts takes precedence over this package.

## Safety and completion

- Preserve unrelated dirty files and other sessions' staged state.
- Revalidate the canonical target, source revision, symlink boundary, and exact write-set before each write.
- Outside Decal, an explicit request to settle or close the Work authorizes the immediate isolated commit of
  only the exact settlement write-set produced by that operation. Commit it before any other edit, then run
  the repository settlement finalizer. If commit or finalization is blocked, preserve the pending marker and
  report `settlement prepared; commit pending`; do not report the Work as durably settled. This authority does
  not include implementation files, push, merge, deploy, or a different repository.
- Move through the project's Work lifecycle; implementation completion does not by itself authorize release, settlement, push, or merge.
- Report the Work ID, resulting status, evidence, commit checkpoint, and remaining settlement work.

## Same-issue reuse and reopen

Before a new Work/Bug, inspect the current record and same-parent open/closed records. Use Native `issueReview` with checked IDs/revisions, decision (`distinct`, `reuse`, `reopen`) and scope rationale. Identical Work goal/acceptance/release unit or Bug cause/fix/verification scope uses the existing ID. Date or symptom similarity alone is insufficient. Closed records use the formal reopen operation and retain earlier completion and version history; duplicate/cancelled/unfixed records and independently settled task-batch release units are separated. When the project adopts the portable engine and v12 is installed, read `contracts/task-work-bug/v12/README.md` and use its revision-bound `work-item-bookkeeping.mjs`. Repository lifecycle engines stay canonical. Never hand-edit a closed record into a developing status or overwrite historical evidence.


## Preserving registration locks

When `compatibility.portablePreservingRegistration` advertises `task-work-bug/v15` and its installed verifier passes, use the same commands above from `contracts/task-work-bug/v15/` instead of `v10/`. v15 retains the v10 canonical-main resolver, existing intent/approval digest, exact registration commit and idempotent receipt. It waits at most five minutes, supports cancellation, and preserves locks belonging to terminated owners. An owner-terminated or unknown result requires inspection; never delete the lock or repeat an ambiguous write. A repository adapter explicitly selecting v15 is equivalent.

Hosts without this installed capability keep their pinned v10 path; do not claim that legacy registration preserves dead-owner locks. This selection changes no Native fallback, cross-project, publication, lifecycle or settlement authority.
