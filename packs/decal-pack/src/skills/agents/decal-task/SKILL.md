---
name: decal-task
description: Register and manage Decal/Jig Task records for new features or broad product changes. Use when the user asks to create, plan, update, complete, or settle a Task.
metadata:
  version: "1.7.0"
  portable: true
---

# Decal Task

Manage a project Task using the repository's canonical Task·Work·Bug contract.

## Repository authority boundary

Treat the Git root containing the invocation context as the only active project. A mention, link,
dependency, companion repository, contract source, or shared Pack does not authorize access to another
project. Before reading another project's contents beyond a root/product-identity probe, running a command
there, or changing its files or Git state, obtain explicit current-user approval naming the repository root
and allowed operation scope for the current task. Verify the approved root independently and follow that
repository's own instructions. Commit, push, deploy, delete, and other external effects remain separate
authorities unless the approval explicitly includes them.

## Before changing files

1. Resolve the process working directory and, in Git repositories, `git rev-parse --show-toplevel`. Read the repository instructions from that resolved root only.
2. Compare the repository product identity in its instructions or manifest with any project, product, or repository named by the user. If they differ, or the target identity cannot be proven, stop before reading a Task registry or changing files. Report the mismatch and ask the user to open or start a task in the intended repository.
3. Treat Decal as the distributor and possible contract source, not as the owner of every installed project's work records. Never switch to the Decal repository or another upstream source merely because it owns a contract. Multiple repositories are in scope only when the user explicitly includes each one and each root is independently verified.
4. Locate the canonical registry inside the verified target root. Prefer `docs/tasks/index.md`; use `docs/slices/index.md` only when a complete legacy registry exists. If neither registry exists, report `initialization-required`; if only part of either registry exists or both claim to be canonical, stop and report the conflict.
5. Require the repository-approved authoring profile and its pinned contract manifests. For the standard Project Pack this is `contracts/task-work-bug/v1` through `v7`; a repository-owned adapter is valid only when the repository instructions explicitly name it and it preserves the pinned consumer contracts. If the required chain or profile is absent, modified, symlinked, or newer than the available validator, stop before writing and request the repository's prescribed Pack or authoring update. Never infer a Task schema from the existing index alone.
6. Run the verified profile's validator from the target root before creating, updating, or transitioning a Task. For the standard Project Pack use `node contracts/task-work-bug/v4/validate-task-index.mjs --root .`. A non-accepted result is a blocking condition; report its typed code and line without copying the malformed row. Its authoring status must be ready before registration.
7. Search existing records before reserving an ID. Preserve unknown fields and user-authored sections.

## Host routing

- In a Decal-owned session, use the advertised Decal Task candidate/lifecycle capability. Remote input remains Decal-owned and routes through the Desktop Host; never invoke the portable writer as a Remote-side Git mutation. If the capability is absent or reports a stale host, stop and request a Decal update or session refresh. Do not imitate a Native approval or receipt in text.
- Outside Decal, use `contracts/task-work-bug/v7/register-task-batch.mjs` for both single and multi-Task registration. First run the complete semantic intent with `--dry-run`; show the candidate meanings, `intentDigest`, path pattern, and that identity is pending until approval. Do not show or reserve provisional final IDs. Only when the current user turn approves that semantic scope, rerun the same intent with `--approved-digest ... --write`. The writer acquires the shared repository lock, issues final IDs on latest `main`, validates, writes, and commits the exact registration paths. It does not authorize push, merge, deploy, lifecycle completion, or version settlement.
- Express dependencies within one batch as stable `localRef` objects. Do not submit guessed final Task IDs or paths. A stale provisional ID is not a conflict because approval binds the semantic digest; changed title, scope, dependency, impact, or commit message requires a new dry-run and approval.
- When the standard Project Pack is current and the v4 validator returns `missing_registry_file`, the repository may be initialized only with `contracts/task-work-bug/initialize-task-registry.mjs`. Prepare a stable v1 initialization intent with explicit categories, run `--dry-run`, show the exact two-path write-set, and run `--write` with its source revision only when the current user explicitly approves initialization for that repository. Never run the initializer during Pack installation or update. Partial, legacy, nonempty, symlinked, stale, or already initialized registries are blocking states, not repair-by-overwrite cases.
- Repository lifecycle scripts remain canonical for status, Smoke, completion, and settlement when present. If no repository lifecycle script exists, `contracts/task-work-bug/v4/transition-task.mjs` may perform only its advertised `planned → in_progress` start transition using the same dry-run, exact write-set, source-revision, and current-turn approval gates. It does not grant completion, commit, release, or version-settlement authority.
- If either the validator or v7 writer is unavailable, stop and report `authoring_update_required` instead of extending the current index by inspection or relying on a network gateway. A repository explicitly pinned to v4 may keep its legacy file-only writer, but do not describe that path as atomic registration or reuse a v7 approval for a later manual commit.
- Never claim that a proposal, preview, or edited file has been registered until the canonical record actually exists.

## Task boundary

Use a Task for a new feature, a broad redesign, or work spanning multiple product surfaces, protocols, storage contracts, or release units. Use Work for a bounded improvement and Bug for an observed defect that restores an existing contract.

Register before implementation. Record scope, exclusions, completion criteria, dependencies, version impact, Remote parity, expected write-set, context budget, and the planned `App.tsx` impact when the repository requires them.

## Safety and completion

- Preserve unrelated dirty files. Do not stage, stash, reset, or rewrite another session's work.
- Recheck the source revision and target paths immediately before every lifecycle write.
- Outside Decal, an explicit request to settle or close the Task authorizes the immediate isolated commit of
  only the exact settlement write-set produced by that operation. Commit it before any other edit, then run
  the repository settlement finalizer. If commit or finalization is blocked, preserve the pending marker and
  report `settlement prepared; commit pending`; do not report the Task as durably settled. This authority does
  not include implementation files, push, merge, deploy, or a different repository.
- Do not equate implementation, commit, merge, Smoke, release, and version settlement. Advance only through the lifecycle gates supported by the project.
- Report the exact Task ID, resulting status, validation evidence, and any remaining release or settlement work.
