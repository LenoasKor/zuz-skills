# Work and Bug lifecycle without a settlement profile v28

A Pack install does not create `.decal/settlement-profile.json`, because that file names a project's version sources and
only the project can approve it. The v11 Work and Bug lifecycle required the file for every transition, so a freshly
installed project could not move a record at all and saw only `ENOENT`.

A status transition writes one record and no version file, so it does not need the profile. v28 changes only that:

- With a profile, `work-item-lifecycle.mjs` runs the v11 lifecycle unchanged, including the `repository` engine refusal.
- A profile that is unreadable, invalid or a symbolic link is still refused. Only a missing file takes the new path.
- Without a profile, the same request, release context, source revision, Git boundary, approval digest and repository
  lock apply. The transition commits exactly its record with a `Zuz-ITS-Transition` trailer.
- If the commit fails, for example when a hook refuses it, the record goes back to its earlier bytes.
- A crash between the write and the commit leaves the record modified. The next attempt stops with `target_dirty`, and
  nothing is committed.

Version settlement still needs the profile. `settle-work-item.mjs`, `release-settle.mjs` and Task lifecycle report
`ENOENT` until the project commits one, as described in the v8 README. This contract does not change them.
