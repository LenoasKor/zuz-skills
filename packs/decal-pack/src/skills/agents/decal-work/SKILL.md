---
name: decal-work
description: Register and manage bounded Decal/Jig Work items such as small improvements, wording or style changes, focused refactors, tests, or documentation. Use when the user asks to create, update, complete, or settle Work.
metadata:
  version: "1.2.0"
  portable: true
---

# Decal Work

Manage a bounded Work item using the repository's canonical Task·Work·Bug contract.

## Before changing files

1. Resolve the process working directory and, in Git repositories, `git rev-parse --show-toplevel`. Read the repository instructions from that resolved root only.
2. Compare the repository product identity in its instructions or manifest with any project, product, or repository named by the user. If they differ, or the target identity cannot be proven, stop before reading Work records or changing files. Contract source ownership does not move the Work record to Decal or another upstream repository.
3. Multiple repositories are in scope only when the user explicitly includes each one and each root is independently verified. Preserve the repository's own Task·Work·Bug authoring profile when its instructions name one.
4. Read the current schema and lifecycle contract under `contracts/task-work-bug/`, plus any linked Task.
5. Search canonical Work records and reserve the next unused stable `WORK-###` ID only at write time.
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

When the repository ships `contracts/task-work-bug/v5/`, use it instead of hand-writing a record. The
writer issues the identity, writes exactly one path, and revalidates afterwards.

```sh
node contracts/task-work-bug/v5/validate-work-items.mjs --root .

node contracts/task-work-bug/v5/register-work-item.mjs \
  --root . --intent /path/to/approved-intent.json --dry-run

node contracts/task-work-bug/v5/register-work-item.mjs \
  --root . --intent /path/to/approved-intent.json \
  --expected-source-revision sha256:<dry-run revision> --write
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
- Move through the project's Work lifecycle; implementation completion does not by itself authorize release, settlement, push, or merge.
- Report the Work ID, resulting status, evidence, commit checkpoint, and remaining settlement work.
