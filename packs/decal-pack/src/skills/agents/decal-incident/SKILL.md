---
name: decal-incident
description: Register and manage zuz ITS Incident tickets for real service interruption or quality degradation.
metadata:
  version: "1.3.1"
  portable: true
---

# Decal Incident

Manage a zuz ITS Incident using the repository's installed portable contract.

## Repository authority boundary

Treat the Git root containing the invocation context as the only active project. Access to another repository requires explicit current-user approval naming its root and operation scope. Commit, push, deploy, delete, and settlement are separate authorities unless explicitly included.

## External commit approval

For ordinary commits outside Decal, follow the host policy and valid user approval, including an
existing standing or automatic approval covering this repository and task scope. Before committing,
briefly report the repository, branch, exact files, and intended changes. Do not require a new-turn
approval when that authorization remains valid; ask when approval is absent or the scope is unclear
or expanded. Never self-authorize or treat tool availability as user consent. Recheck HEAD, target
contents, staged/conflict state and ongoing Git operations; preserve unrelated changes.
This does not replace Native approval, registration-digest approval, or completion/settlement gates,
and does not authorize push, merge, deploy, deletion, or access to another repository.

## Incident boundary

Use Incident only for an actual operational interruption or quality degradation that requires response, resolution, or follow-up. Use Bug for a product implementation defect. Link them when appropriate, but do not automatically create a Bug or Task for every Incident.

Incident is a zuz ITS Issue with its own stable `INC-###` namespace and canonical path:

`docs/work-items/incidents/INC-<number>.md`

## Before changing files

1. Resolve and verify the current Git root and repository identity.
2. Read repository instructions and the current `contracts/zuz-its/v3` contract while preserving v1 and v2 as immutable compatibility inputs.
3. Preserve existing zuz ITS records and search current Incident records before reserving an ID.
4. Capture the observed impact, affected services, occurrence and detection times, classification tags, response state, and evidence.
5. Preserve unrelated dirty files and reject symlink, path escape, duplicate identity, or stale revision targets.

## Portable writer

Outside Decal, use the v10 main-authority broker. It preserves the v9 semantic intent while allowing a
linked feature or detached worktree to request registration. First preview the semantic candidate; the final `INC-<number>`
identity remains pending until approval:

```sh
node contracts/task-work-bug/v10/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json --dry-run
```

Only after the current user approves that exact scope, write the same intent with the returned digest:

```sh
node contracts/task-work-bug/v10/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json \
  --approved-digest sha256:<dry-run digest> --write
```

The broker resolves an allowed `origin/HEAD` or one unambiguous local `main`/`master`, then locates the one
existing worktree that owns that branch and allocates the Incident there under the shared repository lock.
It never changes the caller's branch or worktree. Missing, ambiguous, mismatched, or changing authority is
rejected. The approval includes only that exact registration commit, not push, merge, deploy, lifecycle
completion, or settlement.

Use `contracts/zuz-its/v3/transition-incident.mjs` for lifecycle changes. It accepts padded legacy aliases but displays the unpadded key. The normal flow is `new → confirmed → in_progress → development_complete → release_ready → closed`. Completion requires recovery time and evidence; closing as resolved requires completed recovery evidence.

In a Decal-owned session, prefer its advertised Native candidate and lifecycle capability. If Native is unavailable in an external Codex, Claude, Gemini, or ACP session, use the portable flow instead of refusing the entire ITS task.

## Chat reference

Use `@incident:INC-7` or `@incident:INC-7[title]` when referencing the Incident in a Decal conversation. Never guess a missing ID.
