# zuz ITS portable release-time settlement contract v17

v17 preserves every published v1-v16 byte and adds release-time version settlement.

- The committed `config/its-settlement.json` (`decal.its-settlement-mode/v1`) chooses when versions are applied:
  `per-ticket` (also when the file is missing) or `release`. The settlement profile
  (`.decal/settlement-profile.json`, `zuz.its.settlement-profile/v1`) keeps naming the version sources and stays
  readable by the v11 lifecycle, v12 bookkeeping and v13 body adapters.
- `per-ticket` projects run the published v9 Task lifecycle and standalone settlement unchanged. An explicit mode
  file is bound to the approved plan as a read.
- `release` projects complete a Task without touching version sources: its applied versions stay `pending` and
  task-batch items keep `pending-task`. `settle-work-item.mjs` returns `deferred_to_release` with no writes.
- `release-settle.mjs` collects, from the committed tree, completed Tasks with a pending minor and closed
  `completed`/`fixed` Work/Bug with a pending patch (task-batch items only once their Task is completed). One release
  raises each channel once: minor if any included Task needs it, otherwise patch. Every included record receives that
  version. Preview, approve, and apply the same plan digest; the v9 transaction commits the exact write set and
  finalizes. Unrelated dirty files are preserved; a dirty included file blocks the release.
- Switching modes is a normal reviewed project change to the mode file. Already applied versions are never rewritten.
- Release settlement does not authorize push, tag, publish, deploy, cost, secret, or external-service effects.
