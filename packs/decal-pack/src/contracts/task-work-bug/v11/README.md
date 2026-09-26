# zuz ITS portable release-stage lifecycle contract v11

v11 preserves every published v1-v10 byte and adds a release-stage-aware Work and Bug lifecycle.

- Registration continues through the v10 main-worktree authority broker.
- Task lifecycle, settlement, finalization, recovery, ticket identity, and version profiles remain v9.
- The v11 Work/Bug lifecycle accepts the legacy v1 request unchanged. Legacy requests retain the
  published `development_complete -> release_ready -> closed` sequence.
- A v2 lifecycle request binds the caller-observed project release stage and its source to the
  approved plan digest. `stored` accepts only explicit `pre_live` or `live`. `defaulted` accepts only
  a missing/null stage or the legacy `unset` token and normalizes it to `pre_live`.
- Normal `pre_live` closure may move directly from `development_complete` to `closed`; an already
  `release_ready` pre-live record can also close for migration compatibility. A pre-live request to
  enter `release_ready` is rejected.
- Explicit `live` keeps the existing `development_complete -> release_ready -> closed` sequence.
- Completion evidence, normal closure reasons, source revision, exact write-set, approval digest,
  settlement, deployment, cost, secret, and external-service authority gates remain unchanged.

The release context is an approval-bound caller assertion, not an authenticated deployment receipt.
Native and external hosts must derive it from the project's canonical release context when available.
They must not infer `live`; missing, null, and legacy `unset` values use the documented `pre_live`
fallback. An unknown future value fails closed.
