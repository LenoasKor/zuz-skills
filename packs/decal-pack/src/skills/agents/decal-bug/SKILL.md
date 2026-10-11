---
name: decal-bug
description: Register, diagnose, fix, verify, and settle Decal/Jig Bug records for observed behavior that differs from an existing contract. Use when the user reports a reproducible defect or asks to manage a Bug.
metadata:
  version: "1.15.0"
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

When the repository ships `contracts/task-work-bug/its-register.mjs`, use it instead of hand-writing a record (see Capability-resolved registration; never name a contract version yourself). The
dry-run returns no final ID. From a linked feature or detached worktree, the broker locates the one
existing canonical `main`/`master` worktree and runs the unchanged ticket writer there. It never switches,
detaches, creates, or removes a worktree. Missing, ambiguous, or changing main authority fails closed.
The receipt reports both the requesting worktree and the authority worktree.

```sh
node contracts/task-work-bug/its-register.mjs --kind ticket \
  --root . --intent /path/to/approved-intent.json --dry-run

node contracts/task-work-bug/its-register.mjs --kind ticket \
  --root . --intent /path/to/approved-intent.json \
  --approved-digest sha256:<dry-run digest> --write
```

Lifecycle steps use the same revision binding. Bug starts at `new → confirmed → in_progress → development_complete`.
When `contracts/task-work-bug/v11/` is installed, use its v2 lifecycle request and bind the currently observed
project release stage to the preview digest. Explicit stored `live` follows `development_complete → release_ready
→ closed`. Explicit stored `pre_live`, or a missing/null/legacy `unset` stage marked `defaulted`, closes normally
from `development_complete` after the required verification and Smoke; do not create `release_ready`. Never infer
`live`. This branch does not authorize settlement, deployment, cost, secrets, or external-service effects.

If the project explicitly adopts the packaged v11 runner, read `contracts/task-work-bug/v11/README.md`
and validate its manifest. Use `v11/work-item-lifecycle.mjs` for release-stage-aware normal transitions and
`v20/settle-work-item.mjs --kind bug` for closed standalone settlement. Preview, approve, and apply
the same exact plan digest; commit/finalize are included. Task-batch items settle with their release
Task, not separately. When the committed `config/its-settlement.json` sets `mode: release`, closing does
not settle: the record keeps `pending`, the settlement runner returns `deferred_to_release`, and the
version is applied once at release with `v20/release-settle.mjs` (separately approved). A missing file
keeps per-ticket settlement. The approved project profile must name its version sources. Preserve existing
repository engines, user modifications and unrelated dirty files. Do not fall back to the unlocked v5
writer after a v11 rejection. A project that only has the published v9 runner retains its legacy
`development_complete → release_ready → closed` flow until its Pack is updated. The following v5 path is only for an older, explicitly pinned installation:

```sh
node contracts/task-work-bug/v5/transition-work-item.mjs \
  --root . --kind bug --id BUG-### --status <status> \
  --expected-source-revision sha256:<current revision>
```

`development_complete` additionally requires `--summary` and at least one `--evidence`. `closed` requires
`--reason`. A repository that ships its own lifecycle scripts takes precedence over this package.

## Interrupted portable settlement

For a project adopting v20, follow `contracts/task-work-bug/v20/README.md`. `--draft` saves an approved plan without changing canonical records or versions; ordinary `--write` includes the exact commit and finalization. A failed commit retains an isolated draft after safe compensation. Resume through the normal planner with a fresh preview, verification and authorized digest; never copy saved output over a newer registry or replay an old version increment. Use `drafts.mjs --action list` to inspect, and the digest-bound `--action park` only for an explicitly authorized legacy recovery. Mixed changes and live/unknown locks stay protected. A draft is not completion; a different Task can proceed when no unsafe application state remains.

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

Before a new Work/Bug, inspect the current record and same-parent open/closed records. Use Native `issueReview` with checked IDs/revisions, decision (`distinct`, `reuse`, `reopen`) and scope rationale. Identical Work goal/acceptance/release unit or Bug cause/fix/verification scope uses the existing ID. Date or symptom similarity alone is insufficient. Evidence-only additions and repeated execution retain closed status and earlier completion/version history; actual resumed development uses the formal reopen operation; duplicate/cancelled/unfixed records and independently settled task-batch release units are separated. When the project adopts the portable engine and v12 is installed, read `contracts/task-work-bug/v12/README.md` and use its revision-bound `work-item-bookkeeping.mjs`. Repository lifecycle engines stay canonical. Never hand-edit a closed record into a developing status or overwrite historical evidence.


## Capability-resolved registration

Register through the stable entry `contracts/task-work-bug/its-register.mjs`; do not choose or name a contract version. The entry reads `contracts/task-work-bug/capabilities.json`, which maps each capability (`register-task-batch`, `register-ticket`, `register-incident`, `register-via-authority`) to exactly one contract. It runs a contract only when that contract is listed and its own manifest and dependency verification pass. It never runs an unlisted folder, never looks for "the latest" version, and never falls back to an older contract: if a capability is not advertised or its contract fails verification, the entry stops with `authoring_update_required` and the request is preserved until the Pack is updated.

A project paired with a number authority on the local network (`.decal/its-lan-client.json`) always registers through that authority, with the same approved digest, so two devices never issue the same number. If the authority client is unavailable or fails verification the entry stops with `authority_client_unavailable`; never register locally in that state. A device that is not paired but whose project has a number authority on the local network is stopped the same way with `pairing_required`: nothing is registered, the entry names the authority, and the agent runs the pairing step (`lan-client.mjs pair`), shows the user the check code, and continues only after the user approved the request on the main device. Pairing and approval are separate user-confirmed steps described by the multi-device authority contract; an agent never approves a pairing request without showing the user both check codes.

This selection changes no Native fallback, cross-project, publication, lifecycle or settlement authority.
