# zuz ITS isolated settlement drafts v20

Published v1–v19 bytes and planners remain unchanged. v20 is the portable
Task lifecycle, standalone settlement and release settlement execution path.
Projects with a repository-owned engine keep that engine. Native sessions
continue to use their advertised Host capability, never the portable writer.

## Normal use

Use `task-lifecycle.mjs`, `settle-work-item.mjs` or `release-settle.mjs` with
their v17 arguments. `--dry-run` remains read-only. `--draft` saves the approved
plan (same `--approved-plan-digest` as `--write`) without changing a Task,
registry, version, index or HEAD. `--write` saves that draft automatically,
then runs the published exact-commit writer and finalizes in the same call.
There is no separate successful-operation finalization step for an agent to omit.

Drafts live in `.decal/settlement-drafts-v1/<plan-digest>.json`, mode 0600.
Unfinished drafts include before/after source for recovery; successful operations
retain only compact hash/commit receipts. A private `*` ignore file keeps the
directory out of ordinary Git staging; tracked draft directories are refused.
Keep it out of backups intended for publication and Pack payloads. Draft files
are evidence, not approval or completed Task state. They never reserve a version
or hold the repository lock between calls. Several Tasks can have drafts while
another Task settles through the normal route, including the same shared index.

After a commit failure, the writer checks the full journal and working tree.
Only known uncommitted bytes belonging to that transaction are compensated;
the durable draft remains and the global application marker is released.
`requestState: draft` means the operation did not complete. Mixed/staged edits,
unsafe paths, unexpected history or an unknown journal are preserved and reported.
Git hooks still run. A denied hook does not become a successful settlement.

## Inspect and resume

```sh
node contracts/task-work-bug/v20/drafts.mjs --root . --action list
```

Resume with the normal lifecycle/settlement request, a **fresh dry-run** and
its currently authorized digest. The planner reads the latest Task, registry
and versions. New HEAD/tree-bound verification is required when the existing
completion proof is stale. Never replay saved `next` bytes or reuse an old
approval to silently rebase a plan. Already completed records remain idempotent;
release and per-ticket policies are unchanged.

## Older interrupted transactions

`finalize.mjs --root .` accepts only a verified historical exact settlement
commit. Unrelated commits may precede it; the base must remain an ancestor and
all settlement inputs must be unchanged up to its parent. Its complete write
set, before/after bytes and approval trailer must match. Later commits or dirty
files are preserved: historical receipt validation never rewrites them.

An older uncommitted v9 journal requires explicit, digest-bound compensation:

```sh
node contracts/task-work-bug/v20/drafts.mjs --root . --action park \
  --approved-plan-digest sha256:<the-verified-journal-intentDigest>
```

Inspect and obtain authority for those exact paths first. This saves the draft
durably before restoring only known before/after bytes. Changed record history,
mixed content, staged changes, symlinks, unknown owners and corrupted journals
are not guessed or deleted. A crash during the brief application transaction
can leave a process/Git lock: use the existing separately authorized recovery
procedure after proving writers have stopped; age alone is never authority.
Draft-only calls do not leave canonical changes or a durable application marker.

An exact commit may have succeeded before a process stopped. Check its receipt
before retrying; do not apply its version change twice. Draft status files are
not substitutes for a Git receipt. Publication, installation, push, merge,
deployment, secrets and access to another repository retain their own boundaries.
