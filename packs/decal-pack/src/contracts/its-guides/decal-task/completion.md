## Safety and completion

- Preserve unrelated dirty files. Do not stage, stash, reset, or rewrite another session's work.
- Recheck the source revision and target paths immediately before every lifecycle write.
- Outside Decal, an ordinary Task status transition is a document-and-index commit checkpoint, not a prepared file left for a later session. Before invoking the repository's official transition command, confirm valid current-request, standing, or automatic commit approval for that repository and exact Task document/index; if absent, stop before writing. Recheck main/HEAD continuity, source status, staged/conflict state, and ongoing Git operations. Immediately validate and isolate-commit only the Task document and index, then confirm the resulting HEAD. If that commit fails, preserve the changes, report `transition prepared; commit pending` with the exit condition, and do not start overlapping registration or transition work. This does not authorize Native bypass, registration, Smoke, completion/settlement, push, merge, or deploy.
- For a repository-owned writer outside Decal, an explicit request to settle or close the Task authorizes the immediate isolated commit of
  only the exact settlement write-set produced by that operation. Commit it before any other edit, then run
  the repository settlement finalizer. If commit or finalization is blocked, preserve the pending marker and
  report `settlement prepared; commit pending`; do not report the Task as durably settled. This authority does
  not include implementation files, push, merge, deploy, or a different repository.
- Do not equate implementation, commit, merge, Smoke, release, and version settlement. Advance only through the lifecycle gates supported by the project.
- Report the exact Task ID, resulting status, validation evidence, and any remaining release or settlement work.
