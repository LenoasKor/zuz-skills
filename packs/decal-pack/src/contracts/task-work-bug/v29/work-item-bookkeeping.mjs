#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, fail, loadProfile, PROFILE_PATH } from "../v9/version-profile.mjs";
import { executePlan, gitBoundary, planDigest, validatePlan } from "../v9/transaction.mjs";
import { parseWorkBug } from "../v9/work-bug-policy.mjs";
import { parseStrictJson } from "../v9/strict-json.mjs";
import { canonicalTicketId, resolveTicketPath } from "../v9/ticket-path.mjs";
import { normalizeReleaseContext } from "../v11/work-item-lifecycle.mjs";
import { updateWorkItem as updateWithV12 } from "../v12/work-item-bookkeeping.mjs";
import { verifyContract } from "./verify-contract.mjs";

const LEGACY_REQUEST = "zuz.its.work-item-bookkeeping-request/v1";
const RELEASE_STAGE_REQUEST = "zuz.its.work-item-bookkeeping-request/v2";
const LIFECYCLE_RELEASE_STAGE_REQUEST = "zuz.its.work-item-lifecycle-request/v2";
const FIELDS = ["schema","kind","id","operation","expectedSourceRevision","timestamp","rationale","body"];
const STAGE_FIELDS = ["releaseStage","releaseStageSource"];
const AFTER_DEVELOPMENT = ["development_complete","release_ready"];

function text(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4000 || /[\u0000-\u001f]/u.test(value)) fail("invalid_issue_review");
  return value.trim();
}
function header(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (!match) fail("missing_frontmatter");
  return { match, offset: match[0].indexOf(match[1]), eol: source.includes("\r\n") ? "\r\n" : "\n" };
}
function rawField(source, key) {
  const { match, eol } = header(source);
  const lines = match[1].split(eol);
  const start = lines.findIndex(line => line.startsWith(`${key}:`));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^[ \t]+/u.test(lines[end])) end++;
  return lines.slice(start, end).join(eol);
}
function replace(source, key, block) {
  const { match, offset, eol } = header(source);
  const lines = match[1].split(eol);
  const start = lines.findIndex(line => line.startsWith(`${key}:`));
  if (start < 0) lines.push(...block);
  else {
    let end = start + 1;
    while (end < lines.length && /^[ \t]+/u.test(lines[end])) end++;
    lines.splice(start, end-start, ...block);
  }
  return source.slice(0,offset)+lines.join(eol)+source.slice(offset+match[1].length);
}
const applied = value => /^\d+\.\d+\.\d+$/u.test(value ?? "");

/** v1 requests carry no release context; v2 binds the caller-observed stage exactly like the v11 lifecycle. */
export function releaseContextOf(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) fail("invalid_bookkeeping_request");
  if (request.schema === LEGACY_REQUEST) {
    if (STAGE_FIELDS.some(key => Object.hasOwn(request, key))) fail("unexpected_release_context");
    if (Object.keys(request).some(key => !FIELDS.includes(key))) fail("invalid_bookkeeping_request");
    return null;
  }
  if (request.schema !== RELEASE_STAGE_REQUEST) fail("invalid_bookkeeping_request");
  if (Object.keys(request).some(key => ![...FIELDS, ...STAGE_FIELDS].includes(key))) fail("invalid_bookkeeping_request");
  if (STAGE_FIELDS.some(key => !Object.hasOwn(request, key))) fail("release_context_required");
  const { mode, ...context } = normalizeReleaseContext({ schema: LIFECYCLE_RELEASE_STAGE_REQUEST,
    releaseStage: request.releaseStage, releaseStageSource: request.releaseStageSource });
  return context;
}

export function updateWorkItem(source, request) {
  const context = releaseContextOf(request);
  const { releaseStage, releaseStageSource, ...rest } = request;
  const legacy = { ...rest, schema: LEGACY_REQUEST };
  const record = parseWorkBug(source, request.kind, request.id);
  // Everything except reopening an after-development record is the published v12 operation, byte for byte.
  if (request.operation !== "reopen" || !AFTER_DEVELOPMENT.includes(record.status) || !context) {
    return { ...updateWithV12(source, legacy), releaseContext: context, reopenedFrom: null };
  }
  const { kind, id, timestamp } = request;
  if (digest(source) !== request.expectedSourceRevision) fail("stale_source_revision");
  const rationale = text(request.rationale);
  if (typeof request.body !== "string" || !request.body.trim() || request.body.length > 100000 || request.body.includes("\0")) fail("invalid_issue_body");
  if (typeof timestamp !== "string" || !/^\d{4}-\d\d-\d\dT.*Z$/u.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) fail("invalid_transition_timestamp");
  // Only an unreleased pre-live record goes back to development under the same ID. Anything that
  // shipped, applied a version, or waits for release is a separate release unit.
  if (record.status !== "development_complete" || context.effectiveStage !== "pre_live"
      || applied(record.versionApplied) || applied(record.remoteVersionApplied)) fail("distinct_release_unit_required");
  const audit = { reopenedAt:timestamp, rationale, sourceRevision:request.expectedSourceRevision,
    reopenedFrom:record.status, releaseContext:context,
    originalFields:Object.fromEntries(["completion","closure","versionApplied","remoteVersionApplied","releaseMode","releaseTaskRef"].map(key=>[key,rawField(source,key)])) };
  const oldHistory = rawField(source,"reopenHistory");
  if (oldHistory && !/^reopenHistory:\r?\n(?:  - "[^\r\n]*"(?:\r?\n|$))+$/u.test(oldHistory)) fail("unsupported_reopen_history");
  const eol = header(source).eol;
  let next = replace(source,"reopenHistory",[...(oldHistory ? oldHistory.split(eol) : ["reopenHistory:"]),`  - ${JSON.stringify(JSON.stringify(audit))}`]);
  next = replace(next,"status",[`status: ${kind === "work" ? "planned" : "confirmed"}`]);
  next = replace(next,"completion",["completion: null"]);
  next = replace(next,"closure",["closure: null"]);
  const pending = record.releaseMode === "task-batch" ? "pending-task" : "pending";
  next = replace(next,"versionApplied",[`versionApplied: ${record.versionImpact === "none" ? "not-required" : pending}`]);
  next = replace(next,"remoteVersionApplied",[`remoteVersionApplied: ${record.remoteVersionImpact === "none" ? "not-required" : pending}`]);
  next = replace(next,"nextAction",[`nextAction: ${JSON.stringify(rationale)}`]);
  next = replace(next,"updatedAt",[`updatedAt: ${JSON.stringify(timestamp)}`]);
  next += `${eol}## Issue reopen${eol}${JSON.stringify({rationale,sourceRevision:request.expectedSourceRevision,timestamp,reopenedFrom:record.status,releaseContext:context})}${eol}${request.body}${eol}`;
  const after = parseWorkBug(next,kind,id);
  return { next, from:record.status, to:after.status, releaseContext:context, reopenedFrom:record.status };
}

export async function planBookkeeping({root,...request}) {
  await verifyContract();
  const baseHead = await gitBoundary(root);
  const loaded = await loadProfile(root);
  if (loaded.profile.engine !== "portable") fail("repository_settlement_required");
  const resolved = await resolveTicketPath(root,request.kind,request.id);
  const source = await readFile(resolved.target,"utf8");
  const result = updateWorkItem(source,{...request,id:resolved.id});
  const recordId = canonicalTicketId(request.kind,request.id);
  // The release context is bound into the approved digest through the operation name, as in v11.
  const operation = result.reopenedFrom
    ? `${request.kind}-reopen-${result.releaseContext.source}-pre-live`
    : `${request.kind}-${request.operation}`;
  const plan = {root,baseHead,recordId,operation,
    message:`chore(its): ${recordId} ${request.operation}`,
    reads:[{path:PROFILE_PATH,before:loaded.revision}],
    entries:[{path:resolved.relative,source,next:result.next,before:digest(source),after:digest(result.next)}]};
  await validatePlan(plan);
  return {plan,from:result.from,to:result.to,releaseContext:result.releaseContext};
}

export async function cli(argv) {
  const args = new Map();
  for (let index=0; index<argv.length; index++) {
    const key = argv[index];
    if (args.has(key)) fail("duplicate_argument");
    if (["--dry-run","--write"].includes(key)) args.set(key,true);
    else if (["--root","--request","--approved-plan-digest"].includes(key) && argv[index+1] && !argv[index+1].startsWith("--")) args.set(key,argv[++index]);
    else fail("usage_error");
  }
  if (!args.get("--root") || !args.get("--request") || Boolean(args.get("--write"))===Boolean(args.get("--dry-run"))) fail("usage_error");
  const file = path.resolve(args.get("--request")); const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size>1024*1024) fail("unsafe_request_file");
  const request = parseStrictJson(await readFile(file,"utf8"));
  releaseContextOf(request);
  const {plan,from,to,releaseContext} = await planBookkeeping({...request,root:path.resolve(args.get("--root"))});
  if (args.get("--dry-run")) return {status:"preview",from,to,releaseContext,approvalDigest:planDigest(plan),writeSet:plan.entries.map(({path,before,after})=>({path,before,after}))};
  return {...await executePlan(plan,args.get("--approved-plan-digest")),from,to,releaseContext};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {process.stdout.write(`${JSON.stringify(await cli(process.argv.slice(2)))}\n`);}
  catch(error) {process.stdout.write(`${JSON.stringify({status:"rejected",code:error.code??"bookkeeping_failed"})}\n`);process.exitCode=2;}
}
