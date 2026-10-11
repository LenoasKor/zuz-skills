---
name: decal-task
description: Register and manage Decal/Jig Task records for new features or broad product changes. Use when the user asks to create, plan, update, complete, or settle a Task.
metadata:
  version: "1.19.0"
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
- Outside Decal, use the stable entry `node contracts/task-work-bug/its-register.mjs --kind task --root . --intent <file>` (see Capability-resolved registration; never name a contract version yourself) for both single and multi-Task registration. First run the complete v7 semantic intent with `--dry-run`; show the candidate meanings, `intentDigest`, path pattern, and that identity is pending until the authorized writer runs. Do not show or reserve provisional final IDs. When valid user or repository policy authorizes that semantic scope, rerun the same intent with `--approved-digest ... --write`. When invoked from a linked feature or detached worktree, the registration broker finds the one existing canonical `main`/`master` worktree and runs the unchanged v7 registration transaction there without switching, detaching, creating, or removing any worktree. Its receipt reports both roots. Missing, ambiguous, or changing main authority fails closed. The registration commit does not authorize push, merge, deploy, lifecycle completion, or version settlement.
- Express dependencies within one batch as stable `localRef` objects. Do not submit guessed final Task IDs or paths. A stale provisional ID is not a conflict because approval binds the semantic digest; changed title, scope, dependency, impact, or commit message requires a new dry-run and an authority recheck.
- When the standard Project Pack is current and the v4 validator returns `missing_registry_file`, the repository may be initialized only with `contracts/task-work-bug/initialize-task-registry.mjs`. Prepare a stable v1 initialization intent with explicit categories, run `--dry-run`, show the exact write-set (the two registry files, plus `config/its-settlement.json` with `mode: release` when the project has not chosen a settlement mode), and run `--write` with its source revision only when the current user explicitly approves initialization for that repository. Never run the initializer during Pack installation or update. Partial, legacy, nonempty, symlinked, stale, or already initialized registries are blocking states, not repair-by-overwrite cases.
- Repository lifecycle scripts remain canonical for status, Smoke, completion, and settlement when present. For a project explicitly adopting the packaged portable runner, read `contracts/task-work-bug/v20/README.md` and validate its manifest before using `v20/task-lifecycle.mjs` (it runs the v9 planner unchanged for per-ticket projects). Its project-approved `.decal/settlement-profile.json` names all version sources; do not guess paths or replace an existing repository engine. Preview the exact plan, obtain the operation's required approval, then apply the same digest. Finalization is automatic. Completion requires actual verification evidence bound to the tested HEAD/tree; never create a passing receipt merely to pass the gate. With no v9 runner, v4 supports only its advertised `planned → in_progress` start; report the missing completion runner as an update requirement rather than claiming completion support. When the committed `config/its-settlement.json` sets `mode: release`, Task completion records the result and leaves applied versions `pending`; versions are applied once at release with `v20/release-settle.mjs` (preview, separate user approval, same digest). A missing file keeps per-ticket settlement. Switching modes is a reviewed change to that one file, never a rewrite of applied history.
- If the validator or the advertised registration capability is unavailable, stop and report `authoring_update_required` instead of extending the current index by inspection or relying on a network gateway. A repository explicitly pinned to v4 may keep its legacy file-only writer, but do not describe that path as atomic registration or reuse a v7 approval for a later manual commit.
- Never claim that a proposal, preview, or edited file has been registered until the canonical record actually exists.

## Task boundary

Use a Task for a new feature, a broad redesign, or work spanning multiple product surfaces, protocols, storage contracts, or release units. Use Work for a bounded improvement and Bug for an observed defect that restores an existing contract.

When a new record is required by the tracking decision, register before implementation. Record scope, exclusions, completion criteria, dependencies, version impact, Remote parity, expected write-set, context budget, and the planned `App.tsx` impact when the repository requires them.

While the Task is earlier than `development_complete`, test failures found while implementing or verifying its existing scope are normal development feedback. Fix them within the Task and, when useful, record the cause, correction, and rerun evidence in its work log. Do not automatically create a Bug. Split out a Bug or Incident only for a regression observed after development completion, a defect with an independent cause/scope/closure outside the Task, or a security, data-loss, or live-service condition that requires separate tracking.

## Interrupted portable settlement

For a project adopting v20, follow `contracts/task-work-bug/v20/README.md`. `--draft` saves an approved plan without changing canonical records or versions; ordinary `--write` includes the exact commit and finalization. A failed commit retains an isolated draft after safe compensation. Resume through the normal planner with a fresh preview, verification and authorized digest; never copy saved output over a newer registry or replay an old version increment. Use `drafts.mjs --action list` to inspect, and the digest-bound `--action park` only for an explicitly authorized legacy recovery. Mixed changes and live/unknown locks stay protected. A draft is not completion; a different Task can proceed when no unsafe application state remains.

## Safety and completion

- Preserve unrelated dirty files. Do not stage, stash, reset, or rewrite another session's work.
- Recheck the source revision and target paths immediately before every lifecycle write.
- Outside Decal, an ordinary Task status transition is a document-and-index commit checkpoint, not a prepared file left for a later session. Before invoking the repository's official transition command, confirm valid current-request, standing, or automatic commit approval for that repository and exact Task document/index; if absent, stop before writing. Recheck main/HEAD continuity, source status, staged/conflict state, and ongoing Git operations. Immediately validate and isolate-commit only the Task document and index, then confirm the resulting HEAD. If that commit fails, preserve the changes, report `transition prepared; commit pending` with the exit condition, and do not start overlapping registration or transition work. This does not authorize Native bypass, registration, Smoke, completion/settlement, push, merge, or deploy.
- For a repository-owned writer outside Decal, an explicit request to settle or close the Task authorizes the immediate isolated commit of
  only the exact settlement write-set produced by that operation. Commit it before any other edit, then run
  the repository settlement finalizer. If commit or finalization is blocked, preserve the pending marker and
  report `settlement prepared; commit pending`; do not report the Task as durably settled. This authority does
  not include implementation files, push, merge, deploy, or a different repository.
- Do not equate implementation, commit, merge, Smoke, release, and version settlement. Advance only through the lifecycle gates supported by the project.
- Report the exact Task ID, resulting status, validation evidence, and any remaining release or settlement work.

## Same-issue reuse and reopen

Before a new Work/Bug, inspect the current record and same-parent open/closed records. Use Native `issueReview` with checked IDs/revisions, decision (`distinct`, `reuse`, `reopen`) and scope rationale. Identical Work goal/acceptance/release unit or Bug cause/fix/verification scope uses the existing ID. Date or symptom similarity alone is insufficient. Evidence-only additions and repeated execution retain closed status and earlier completion/version history; actual resumed development uses the formal reopen operation; duplicate/cancelled/unfixed records and independently settled task-batch release units are separated. When the project adopts the portable engine and v12 is installed, read `contracts/task-work-bug/v12/README.md` and use its revision-bound `work-item-bookkeeping.mjs`. Repository lifecycle engines stay canonical. Never hand-edit a closed record into a developing status or overwrite historical evidence.


## Capability-resolved registration

Register through the stable entry `contracts/task-work-bug/its-register.mjs`; do not choose or name a contract version. The entry reads `contracts/task-work-bug/capabilities.json`, which maps each capability (`register-task-batch`, `register-ticket`, `register-incident`, `register-via-authority`) to exactly one contract. It runs a contract only when that contract is listed and its own manifest and dependency verification pass. It never runs an unlisted folder, never looks for "the latest" version, and never falls back to an older contract: if a capability is not advertised or its contract fails verification, the entry stops with `authoring_update_required` and the request is preserved until the Pack is updated.

A project paired with a number authority on the local network (`.decal/its-lan-client.json`) always registers through that authority, with the same approved digest, so two devices never issue the same number. If the authority client is unavailable or fails verification the entry stops with `authority_client_unavailable`; never register locally in that state. A device that is not paired but whose project has a number authority on the local network is stopped the same way with `pairing_required`: nothing is registered, the entry names the authority, and the agent runs the pairing step (`lan-client.mjs pair`), shows the user the check code, and continues only after the user approved the request on the main device. Pairing and approval are separate user-confirmed steps described by the multi-device authority contract; an agent never approves a pairing request without showing the user both check codes.

This selection changes no Native fallback, cross-project, publication, lifecycle or settlement authority.
