// Shared decision rules. These return decisions, never grants or fabricated receipts.
export const WAIT_TTL_MS = 300_000;
export const CORRECTION_LIMIT = 1;
export function operationCapability(catalog, operation) {
  const advertised = catalog?.operations?.[operation];
  if (!advertised || advertised.supported !== true) return { supported: false, code: 'operation_unavailable', blockedOperation: operation };
  const missing = (advertised.requires ?? []).filter(name => catalog.guarantees?.[name] !== true);
  return { supported: missing.length === 0, code: missing.length ? 'dependency_unavailable' : 'supported', blockedOperation: missing.length ? operation : null, missing };
}
export function remoteDecision({ parity, disposition, reason, userDecision, followup }) {
  if (parity === 'required' && disposition === 'required') return { accepted: true };
  if (parity !== 'not-required' || typeof reason !== 'string' || !reason.trim()) return { accepted: false, code: 'remote_reason_required' };
  if (disposition === 'not-applicable') return { accepted: true };
  if (disposition === 'deferred' && userDecision && followup) return { accepted: true };
  return { accepted: false, code: disposition === 'deferred' ? 'remote_scope_decision_required' : 'legacy_remote_classification_required' };
}
export function qaRequirements(action) {
  const common = ['target', 'ownership'];
  const actions = {
    observe: common,
    interact: [...common, 'session', 'dataImpact', 'actionAuthority'],
    restart: [...common, 'session', 'dataImpact', 'actionAuthority', 'processIdentity', 'isolation', 'terminationImpact'],
    attest: [...common, 'sourceBuildBinding', 'actualResult'],
  };
  if (!Object.hasOwn(actions, action)) throw new Error('unknown_qa_action');
  return actions[action];
}
export function qaDecision(action, evidence) {
  const missing = qaRequirements(action).filter(key => evidence?.[key] !== true);
  return { allowed: !missing.length, missing, latestImplementationVerified: action === 'attest' && !missing.length };
}
// Both arguments are trusted observations from an execution adapter, not model assertions.
export function restartDecision(grant, current) {
  if (!grant || !current || grant.revoked || !Number.isFinite(grant.expiresAt) || !Number.isFinite(current.now) || current.now >= grant.expiresAt) return 'authority_required';
  const keys = ['root', 'requestId', 'appIdentity', 'terminationScope', 'previewScope', 'costScope', 'permissionScope'];
  if (keys.some(key => !grant[key] || grant[key] !== current[key])) return 'authority_required';
  if (current.foreignDirty !== false || current.sourceOwned !== true || current.artifactBound !== true) return 'preparation_required';
  if (grant.sourceRevision !== current.sourceRevision && current.verifiedMainAdvance !== true) return 'preparation_required';
  return 'reuse';
}
export function retryDecision({ requestState, retryability, correctionCount = 0, elapsedMs = 0, receiptValid = false, cancelled = false, ownerActive = true }) {
  if (cancelled || !ownerActive) return 'blocked';
  if (receiptValid) return 'report_receipt';
  if (requestState === 'unknown' || requestState === 'created') return 'inspect_receipt';
  if (elapsedMs >= WAIT_TTL_MS) return 'blocked';
  if (requestState === 'not_created' && retryability === 'correct_and_retry_same_turn' && correctionCount < CORRECTION_LIMIT) return 'correct_once';
  if (requestState === 'not_created' && retryability === 'wait_for_owner') return 'wait';
  return 'blocked';
}
// The probe must be read-only. A wait never retries the mutation itself.
export async function waitForAvailability(probe, { signal, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), ttlMs = WAIT_TTL_MS } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new Error('invalid_wait_ttl');
  const start = now();
  if (!Number.isFinite(start)) throw new Error('invalid_wait_clock');
  const ttl = Math.min(WAIT_TTL_MS, ttlMs);
  let elapsed = 0;
  let interval = 250;
  for (;;) {
    if (signal?.aborted) return { status: 'blocked', code: 'cancelled' };
    const state = await probe();
    if (signal?.aborted) return { status: 'blocked', code: 'cancelled' };
    if (state.status !== 'busy') return state;
    if (state.ownerActive === false) return { status: 'blocked', code: 'owner_ended' };
    const observed = now();
    if (!Number.isFinite(observed) || observed < start) return { status: 'blocked', code: 'clock_changed' };
    // A backward clock adjustment must not extend the wait budget.
    elapsed = Math.max(elapsed, observed - start);
    const remaining = ttl - elapsed;
    if (remaining <= 0) return { status: 'blocked', code: 'wait_timeout' };
    const delay = Math.min(interval, remaining);
    await wait(delay, signal);
    elapsed += delay;
    interval = Math.min(interval * 2, 10_000);
  }
}
