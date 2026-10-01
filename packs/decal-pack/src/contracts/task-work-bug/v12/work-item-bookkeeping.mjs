#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, fail, loadProfile, PROFILE_PATH } from "../v9/version-profile.mjs";
import { executePlan, gitBoundary, planDigest, validatePlan } from "../v9/transaction.mjs";
import { parseWorkBug } from "../v9/work-bug-policy.mjs";
import { parseStrictJson } from "../v9/strict-json.mjs";
import { canonicalTicketId, resolveTicketPath } from "../v9/ticket-path.mjs";
import { verifyContract } from "./verify-contract.mjs";

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
export function updateWorkItem(source, request) {
  const allowed = ["schema","kind","id","operation","expectedSourceRevision","timestamp","rationale","body"];
  if (!request || request.schema !== "zuz.its.work-item-bookkeeping-request/v1"
      || Object.keys(request).some(key => !allowed.includes(key))
      || !["reuse","reopen"].includes(request.operation)) fail("invalid_bookkeeping_request");
  const {kind,id,operation,timestamp} = request;
  const record = parseWorkBug(source,kind,id);
  if (digest(source) !== request.expectedSourceRevision) fail("stale_source_revision");
  const rationale = text(request.rationale);
  if (typeof request.body !== "string" || !request.body.trim() || request.body.length > 100000 || request.body.includes("\0")) fail("invalid_issue_body");
  if (typeof timestamp !== "string" || !/^\d{4}-\d\d-\d\dT.*Z$/u.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) fail("invalid_transition_timestamp");
  let next = source;
  if (operation === "reuse") {
    if (!["new","planned","confirmed","in_progress","blocked"].includes(record.status)) fail("distinct_release_unit_required");
  } else {
    if (record.status !== "closed" || record.reason !== (kind === "work" ? "completed" : "fixed")) fail("reopen_not_allowed");
    const applied = value => /^\d+\.\d+\.\d+$/u.test(value);
    if (record.releaseMode === "task-batch" && (applied(record.versionApplied) || applied(record.remoteVersionApplied))) fail("distinct_release_unit_required");
    // Store original field bytes rather than reserializing unknown historical YAML.
    const audit = { reopenedAt:timestamp, rationale, sourceRevision:request.expectedSourceRevision,
      originalFields:Object.fromEntries(["completion","closure","versionApplied","remoteVersionApplied","releaseMode","releaseTaskRef"].map(key=>[key,rawField(source,key)])) };
    const oldHistory=rawField(source,"reopenHistory");
    if (oldHistory && !/^reopenHistory:\r?\n(?:  - "[^\r\n]*"(?:\r?\n|$))+$/u.test(oldHistory)) fail("unsupported_reopen_history");
    next=replace(next,"reopenHistory",[...(oldHistory ? oldHistory.split(header(source).eol) : ["reopenHistory:"]),`  - ${JSON.stringify(JSON.stringify(audit))}`]);
    next=replace(next,"status",[`status: ${kind === "work" ? "planned" : "confirmed"}`]);
    next=replace(next,"completion",["completion: null"]);
    next=replace(next,"closure",["closure: null"]);
    const pending=record.releaseMode === "task-batch" ? "pending-task" : "pending";
    next=replace(next,"versionApplied",[`versionApplied: ${record.versionImpact === "none" ? "not-required" : pending}`]);
    next=replace(next,"remoteVersionApplied",[`remoteVersionApplied: ${record.remoteVersionImpact === "none" ? "not-required" : pending}`]);
    next=replace(next,"nextAction",[`nextAction: ${JSON.stringify(rationale)}`]);
  }
  next=replace(next,"updatedAt",[`updatedAt: ${JSON.stringify(timestamp)}`]);
  const eol=header(source).eol;
  next+=`${eol}## Issue ${operation}${eol}${JSON.stringify({rationale,sourceRevision:request.expectedSourceRevision,timestamp})}${eol}${request.body}${eol}`;
  const after=parseWorkBug(next,kind,id);
  return {next,from:record.status,to:after.status};
}
export async function planBookkeeping({root,...request}) {
  await verifyContract();
  const baseHead=await gitBoundary(root);
  const loaded=await loadProfile(root);
  if(loaded.profile.engine!=="portable") fail("repository_settlement_required");
  const resolved=await resolveTicketPath(root,request.kind,request.id);
  const source=await readFile(resolved.target,"utf8");
  const result=updateWorkItem(source,{...request,id:resolved.id});
  const plan={root,baseHead,recordId:canonicalTicketId(request.kind,request.id),operation:`${request.kind}-${request.operation}`,
    message:`chore(its): ${canonicalTicketId(request.kind,request.id)} ${request.operation}`,
    reads:[{path:PROFILE_PATH,before:loaded.revision}],
    entries:[{path:resolved.relative,source,next:result.next,before:digest(source),after:digest(result.next)}]};
  await validatePlan(plan);
  return {plan,from:result.from,to:result.to};
}
export async function cli(argv) {
  const args=new Map();
  for(let index=0;index<argv.length;index++) {
    const key=argv[index];
    if(args.has(key)) fail("duplicate_argument");
    if(["--dry-run","--write"].includes(key)) args.set(key,true);
    else if(["--root","--request","--approved-plan-digest"].includes(key) && argv[index+1] && !argv[index+1].startsWith("--")) args.set(key,argv[++index]);
    else fail("usage_error");
  }
  if(!args.get("--root") || !args.get("--request") || Boolean(args.get("--write"))===Boolean(args.get("--dry-run"))) fail("usage_error");
  const file=path.resolve(args.get("--request")); const stat=await lstat(file);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>1024*1024) fail("unsafe_request_file");
  const request=parseStrictJson(await readFile(file,"utf8"));
  if (!request || Object.keys(request).some(key => !["schema","kind","id","operation","expectedSourceRevision","timestamp","rationale","body"].includes(key))) fail("invalid_bookkeeping_request");
  const {plan,from,to}=await planBookkeeping({root:path.resolve(args.get("--root")),...request});
  if(args.get("--dry-run")) return {status:"preview",from,to,approvalDigest:planDigest(plan),writeSet:plan.entries.map(({path,before,after})=>({path,before,after}))};
  return {...await executePlan(plan,args.get("--approved-plan-digest")),from,to};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {process.stdout.write(`${JSON.stringify(await cli(process.argv.slice(2)))}\n`);}
  catch(error) {process.stdout.write(`${JSON.stringify({status:"rejected",code:error.code??"bookkeeping_failed"})}\n`);process.exitCode=2;}
}
