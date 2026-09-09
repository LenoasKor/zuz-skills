# zuz ITS portable registration broker v10

v10 preserves every published v1-v9 contract byte and adds a main-worktree authority broker for registration.

- Call `v10/register-task-batch.mjs` or `v10/register-ticket.mjs` from either the canonical default-branch checkout or any linked worktree of the same repository.
- The broker never checks out, switches, detaches, creates, removes, or repairs a worktree.
- If the caller is not on the canonical default branch, the broker locates the one existing worktree that owns `main` or `master` and delegates the unchanged v7/v9 registration transaction there.
- Missing, ambiguous, mismatched, or changing authority fails closed before a registration write.
- Receipts include both the requested worktree and the actual authority worktree. `callerWorktreePreserved: true` means the broker performed no branch/worktree mutation; it does not claim the caller had no unrelated changes.

Task registration keeps the v7 semantic intent and digest. Work, Bug, and Incident registration keeps the v9 semantic intent, unpadded ticket keys, and digest. Existing approval scopes remain registration-only and do not include push, merge, deployment, lifecycle completion, or version settlement.
