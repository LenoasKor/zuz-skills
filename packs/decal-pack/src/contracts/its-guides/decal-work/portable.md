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

Lifecycle steps use the same revision binding. Work starts at `new → planned → in_progress → development_complete`.
When `contracts/task-work-bug/v28/` is installed, use `v28/work-item-lifecycle.mjs`. It takes the v11 request and needs no `.decal/settlement-profile.json` for a status transition; with a profile it runs v11 unchanged. Version settlement still needs the project-approved profile and reports `ENOENT` without one. Otherwise, when `contracts/task-work-bug/v11/` is installed, use its v2 lifecycle request and bind the currently observed
project release stage to the preview digest. Explicit stored `live` follows `development_complete → release_ready
→ closed`. Explicit stored `pre_live`, or a missing/null/legacy `unset` stage marked `defaulted`, closes normally
from `development_complete` after the required verification and Smoke; do not create `release_ready`. Never infer
`live`. This branch does not authorize settlement, deployment, cost, secrets, or external-service effects.

If the project explicitly adopts the packaged v11 runner, read `contracts/task-work-bug/v11/README.md`
and validate its manifest. Use `v28/work-item-lifecycle.mjs` (or `v11/work-item-lifecycle.mjs` where v28 is not installed) for release-stage-aware normal transitions and
`v20/settle-work-item.mjs --kind work` for closed standalone settlement. Preview, approve, and apply
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
  --root . --kind work --id WORK-### --status <status> \
  --expected-source-revision sha256:<current revision>
```

`development_complete` additionally requires `--summary` and at least one `--evidence`. `closed` requires
`--reason`. A repository that ships its own lifecycle scripts takes precedence over this package.
