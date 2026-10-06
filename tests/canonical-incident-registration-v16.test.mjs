import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryRoot } from "../scripts/pack-lib.mjs";
import { parseStrictIncident } from "../packs/decal-pack/src/contracts/zuz-its/v5/incident.mjs";
import { ticketRegistrationIntentDigest } from "../packs/decal-pack/src/contracts/task-work-bug/v15/registration.mjs";
import { verifyContract } from "../packs/decal-pack/src/contracts/task-work-bug/v16/verify-contract.mjs";
const source = path.join(repositoryRoot,"packs/decal-pack/src");
const fixtures=[];
function run(cmd,args,root,extra={}) {
  const env={...process.env,GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_SYSTEM:"/dev/null",GIT_CONFIG_NOSYSTEM:"1",...extra};delete env.DECAL_SESSION_ID;
  const x=spawnSync(cmd,args,{cwd:root,env,encoding:"utf8",timeout:30000});let body=null;try{body=JSON.parse(x.stdout.trim().split(/\r?\n/u).at(-1));}catch{}
  return {...x,body};
}
const git=(root,...args)=>run("git",args,root);
async function repo(){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),"work158-v16-")));fixtures.push(root);
 await cp(path.join(source,"contracts"),path.join(root,"contracts"),{recursive:true});
 await cp(path.join(source,"contracts/task-work-bug/v4/fixtures/project/docs"),path.join(root,"docs"),{recursive:true});
 await writeFile(path.join(root,"tracked.txt"),"base\n");
 for(const args of [["init","-q","-b","main"],["config","user.email","fixture@zuz.dev"],["config","user.name","v16 fixture"],["config","core.hooksPath","/dev/null"],["add","."],["commit","-qm","fixture"]])assert.equal(git(root,...args).status,0);
 return root;
}
function intent(){return {schema:"decal.zuz-its.ticket-registration-intent/v9",intentId:"fixture-canonical-incident-v16",kind:"incident",title:"Canonical registration",priority:"P1",taskRefs:["1"],versionImpact:"none",remoteVersionImpact:"none",releaseMode:"standalone",body:"## 관찰\n\n본문 status: closed 예제는 정본 헤더가 아니다.\n",incident:{impact:"major",affectedServices:["fixture-service"],classifications:["security"],occurredAt:"2026-10-06T01:00:00Z",detectedAt:"2026-10-06T01:01:00Z",mitigatedAt:null,recoveredAt:null,resolutionEvidence:[]}};}
async function cli(root,value,args){const p=path.join(root,"intent.json");await writeFile(p,JSON.stringify(value));return run(process.execPath,[path.join(root,"contracts/task-work-bug/v16/register-ticket.mjs"),"--root",root,"--intent",p,...args],root);}
function boundary(root){return {head:git(root,"rev-parse","HEAD").stdout,status:git(root,"status","--porcelain").stdout,indexBytesHash:git(root,"hash-object",".git/index").stdout};}
async function snapshot(root){const {readdir,lstat}=await import("node:fs/promises");const {createHash}=await import("node:crypto");const out={};async function walk(dir,prefix=""){for(const e of await readdir(dir,{withFileTypes:true})){if(!prefix&&e.name===".git")continue;const p=prefix?prefix+"/"+e.name:e.name;const f=path.join(dir,e.name);if(e.isDirectory()){out[p+"/"]="dir";await walk(f,p);}else if(e.isSymbolicLink())out[p]="symlink";else out[p]=createHash("sha256").update(await readFile(f)).digest("hex");}}await walk(root);return out;}

test("v16 verifies its actual pinned v15 and v5 dependency closure",async()=>{assert.equal((await verifyContract()).scope,"incident-only");});
test("installed v16 nested intent registers canonical bytes then actual v5 transitions twice and replays exactly",async()=>{
 const root=await repo();const v=intent();const preview=await cli(root,v,["--dry-run"]);assert.equal(preview.status,0,JSON.stringify(preview.body));assert.equal(preview.body.intentDigest,ticketRegistrationIntentDigest(v));assert.equal(preview.body.identityPending,true);
 await writeFile(path.join(root,"tracked.txt"),"foreign dirty preserved\n");const written=await cli(root,v,["--approved-digest",preview.body.intentDigest,"--write"]);assert.equal(written.status,0,JSON.stringify(written.body));assert.equal(written.body.assigned.id,"INC-1");assert.deepEqual(written.body.writeSet,["docs/work-items/incidents/INC-1.md"]);assert.equal(git(root,"show","--pretty=format:","--name-only","HEAD").stdout.trim(),written.body.assigned.path);
 const p=path.join(root,written.body.assigned.path);let bytes=await readFile(p,"utf8");const body=bytes.slice(bytes.indexOf("\n---\n")+5);let parsed=parseStrictIncident(bytes,"INC-1.md");assert.equal(parsed.impact,v.incident.impact);assert.deepEqual(parsed.affectedServices,v.incident.affectedServices);assert.deepEqual(parsed.classifications,v.incident.classifications);assert.equal(parsed.mitigatedAt,null);assert.equal(parsed.recoveredAt,null);assert.doesNotMatch(bytes,/^incident:/mu);assert.match(bytes,/^issueKind: incident$/mu);
 for(const status of ["confirmed","in_progress"]){const x=run(process.execPath,[path.join(root,"contracts/zuz-its/v5/transition-incident.mjs"),"--root",root,"--id","INC-1","--status",status,"--expected-source-revision",parsed.revision],root);assert.equal(x.status,0,JSON.stringify(x.body));bytes=await readFile(p,"utf8");parsed=parseStrictIncident(bytes,"INC-1.md");assert.equal(parsed.status,status);assert.equal(bytes.slice(bytes.indexOf("\n---\n")+5),body);}
 const before=boundary(root),sha=await readFile(p);const replay=await cli(root,v,["--approved-digest",preview.body.intentDigest,"--write"]);assert.equal(replay.status,0,JSON.stringify(replay.body));assert.equal(replay.body.status,"replayed");assert.deepEqual(boundary(root),before);assert.deepEqual(await readFile(p),sha);assert.equal(await readFile(path.join(root,"tracked.txt"),"utf8"),"foreign dirty preserved\n");
});
const invalids=[
 ["empty impact",v=>v.incident.impact=""],["unsupported impact",v=>v.incident.impact="invalid"],
 ["bad classification",v=>v.incident.classifications=["unknown"]],["empty services",v=>v.incident.affectedServices=[]],
 ["duplicate services",v=>v.incident.affectedServices=["a","a"]],["invalid date",v=>v.incident.occurredAt="yesterday"],
 ["invalid calendar date",v=>v.incident.occurredAt="2026-02-31T01:00:00Z"],["empty optional timestamp",v=>v.incident.mitigatedAt=""],
 ["reverse dates",v=>v.incident.detectedAt="2026-10-06T00:00:00Z"],["unknown nested field",v=>v.incident.actor="unknown"],
 ["unknown top field",v=>v.extra="unknown"],["nonIncident kind",v=>v.kind="work"]
];
for(const [name,modify]of invalids)test(`v16 ${name} rejects before directories, journal, lock, record or HEAD mutation`,async()=>{
 const root=await repo();const v=intent();modify(v);const p=path.join(root,"intent.json");await writeFile(p,JSON.stringify(v));const before=boundary(root),tree=await snapshot(root);
 const args=[path.join(root,"contracts/task-work-bug/v16/register-ticket.mjs"),"--root",root,"--intent",p];
 for(const end of [["--dry-run"],["--approved-digest","sha256:"+"a".repeat(64),"--write"]]){const x=run(process.execPath,[...args,...end],root);assert.equal(x.status,2,JSON.stringify(x.body));assert.deepEqual(boundary(root),before);assert.deepEqual(await snapshot(root),tree);}
});
test("v16 accepts all canonical impact values and absent optional times without changing nested semantic digest",async()=>{
 const root=await repo();for(const impact of ["critical","major","minor","degraded"]){const v=intent();v.incident.impact=impact;v.incident.classifications=[];delete v.incident.mitigatedAt;delete v.incident.recoveredAt;const x=await cli(root,v,["--dry-run"]);assert.equal(x.status,0,JSON.stringify(x.body));assert.equal(x.body.intentDigest,ticketRegistrationIntentDigest(v));}
});
test("v16 rejects old noncanonical v15 replay and preserves both old bytes and pending journal",async()=>{
 const root=await repo();const v=intent();const p=path.join(root,"intent.json");await writeFile(p,JSON.stringify(v));const oldCli=path.join(root,"contracts/task-work-bug/v15/register-ticket.mjs");const preview=run(process.execPath,[oldCli,"--root",root,"--intent",p,"--dry-run"],root);const old=run(process.execPath,[oldCli,"--root",root,"--intent",p,"--approved-digest",preview.body.intentDigest,"--write"],root);assert.equal(old.status,0);const record=await readFile(path.join(root,old.body.assigned.path));
 await writeFile(path.join(root,".decal/its-ticket-registration-pending-v1.json"),JSON.stringify({schema:"decal.zuz-its.ticket-registration-journal/v1",phase:"sealed",intentDigest:preview.body.intentDigest,baseHead:old.body.baseHead,path:old.body.assigned.path,afterDigest:"sha256:"+(await import("node:crypto")).createHash("sha256").update(record).digest("hex")}));
 const before=boundary(root),tree=await snapshot(root);const x=await cli(root,v,["--approved-digest",preview.body.intentDigest,"--write"]);assert.equal(x.status,2);assert.equal(x.body.code,"missing_frontmatter_field");assert.deepEqual(boundary(root),before);assert.deepEqual(await snapshot(root),tree);
});
test("v16 dependency drift fails before invoking legacy imported writer or parser",async()=>{
 const root=await repo();const v=intent();const f=path.join(root,"contracts/zuz-its/v5/incident.mjs");await writeFile(f,(await readFile(f,"utf8"))+"\n// drift\n");const p=path.join(root,"intent.json");await writeFile(p,JSON.stringify(v));const before=boundary(root),tree=await snapshot(root);const x=await cli(root,v,["--dry-run"]);assert.equal(x.status,2);assert.equal(x.body.code,"contract_dependency_mismatch");assert.deepEqual(boundary(root),before);assert.deepEqual(await snapshot(root),tree);
});
test("v16 wrong digest refuses mutation",async()=>{
 const root=await repo(),v=intent();await cli(root,v,["--dry-run"]);const before=boundary(root),tree=await snapshot(root);const x=await cli(root,v,["--approved-digest","sha256:"+"a".repeat(64),"--write"]);assert.equal(x.status,2);assert.equal(x.body.code,"approval_digest_mismatch");assert.deepEqual(boundary(root),before);assert.deepEqual(await snapshot(root),tree);
});
test("v16 duplicate JSON keys and direct Native host reject without mutation",async()=>{
 const root=await repo();const v=intent(),p=path.join(root,"intent.json");await writeFile(p,JSON.stringify(v).replace('"impact":"major"','"impact":"major","impact":"minor"'));const before=boundary(root),tree=await snapshot(root);const x=run(process.execPath,[path.join(root,"contracts/task-work-bug/v16/register-ticket.mjs"),"--root",root,"--intent",p,"--dry-run"],root);assert.equal(x.status,2);assert.equal(x.body.code,"ambiguous_json_source");assert.deepEqual(boundary(root),before);assert.deepEqual(await snapshot(root),tree);
 await writeFile(p,JSON.stringify(v));const tree2=await snapshot(root);const y=spawnSync(process.execPath,[path.join(root,"contracts/task-work-bug/v16/register-ticket.mjs"),"--root",root,"--intent",p,"--dry-run"],{cwd:root,encoding:"utf8",timeout:30000,env:{...process.env,DECAL_SESSION_ID:"fixture-native-host"}});assert.equal(y.status,2);assert.match(y.stdout,/native_writer_required/);assert.deepEqual(await snapshot(root),tree2);
});
test("v16 existing invalid Incident blocks new registration without changing old record",async()=>{
 const root=await repo();const v=intent();const oldCli=path.join(root,"contracts/task-work-bug/v15/register-ticket.mjs");const p=path.join(root,"intent.json");await writeFile(p,JSON.stringify(v));const preview=run(process.execPath,[oldCli,"--root",root,"--intent",p,"--dry-run"],root);const old=run(process.execPath,[oldCli,"--root",root,"--intent",p,"--approved-digest",preview.body.intentDigest,"--write"],root);assert.equal(old.status,0);v.intentId="fixture-v16-second-incident";const first=await cli(root,v,["--dry-run"]);assert.equal(first.status,0);const before=boundary(root),tree=await snapshot(root);const x=await cli(root,v,["--approved-digest",first.body.intentDigest,"--write"]);assert.equal(x.status,2);assert.equal(x.body.code,"missing_frontmatter_field");assert.deepEqual(boundary(root),before);assert.deepEqual(await snapshot(root),tree);
});
test("v16 mixed timestamp precision rejects a real reversal before mutation",async()=>{
 const root=await repo(),v=intent();v.incident.occurredAt="2026-10-06T01:00:00.500Z";v.incident.detectedAt="2026-10-06T01:00:00Z";const p=path.join(root,"intent.json");await writeFile(p,JSON.stringify(v));const before=boundary(root),tree=await snapshot(root);const x=await cli(root,v,["--dry-run"]);assert.equal(x.status,2);assert.deepEqual(boundary(root),before);assert.deepEqual(await snapshot(root),tree);
});
test("v16 accepts chronological mixed timestamp precision without losing exact instant or semantic digest",async()=>{
 const root=await repo(),v=intent();v.incident.occurredAt="2026-10-06T01:00:00Z";v.incident.detectedAt="2026-10-06T01:00:00.5001Z";const x=await cli(root,v,["--dry-run"]);assert.equal(x.status,0,JSON.stringify(x.body));assert.equal(x.body.intentDigest,ticketRegistrationIntentDigest(v));const y=await cli(root,v,["--approved-digest",x.body.intentDigest,"--write"]);assert.equal(y.status,0,JSON.stringify(y.body));const src=await readFile(path.join(root,y.body.assigned.path),"utf8");const record=parseStrictIncident(src,"INC-1.md");assert.equal(record.occurredAt,"2026-10-06T01:00:00.0000Z");assert.equal(record.detectedAt,"2026-10-06T01:00:00.5001Z");
});
test("v16 submillisecond mitigation and recovery reversal rejects before mutation",async()=>{
 const root=await repo(),v=intent();v.incident.detectedAt="2026-10-06T01:00:00.5002Z";v.incident.mitigatedAt="2026-10-06T01:00:00.5001Z";const x=await cli(root,v,["--dry-run"]);assert.equal(x.status,2);v.incident.mitigatedAt="2026-10-06T01:00:00.5002Z";v.incident.recoveredAt="2026-10-06T01:00:00.5001Z";const y=await cli(root,v,["--dry-run"]);assert.equal(y.status,2);
});
for(const [kind,prefix] of [["work","WORK"],["bugs","BUG"]])for(const exists of [false,true])test(`v16 preserves foreign ${prefix} journal when target is ${exists?"present":"absent"}`,async()=>{
 const root=await repo(),v=intent();const preview=await cli(root,v,["--dry-run"]);assert.equal(preview.status,0);const foreign=`docs/work-items/${kind}/${prefix}-77.md`;const bytes="---\nschema: decal.task-work-bug.work-document\nschemaVersion: 1\nid: WORK-77\ntitle: foreign\nstatus: new\n---\n\n## 보호\n";if(exists){await mkdir(path.dirname(path.join(root,foreign)),{recursive:true});await writeFile(path.join(root,foreign),bytes);}await mkdir(path.join(root,".decal"),{recursive:true});await writeFile(path.join(root,".decal/its-ticket-registration-pending-v1.json"),JSON.stringify({schema:"decal.zuz-its.ticket-registration-journal/v1",phase:"prepared",intentDigest:"sha256:"+"b".repeat(64),baseHead:git(root,"rev-parse","HEAD").stdout.trim(),path:foreign,afterDigest:"sha256:"+(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")}));const before=boundary(root),tree=await snapshot(root);const x=await cli(root,v,["--approved-digest",preview.body.intentDigest,"--write"]);assert.equal(x.status,2);assert.deepEqual(boundary(root),before);assert.deepEqual(await snapshot(root),tree);
});
test("v16 refuses a foreign Work commit bearing the incoming Incident digest",async()=>{
 const root=await repo(),v=intent(),preview=await cli(root,v,["--dry-run"]);assert.equal(preview.status,0);const foreign="docs/work-items/work/WORK-77.md";await mkdir(path.dirname(path.join(root,foreign)),{recursive:true});await writeFile(path.join(root,foreign),"foreign work bytes\n");assert.equal(git(root,"add","--",foreign).status,0);assert.equal(git(root,"commit","-qm",`foreign fixture\n\nDecal-ITS-Registration-Intent: ${preview.body.intentDigest}`).status,0);const before=boundary(root),tree=await snapshot(root);const x=await cli(root,v,["--approved-digest",preview.body.intentDigest,"--write"]);assert.equal(x.status,2);assert.equal(x.body.code,"invalid_replay_commit");assert.deepEqual(boundary(root),before);assert.deepEqual(await snapshot(root),tree);
});
test.after(()=>console.log("v16 synthetic fixtures preserved",JSON.stringify(fixtures)));
