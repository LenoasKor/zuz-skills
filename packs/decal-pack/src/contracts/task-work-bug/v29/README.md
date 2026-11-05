# Work and Bug reopen before release v29

Published v1-v28 bytes remain unchanged. v12 reopens only a closed Work (`completed`) or Bug (`fixed`).
A `pre_live` project closes Work and Bug from `development_complete`, so a record whose acceptance later
failed, for example on a platform the completion evidence listed as unverified, could not be reopened.
The only workaround was to record it as `completed`/`fixed` first and then reopen it, which writes a false result.

v29 adds that one case and changes nothing else:

- `work-item-bookkeeping.mjs` accepts the v12 request (`zuz.its.work-item-bookkeeping-request/v1`) and runs the
  published v12 operation unchanged, with the same approval digest.
- A `zuz.its.work-item-bookkeeping-request/v2` request adds `releaseStage` and `releaseStageSource`, normalized by the
  v11 rules: `stored` accepts explicit `pre_live` or `live`; `defaulted` accepts a missing/null stage or legacy
  `unset` and means `pre_live`; any other value fails closed. Hosts read the stage from the project's canonical
  release context and never infer `live`.
- With a v2 request, `reopen` of a `development_complete` Work or Bug is allowed when the effective stage is
  `pre_live` and neither `versionApplied` nor `remoteVersionApplied` holds an applied `x.y.z` version. The result is
  the v12 closed reopen: a required rationale, original `completion`, `closure`, version, `releaseMode` and
  `releaseTaskRef` field bytes appended to `reopenHistory` with `reopenedFrom` and the release context, pending
  versions reset, and status back to `planned` (Work) or `confirmed` (Bug).
- `live`, an applied version (including a settled task-batch item) and `release_ready` stay a separate release
  unit (`distinct_release_unit_required`). A v1 request still gets `reopen_not_allowed` there.
- Every other v2 operation (reuse, closed reopen) is the v12 operation.

The release context is bound to the approved plan digest through the operation name
(`<kind>-reopen-<stored|defaulted>-pre-live`). It is a caller assertion, not a deployment receipt.
Locking, the settlement profile requirement, exact commit and finalization remain v9. Repository engines stay
canonical and are delegated to, never replaced. Completion, Smoke, version settlement, push, merge and deploy keep
their own gates.
