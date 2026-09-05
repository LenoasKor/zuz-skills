---
name: decal-work
description: Register and manage bounded Decal/Jig Work items such as small improvements, wording or style changes, focused refactors, tests, or documentation. Use when the user asks to create, update, complete, or settle Work.
metadata:
  version: "1.5.0"
  portable: true
---

# Decal Work

Manage a bounded Work item using the repository's canonical Task·Work·Bug contract.

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
2. Compare the repository product identity in its instructions or manifest with any project, product, or repository named by the user. If they differ, or the target identity cannot be proven, stop before reading Work records or changing files. Contract source ownership does not move the Work record to Decal or another upstream repository.
3. Multiple repositories are in scope only when the user explicitly includes each one and each root is independently verified. Preserve the repository's own Task·Work·Bug authoring profile when its instructions name one.
4. Read the current schema and lifecycle contract under `contracts/task-work-bug/`, plus any linked Task.
5. Search canonical Work records for duplicates, but do not reserve a final `WORK-###` ID in the agent. The approved canonical-default-branch writer assigns it under the shared lock.
6. Derive version settlement fields with the repository helper when one exists. Do not invent `null`, version, release mode, or source revision values.

## Host routing

- In a Decal-owned session, use the advertised Decal Work candidate/lifecycle capability and its approval flow.
- Outside Decal, use the repository's portable candidate validator and lifecycle scripts when available. If they are absent, follow the checked-in schema and repository authorization rules exactly.
- A preview or candidate is not a canonical Work record until the approved writer or portable fallback has created it.

## Work boundary

Use Work for a bounded improvement that is not an observed product defect: wording or style adjustments, small refactors, focused test or documentation reinforcement, and other finite execution units. Link an existing parent Task through `taskRefs` when applicable. Do not use Work to hide a broad feature or a defect with an independently testable cause.

Register before implementation with observed context, desired outcome, completion criteria, expected write-set, version/Remote impact, release mode, and parent Task references.

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

When the repository ships `contracts/task-work-bug/v7/`, use it instead of hand-writing a record. The
dry-run returns no final ID. Approval authorizes the writer to resolve an allowed `origin/HEAD` or one
unambiguous local `main`/`master`, issue the ID on that canonical default branch, validate the record,
commit exactly one path, and return its receipt.

```sh
node contracts/task-work-bug/v7/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json --dry-run

node contracts/task-work-bug/v7/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json \
  --approved-digest sha256:<dry-run digest> --write
```

Lifecycle steps use the same revision binding. Work starts at `new → planned → in_progress` and then follows the
shared `development_complete → release_ready → closed` flow.

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
