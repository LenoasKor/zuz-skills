# Task version policy check v27

A Task records `versionImpact` and `remoteVersionImpact` as free text, because projects use different values. A value the
project's build cannot read passes registration and then breaks the build. v27 lets a project declare what it can read:

```json
{
  "schema": "decal.its-version-policy/v1",
  "task": {
    "versionImpact": ["desktop-minor", "none"],
    "remoteVersionImpact": ["remote-minor", "none"]
  }
}
```

Commit it as `config/its-version-policy.json`. Either list may be left out, and that field is then not checked.

`its-register.mjs` runs the check for `--kind task` on both `--dry-run` and `--write`, before a paired project is handed to
its number authority. The file is read from the canonical main worktree, where the record lands.

- Value outside the list: `unreadable_task_version_impact`, with each `localRef`, field, value and the allowed values.
- File present but unusable: `invalid_version_policy`, with a `reason`. A broken declaration does not silently allow everything.
- No file: registration behaves as before.

Work and Bug are never checked, because they legitimately use `desktop-patch` and `remote-patch`.

This contract adds no registration writer. `register-task-batch` keeps its contracts, and their intent digests and receipts
do not change. Calling a numbered contract directly skips the check, which is why skills use only the stable entry. An older
`capabilities.json` that does not list `check-task-version-policy` skips it too.

No push, merge, deploy or settlement.
