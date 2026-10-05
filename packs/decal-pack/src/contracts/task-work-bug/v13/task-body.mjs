#!/usr/bin/env node
// Append-only factual updates. Lifecycle/registration keep their existing writers.
import { readFile, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIndex, parseCategories, canonicalRegistry, validatePackage } from '../v4/registry.mjs';
import { digest, fail, safeFile, loadProfile, PROFILE_PATH } from '../v9/version-profile.mjs';
import { metadata } from '../v9/task-policy.mjs';
import { executePlan, gitBoundary, git, planDigest, validatePlan } from '../v9/transaction.mjs';
import { parseStrictJson } from '../v9/strict-json.mjs';
import { verifyContract } from './verify-contract.mjs';

export async function inspectTask(root, id) {
  if (!Number.isSafeInteger(id) || id < 1) fail('invalid_task_id');
  await validatePackage(root);
  await canonicalRegistry(root);
  const indexSource = await readFile(await safeFile(root, 'docs/tasks/index.md'), 'utf8');
  const categorySource = await readFile(await safeFile(root, 'docs/tasks/category_index.md'), 'utf8');
  const index = parseIndex(indexSource); // Global identity/path ambiguity still blocks writes.
  const categories = parseCategories(categorySource);
  const diskIds = new Set();
  for (const name of await readdir(path.join(root, 'docs/tasks'))) {
    const match = /^task_(\d+)_.*\.md$/u.exec(name);
    if (!match) continue;
    const diskId = Number(match[1]);
    if (diskIds.has(diskId)) fail('duplicate_task_id');
    diskIds.add(diskId);
  }
  const row = index.records.find(item => item.id === id);
  if (!row) fail('task_not_found');
  const relative = `docs/tasks/${row.fileName}`;
  const source = await readFile(await safeFile(root, relative), 'utf8');
  if (!new RegExp(`^# (?:Task|Slice) ${id}(?:\\b|[ .·])`, 'mu').test(source)) fail('document_identity_mismatch');
  if (metadata(source, '상태') !== row.status) fail('document_status_mismatch');
  const category = metadata(source, 'Task Category', true);
  if (category && !categories.categories.has(category)) fail('unknown_category');
  return { relative, source, row, reads: [
    { path: 'docs/tasks/index.md', before: digest(indexSource) },
    { path: 'docs/tasks/category_index.md', before: digest(categorySource) },
  ] };
}
export async function planTaskBody(root, request) {
  await verifyContract();
  const keys = ['schema', 'id', 'expectedSourceRevision', 'intentId', 'body'];
  if (!request || request.schema !== 'zuz.its.task-body-request/v1' || Object.keys(request).some(key => !keys.includes(key))
      || !/^[a-z0-9][a-z0-9-]{2,100}$/.test(request.intentId ?? '') || typeof request.body !== 'string'
      || !request.body.trim() || request.body.length > 100000 || request.body.includes('\0')) fail('invalid_body_request');
  const inspected = await inspectTask(root, request.id);
  // Never shadow structural metadata or inject completion/settlement receipts.
  if (/^\s*(?:[-*]\s+)?(?:# |상태:|Task Category:|Category Index:|Index [^:]*:|Version [^:]*:|Remote Version [^:]*:|Created Version:|Depends On:|Registration Intent:|Maintenance Intent[^:]*:|Blocked [^:]*:|Postponed [^:]*:|Resume Criteria:|Target Release:|Verified HEAD:|Verification [^:]*:)/mu.test(request.body)
      || /<!--\s*(?:decal-|zuz-)|zuz-its-context/iu.test(request.body)) fail('structural_update_not_allowed');
  const marker = `<!-- zuz-task-body:${request.intentId}:${digest(request.body)} -->`;
  const prior = inspected.source.match(new RegExp(`<!-- zuz-task-body:${request.intentId}:([^ ]+) -->`, 'u'));
  if (prior) {
    if (prior[0] !== marker) fail('intent_conflict');
    const head = await gitBoundary(root);
    if (digest(await git(root, ['show', `${head}:${inspected.relative}`])) !== digest(inspected.source)) fail('recorded_body_not_committed');
    return { status: 'already_recorded', id: request.id, sourceRevision: digest(inspected.source) };
  }
  if (digest(inspected.source) !== request.expectedSourceRevision) fail('stale_source_revision');
  const next = `${inspected.source}\n\n${marker}\n${request.body.trim()}\n`;
  const baseHead = await gitBoundary(root);
  const plan = { root, baseHead, recordId: String(request.id), operation: 'task-body', message: `docs(its): supplement Task ${request.id}`,
    reads: inspected.reads, entries: [{ path: inspected.relative, source: inspected.source, next, before: digest(inspected.source), after: digest(next) }] };
  await validatePlan(plan);
  return { status: 'preview', plan, approvalDigest: planDigest(plan) };
}
export async function cli(argv) {
  if (Object.hasOwn(process.env, 'DECAL_SESSION_ID')) fail('native_writer_required');
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (args.has(key)) fail('duplicate_argument');
    if (['--dry-run', '--write'].includes(key)) args.set(key, true);
    else if (['--root', '--request', '--approved-plan-digest'].includes(key) && argv[i+1] && !argv[i+1].startsWith('--')) args.set(key, argv[++i]);
    else fail('usage_error');
  }
  if (!args.get('--root') || !args.get('--request') || Boolean(args.get('--write')) === Boolean(args.get('--dry-run'))) fail('usage_error');
  const root = path.resolve(args.get('--root'));
  const loaded = await loadProfile(root);
  if (loaded.profile.engine !== 'portable') fail('repository_body_adapter_required');
  const requestPath = path.resolve(args.get('--request'));
  const stat = await lstat(requestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2*1024*1024) fail('unsafe_request');
  const request = parseStrictJson(await readFile(requestPath, 'utf8'));
  const result = await planTaskBody(root, request);
  if (result.status === 'already_recorded') return result;
  result.plan.reads.push({ path: PROFILE_PATH, before: loaded.revision });
  if (args.get('--dry-run')) return { status: 'preview', approvalDigest: planDigest(result.plan), writeSet: result.plan.entries.map(({path,before,after}) => ({path,before,after})) };
  return executePlan(result.plan, args.get('--approved-plan-digest'));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await cli(process.argv.slice(2)))); }
  catch (error) { console.log(JSON.stringify({status:'rejected',code:error.code ?? error.message})); process.exitCode=2; }
}
