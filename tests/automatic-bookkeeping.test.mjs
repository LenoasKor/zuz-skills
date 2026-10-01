import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,realpath} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {updateWorkItem,planBookkeeping,cli} from "../packs/decal-pack/src/contracts/task-work-bug/v12/work-item-bookkeeping.mjs";
import {digest} from "../packs/decal-pack/src/contracts/task-work-bug/v9/version-profile.mjs";
import {git,executePlan,planDigest} from "../packs/decal-pack/src/contracts/task-work-bug/v9/transaction.mjs";
const timestamp="2026-10-01T12:00:00.000Z";
function source(kind,status="closed") {
 const id=kind==="work"?"WORK-001":"BUG-001";
 return ["---",`schema: decal.task-work-bug.${kind==="work"?"work-document":"bug-card"}`,"schemaVersion: 1",`id: ${id}`,`status: ${status}`,
 "versionImpact: desktop-patch","remoteVersionImpact: remote-patch","releaseMode: standalone","releaseTaskRef: null","versionApplied: 1.2.3","remoteVersionApplied: 2.3.4","taskRefs: []",
 `createdAt: "${timestamp}"`,`updatedAt: "${timestamp}"`,"completion:","  summary: old completion","  evidence:","    - old verification",`  completedAt: "${timestamp}"`,"closure:",`  reason: ${kind==="work"?"completed":"fixed"}`,`  closedAt: "${timestamp}"`,"unknownOwner: preserved","---","","## Existing body","Keep this original content.",""].join("\r\n");
}
function request(kind,source,operation="reopen") {return {schema:"zuz.its.work-item-bookkeeping-request/v1",kind,id:kind==="work"?"WORK-001":"BUG-001",operation,expectedSourceRevision:digest(source),timestamp,rationale:"same cause and fix scope",body:"Additional correction and evidence."};}
for(const kind of ["work","bug"]) {
 test(`${kind}: reopen keeps identity, unknown fields, both historical versions and evidence`,()=>{
  const old=source(kind), next=updateWorkItem(old,request(kind,old)).next;
  assert.match(next,new RegExp(`status: ${kind==="work"?"planned":"confirmed"}`));
  assert.match(next,/unknownOwner: preserved\r\n/);assert.match(next,/createdAt: "2026-10-01T12:00:00.000Z"/);
  assert.match(next,/versionApplied: pending\r\n/);assert.match(next,/remoteVersionApplied: pending\r\n/);
  const archiveLine=next.split("\r\n").find(line=>line.startsWith('  - "{'));
  const archive=JSON.parse(JSON.parse(archiveLine.slice(4)));
  assert.match(archive.originalFields.completion,/old verification/);
  assert.equal(archive.originalFields.versionApplied,"versionApplied: 1.2.3");assert.equal(archive.originalFields.remoteVersionApplied,"remoteVersionApplied: 2.3.4");
  assert.ok(next.includes("## Existing body\r\nKeep this original content."));
  const reused=updateWorkItem(next,request(kind,next,"reuse")).next;
  assert.ok(reused.includes(archiveLine));assert.equal(reused.split("## Issue reuse").length,2);
 });
 test(`${kind}: refuses duplicate closure, stale source, post-completion reuse and settled task-batch`,()=>{
  for(const [old,operation,code] of [[source(kind).replace(kind==="work"?"reason: completed":"reason: fixed","reason: duplicate"),"reopen","reopen_not_allowed"],
   [source(kind,"development_complete"),"reuse","distinct_release_unit_required"],
   [source(kind).replace("releaseMode: standalone","releaseMode: task-batch").replace("releaseTaskRef: null","releaseTaskRef: 1").replace("taskRefs: []","taskRefs:\r\n  - 1"),"reopen","distinct_release_unit_required"]]) {
   assert.throws(()=>updateWorkItem(old,request(kind,old,operation)),e=>e.code===code);
  }
  const old=source(kind),input=request(kind,old);input.expectedSourceRevision=digest("changed");
  assert.throws(()=>updateWorkItem(old,input),e=>e.code==="stale_source_revision");
  assert.throws(()=>updateWorkItem(old,{...request(kind,old),versionImpact:"none"}),e=>e.code==="invalid_bookkeeping_request");
 });
 test(`${kind}: portable exact transaction commits only the record and preserves unrelated dirty files`,async()=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),"its-bookkeeping-")));
  await mkdir(path.join(root,".decal"));
  await writeFile(path.join(root,".decal/settlement-profile.json"),JSON.stringify({schema:"zuz.its.settlement-profile/v1",engine:"portable",channels:{desktop:"app",remote:"mobile"},products:[{id:"app",files:[{path:"package.json",format:"json",pointers:["/version"]}]},{id:"mobile",files:[{path:"remote.json",format:"json",pointers:["/version"]}]}]}));
  await writeFile(path.join(root,"remote.json"),'{"version":"2.3.4"}\n');
  await writeFile(path.join(root,"package.json"),'{"version":"1.2.3"}\n');
  const old=source(kind),input=request(kind,old),rel=`docs/work-items/${kind==="work"?"work":"bugs"}/${input.id}.md`;
  await mkdir(path.dirname(path.join(root,rel)),{recursive:true});await writeFile(path.join(root,rel),old);await writeFile(path.join(root,"unrelated"),"original");
  await git(root,["init","-b","main"]);await git(root,["config","user.name","Fixture"]);await git(root,["config","user.email","fixture@example.invalid"]);await git(root,["add","."]);await git(root,["commit","-m","fixture"]);
  await writeFile(path.join(root,"unrelated"),"other owner");
  const {plan}=await planBookkeeping({root,...input});
  const result=await executePlan(plan,planDigest(plan));assert.equal(result.state,"committed");
  assert.equal((await git(root,["diff-tree","--no-commit-id","--name-only","-r","HEAD"])).trim(),rel);
  assert.equal(await readFile(path.join(root,"unrelated"),"utf8"),"other owner");assert.equal(JSON.parse(await readFile(path.join(root,"package.json"),"utf8")).version,"1.2.3");
  const reused=await readFile(path.join(root,rel),"utf8");const prepared=await planBookkeeping({root,...request(kind,reused,"reuse")});
  await writeFile(path.join(root,rel),reused+"concurrent edit");
  await assert.rejects(executePlan(prepared.plan,planDigest(prepared.plan)),e=>e.code === "stale_source");
 });
}
test("CLI rejects request root/path authority overrides before project access",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"its-bookkeeping-input-")),file=path.join(dir,"request.json");
 await writeFile(file,JSON.stringify({...request("work",source("work")),root:"/unapproved"}));
 await assert.rejects(cli(["--root",dir,"--request",file,"--dry-run"]),e=>e.code==="invalid_bookkeeping_request");
});
