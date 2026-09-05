---
name: decal-incident
description: Register and manage ZUZ ITS Incident tickets for real service interruption or quality degradation.
metadata:
  version: "1.1.0"
  portable: true
---

# Decal Incident

Manage a ZUZ ITS Incident using the repository's installed portable contract.

## Repository authority boundary

Treat the Git root containing the invocation context as the only active project. Access to another repository requires explicit current-user approval naming its root and operation scope. Commit, push, deploy, delete, and settlement are separate authorities unless explicitly included.

## Incident boundary

Use Incident only for an actual operational interruption or quality degradation that requires response, resolution, or follow-up. Use Bug for a product implementation defect. Link them when appropriate, but do not automatically create a Bug or Task for every Incident.

Incident is a ZUZ ITS Issue with its own stable `INC-###` namespace and canonical path:

`docs/work-items/incidents/INC-<number>.md`

## Before changing files

1. Resolve and verify the current Git root and repository identity.
2. Read repository instructions and `contracts/zuz-its/v1` plus `contracts/zuz-its/v2`.
3. Preserve existing Task·Work·Bug records and search current Incident records before reserving an ID.
4. Capture the observed impact, affected services, occurrence and detection times, classification tags, response state, and evidence.
5. Preserve unrelated dirty files and reject symlink, path escape, duplicate identity, or stale revision targets.

## Portable writer

Outside Decal, use the v7 common ticket writer. First preview the semantic candidate; the final `INC-###`
identity remains pending until approval:

```sh
node contracts/task-work-bug/v7/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json --dry-run
```

Only after the current user approves that exact scope, write the same intent with the returned digest:

```sh
node contracts/task-work-bug/v7/register-ticket.mjs \
  --root . --intent /path/to/approved-intent.json \
  --approved-digest sha256:<dry-run digest> --write
```

The writer resolves an allowed `origin/HEAD` or one unambiguous local `main`/`master`, then allocates and
commits the Incident under the shared repository lock. Feature branches, detached HEAD, missing candidates,
and ambiguous local `main` plus `master` are rejected. The approval includes only that exact registration
commit, not push, merge, deploy, lifecycle completion, or settlement.

Use `contracts/zuz-its/v2/transition-incident.mjs` for lifecycle changes. The normal flow is `new → confirmed → in_progress → development_complete → release_ready → closed`. Completion requires recovery time and evidence; closing as resolved requires completed recovery evidence.

In a Decal-owned session, prefer its advertised Native candidate and lifecycle capability. If Native is unavailable in an external Codex, Claude, Gemini, or ACP session, use the portable flow instead of refusing the entire ITS task.

## Chat reference

Use `@incident:INC-###` or `@incident:INC-###[title]` when referencing the Incident in a Decal conversation. Never guess a missing ID.
