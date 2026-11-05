import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,realpath} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {updateWorkItem,planBookkeeping,cli} from "../packs/decal-pack/src/contracts/task-work-bug/v29/work-item-bookkeeping.mjs";
import {verifyContract} from "../packs/decal-pack/src/contracts/task-work-bug/v29/verify-contract.mjs";
import * as v12 from "../packs/decal-pack/src/contracts/task-work-bug/v12/work-item-bookkeeping.mjs";
import {digest} from "../packs/decal-pack/src/contracts/task-work-bug/v9/version-profile.mjs";
import {git,executePlan,planDigest} from "../packs/decal-pack/src/contracts/task-work-bug/v9/transaction.mjs";

const timestamp="2026-11-05T12:00:00.000Z";
const id=kind=>kind==="work"?"WORK-001":"BUG-001";
const UNRELEASED={versionImpact:"desktop-patch",remoteVersionImpact:"none",releaseMode:"standalone",releaseTaskRef:"null",versionApplied:"pending",remoteVersionApplied:"not-required",taskRefs:"taskRefs: []"};
function source(kind,status,fields=UNRELEASED,closure=null) {
  return ["---",`schema: decal.task-work-bug.${kind==="work"?"work-document":"bug-card"}`,"schemaVersion: 1",`id: ${id(kind)}`,`status: ${status}`,
    `versionImpact: ${fields.versionImpact}`,`remoteVersionImpact: ${fields.remoteVersionImpact}`,`releaseMode: ${fields.releaseMode}`,`releaseTaskRef: ${fields.releaseTaskRef}`,
    `versionApplied: ${fields.versionApplied}`,`remoteVersionApplied: ${fields.remoteVersionApplied}`,fields.taskRefs,
    `createdAt: "${timestamp}"`,`updatedAt: "${timestamp}"`,"completion:","  summary: Verified on macOS only","  evidence:","    - macOS transfer passed","    - \"unverified: Windows\"",`  completedAt: "${timestamp}"`,
    ...(closure ? ["closure:",`  reason: ${closure}`,`  closedAt: "${timestamp}"`] : ["closure: null"]),
    "unknownOwner: preserved","---","","## Existing body","Keep this original content.",""].join("\n");
}
const stage=(releaseStage="pre_live",releaseStageSource="stored")=>({releaseStage,releaseStageSource});
function request(kind,old,operation="reopen",context=stage()) {
  return {schema:context?"zuz.its.work-item-bookkeeping-request/v2":"zuz.its.work-item-bookkeeping-request/v1",kind,id:id(kind),operation,
    expectedSourceRevision:digest(old),timestamp,rationale:"Windows CI failed the same completion criteria before release",body:"Windows transfer expired after nine minutes.",...(context??{})};
}
const archive=next=>JSON.parse(JSON.parse(next.split("\n").find(line=>line.startsWith('  - "{')).slice(4)));

test("v29 contract verifies with its published v9, v11 and v12 dependencies",async()=>{
  assert.equal((await verifyContract()).schema,"decal.task-work-bug.fixture-manifest/v29");
});

for (const kind of ["work","bug"]) {
  test(`${kind}: pre-live unreleased development_complete reopens and archives the original cycle`,()=>{
    for (const context of [stage(), stage(null,"defaulted"), stage("unset","defaulted")]) {
      const old=source(kind,"development_complete");
      const result=updateWorkItem(old,request(kind,old,"reopen",context));
      assert.equal(result.from,"development_complete");
      assert.equal(result.to,kind==="work"?"planned":"confirmed");
      assert.equal(result.releaseContext.effectiveStage,"pre_live");
      assert.match(result.next,/^completion: null$/mu);assert.match(result.next,/^closure: null$/mu);
      assert.match(result.next,/^versionApplied: pending$/mu);assert.match(result.next,/^remoteVersionApplied: not-required$/mu);
      assert.match(result.next,/^unknownOwner: preserved$/mu);assert.match(result.next,/^nextAction: "Windows CI failed/mu);
      const cycle=archive(result.next);
      assert.equal(cycle.reopenedFrom,"development_complete");
      assert.equal(cycle.releaseContext.source,context.releaseStageSource);
      assert.equal(cycle.rationale,"Windows CI failed the same completion criteria before release");
      // Original field bytes, not a reserialization.
      assert.equal(cycle.originalFields.completion,old.split("\n").slice(14,20).join("\n"));
      assert.equal(cycle.originalFields.closure,"closure: null");
      assert.equal(cycle.originalFields.versionApplied,"versionApplied: pending");
      assert.ok(result.next.includes("## Existing body\nKeep this original content."));
      assert.ok(result.next.includes("Windows transfer expired after nine minutes."));
      // A second cycle appends to the same history.
      const reclosed=result.next.replace(/^status: \w+$/mu,"status: development_complete").replace("completion: null","completion:\n  summary: second\n  evidence:\n    - again\n  completedAt: \"2026-11-06T00:00:00.000Z\"");
      const again=updateWorkItem(reclosed,{...request(kind,reclosed),timestamp:"2026-11-06T01:00:00.000Z"}).next;
      assert.equal(again.split("\n").filter(line=>line.startsWith('  - "{')).length,2);
    }
  });

  test(`${kind}: released, applied, release_ready and settled task-batch records stay separate release units`,()=>{
    const appliedDesktop={...UNRELEASED,versionApplied:"1.2.3"};
    const appliedRemote={...UNRELEASED,remoteVersionImpact:"remote-patch",remoteVersionApplied:"2.3.4"};
    const settledBatch={versionImpact:"desktop-patch",remoteVersionImpact:"remote-patch",releaseMode:"task-batch",releaseTaskRef:"7",versionApplied:"pending-task",remoteVersionApplied:"2.3.4",taskRefs:"taskRefs:\n  - 7"};
    const cases=[
      [source(kind,"development_complete"),stage("live"),"distinct_release_unit_required"],
      [source(kind,"development_complete",appliedDesktop),stage(),"distinct_release_unit_required"],
      [source(kind,"development_complete",appliedRemote),stage(),"distinct_release_unit_required"],
      [source(kind,"development_complete",settledBatch),stage(),"distinct_release_unit_required"],
      [source(kind,"release_ready"),stage(),"distinct_release_unit_required"],
      [source(kind,"release_ready"),stage("live"),"distinct_release_unit_required"],
      // Without a release context the published v12 rule applies.
      [source(kind,"development_complete"),null,"reopen_not_allowed"],
    ];
    for (const [old,context,code] of cases) assert.throws(()=>updateWorkItem(old,request(kind,old,"reopen",context)),e=>e.code===code,`${context?.releaseStage} ${code}`);
    for (const context of [stage(), null]) {
      const old=source(kind,"development_complete");
      assert.throws(()=>updateWorkItem(old,request(kind,old,"reuse",context)),e=>e.code==="distinct_release_unit_required");
    }
  });

  test(`${kind}: invalid release context, stale source and missing rationale fail closed`,()=>{
    const old=source(kind,"development_complete");
    for (const context of [stage("staging"),stage("pre_live","defaulted"),stage(null,"stored"),stage("live","guessed")]) {
      assert.throws(()=>updateWorkItem(old,request(kind,old,"reopen",context)),e=>e.code==="invalid_release_context");
    }
    const {releaseStage,...missing}=request(kind,old);
    assert.throws(()=>updateWorkItem(old,missing),e=>e.code==="release_context_required");
    assert.throws(()=>updateWorkItem(old,{...request(kind,old,"reopen",null),releaseStage:"pre_live"}),e=>e.code==="unexpected_release_context");
    assert.throws(()=>updateWorkItem(old,{...request(kind,old),expectedSourceRevision:digest("changed")}),e=>e.code==="stale_source_revision");
    assert.throws(()=>updateWorkItem(old,{...request(kind,old),rationale:"  "}),e=>e.code==="invalid_issue_review");
    assert.throws(()=>updateWorkItem(old,{...request(kind,old),versionApplied:"pending"}),e=>e.code==="invalid_bookkeeping_request");
  });

  test(`${kind}: v1 requests and closed reopen stay byte-identical to v12`,()=>{
    const closed=source(kind,"closed",{...UNRELEASED,versionApplied:"1.2.3"},kind==="work"?"completed":"fixed");
    for (const context of [null, stage("live")]) {
      const input=request(kind,closed,"reopen",context);
      const legacy=request(kind,closed,"reopen",null);
      assert.equal(updateWorkItem(closed,input).next,v12.updateWorkItem(closed,legacy).next);
    }
    const open=source(kind,"in_progress");
    assert.equal(updateWorkItem(open,request(kind,open,"reuse",null)).next,v12.updateWorkItem(open,request(kind,open,"reuse",null)).next);
  });
}

async function fixture(kind,old) {
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),"its-bookkeeping-v29-")));
  await mkdir(path.join(root,".decal"));
  await writeFile(path.join(root,".decal/settlement-profile.json"),JSON.stringify({schema:"zuz.its.settlement-profile/v1",engine:"portable",channels:{desktop:"app",remote:"mobile"},products:[{id:"app",files:[{path:"package.json",format:"json",pointers:["/version"]}]},{id:"mobile",files:[{path:"remote.json",format:"json",pointers:["/version"]}]}]}));
  await writeFile(path.join(root,"remote.json"),'{"version":"2.3.4"}\n');
  await writeFile(path.join(root,"package.json"),'{"version":"1.2.3"}\n');
  const rel=`docs/work-items/${kind==="work"?"work":"bugs"}/${id(kind)}.md`;
  await mkdir(path.dirname(path.join(root,rel)),{recursive:true});await writeFile(path.join(root,rel),old);await writeFile(path.join(root,"unrelated"),"original");
  await git(root,["init","-b","main"]);await git(root,["config","core.autocrlf","false"]);await git(root,["config","user.name","Fixture"]);await git(root,["config","user.email","fixture@example.invalid"]);await git(root,["add","."]);await git(root,["commit","-m","fixture"]);
  return {root,rel};
}

test("pre-live reopen commits exactly the record and binds the release context to the digest",async()=>{
  const old=source("bug","development_complete");
  const {root,rel}=await fixture("bug",old);
  await writeFile(path.join(root,"unrelated"),"other owner");
  const stored=await planBookkeeping({root,...request("bug",old)});
  const defaulted=await planBookkeeping({root,...request("bug",old,"reopen",stage(null,"defaulted"))});
  assert.equal(stored.plan.operation,"bug-reopen-stored-pre-live");
  assert.equal(defaulted.plan.operation,"bug-reopen-defaulted-pre-live");
  assert.notEqual(planDigest(stored.plan),planDigest(defaulted.plan));
  const result=await executePlan(stored.plan,planDigest(stored.plan));assert.equal(result.state,"committed");
  assert.equal((await git(root,["diff-tree","--no-commit-id","--name-only","-r","HEAD"])).trim(),rel);
  assert.match(await readFile(path.join(root,rel),"utf8"),/^status: confirmed$/mu);
  assert.equal(await readFile(path.join(root,"unrelated"),"utf8"),"other owner");
});

test("v1 requests produce the same approval digest as v12",async()=>{
  const old=source("work","closed",UNRELEASED,"completed");
  const {root}=await fixture("work",old);
  const input=request("work",old,"reopen",null);
  assert.equal(planDigest((await planBookkeeping({root,...input})).plan),planDigest((await v12.planBookkeeping({root,...input})).plan));
});

test("CLI previews a pre-live reopen and rejects unknown fields before project access",async()=>{
  const old=source("work","development_complete");
  const {root}=await fixture("work",old);
  const dir=await mkdtemp(path.join(os.tmpdir(),"its-bookkeeping-v29-input-")),file=path.join(dir,"request.json");
  await writeFile(file,JSON.stringify(request("work",old)));
  const preview=await cli(["--root",root,"--request",file,"--dry-run"]);
  assert.equal(preview.status,"preview");assert.equal(preview.to,"planned");assert.equal(preview.releaseContext.effectiveStage,"pre_live");
  await writeFile(file,JSON.stringify({...request("work",old),root:"/unapproved"}));
  await assert.rejects(cli(["--root",dir,"--request",file,"--dry-run"]),e=>e.code==="invalid_bookkeeping_request");
});
