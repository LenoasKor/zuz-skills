# zuz ITS bookkeeping contract v12

Published v1–v11 bytes remain unchanged. Registration uses v10; normal lifecycle uses v11;
settlement and finalization remain v9. v12 adds source-revision-bound Work/Bug reuse and reopen.

Before registration or reuse, inspect the active record and same-parent Task records, prioritizing
same-day records. Work goal, acceptance and release unit must match; Bug cause, fix and verification
scope must match. Similar symptoms or dates are insufficient. Report checked IDs and reasons.
Native automatic candidates submit the current ID/revision snapshot in `issueReview`; Native rechecks
that snapshot under the repository lock before writing. Portable registration retains the v10 broker.

`work-item-bookkeeping.mjs` accepts `zuz.its.work-item-bookkeeping-request/v1` with kind, id,
operation (`reuse` or `reopen`), expectedSourceRevision (`sha256:...`), UTC timestamp, rationale,
and body. No identity, scope, version impact or release metadata overrides are accepted.
Run with `--root ... --request ... --dry-run`, then identical input plus
`--approved-plan-digest ... --write`. The v9 transaction owns locking, exact commit and finalization.
A repository engine is delegated to, never replaced by this portable runner.

Reuse appends evidence to a developing or blocked record. Development-complete/release-ready
regressions require a separate release unit. Reopen accepts only completed Work or fixed Bug, archives
original completion/closure/version field bytes in append-only `reopenHistory`, resets current evidence
and pending versions, and returns to planned/confirmed. Already settled task-batch items require a new
record. Duplicate/cancelled/unfixed records cannot be reopened by this operation. Unknown fields and
body, ID and createdAt remain intact. Legacy records missing settlement metadata fail closed.

For requested bookkeeping and ordinary commits, honor explicit user or repository automatic policy
without a fresh approval question. Digest arguments bind validated input; never claim a user click.
When no applicable authority exists, obtain it. Always report kind/ID, create/reuse/reopen decision,
evidence, canonical commit/receipt and remaining work. Registry initialization, installation, cross-root
access, scope expansion, completion/Smoke/version settlement, push/merge/deploy retain their gates.
