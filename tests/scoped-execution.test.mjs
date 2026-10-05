import test from 'node:test';
import assert from 'node:assert/strict';
import { realpath, mkdtemp, mkdir, cp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planTaskBody, inspectTask } from '../packs/decal-pack/src/contracts/task-work-bug/v13/task-body.mjs';
import { digest } from '../packs/decal-pack/src/contracts/task-work-bug/v9/version-profile.mjs';
import { executePlan } from '../packs/decal-pack/src/contracts/task-work-bug/v9/transaction.mjs';
import * as policy from '../packs/decal-pack/src/contracts/task-work-bug/v13/execution-policy.mjs';
const source = fileURLToPath(new URL('../packs/decal-pack/src/', import.meta.url));
const git = (root,...args) => execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
async function fixture(fn) {
 const root = await realpath(await mkdtemp(path.join(os.tmpdir(),'its-scoped-')));
 try {
  await cp(path.join(source,'contracts'),path.join(root,'contracts'),{recursive:true});
  await mkdir(path.join(root,'docs/tasks'),{recursive:true});
  await mkdir(path.join(root,'.decal'));
  await writeFile(path.join(root,'.decal/settlement-profile.json'),'{}\n');
  await writeFile(path.join(root,'.gitignore'),'.decal/\n.decal-slice-completion.lock\n');
  const index = '# Tasks\n\n| Task | 상태 | 우선순위 | 관련 영역 | 검증/다음 액션 |\n| --- | --- | --- | --- | --- |\n| [1 One](task_1_workflow_001_one.md) | `in_progress` | `P1` | test | evidence |\n| [2 Two](task_2_workflow_002_two.md) | `planned` | `P1` | test | evidence |\n';
  await writeFile(path.join(root,'docs/tasks/index.md'),index);
  const categories=await readFile(path.join(source,'contracts/task-work-bug/v3/fixtures/project/docs/tasks/category_index.md'),'utf8');
  await writeFile(path.join(root,'docs/tasks/category_index.md'),categories);
  const task='# Task 1 · workflow — One\n\n상태: in_progress\n\nVersion Applied: pending\nUnknown: preserve\n\n## Context Budget\nkeep\n';
  await writeFile(path.join(root,'docs/tasks/task_1_workflow_001_one.md'),task);
  // Deliberately inconsistent unrelated document; target-only update must not read it.
  await writeFile(path.join(root,'docs/tasks/task_2_workflow_002_two.md'),'# corrupt unrelated document\n');
  git(root,'init','-b','main');git(root,'config','user.email','test@example.invalid');git(root,'config','user.name','Fixture');git(root,'add','.');git(root,'commit','-m','fixture');
  const request={schema:'zuz.its.task-body-request/v1',id:1,expectedSourceRevision:digest(task),intentId:'evidence-one',body:'## Evidence\nObserved the intended result.'};
  await fn(root,request,task,index);
 } finally { await rm(root,{recursive:true,force:true}); }
}
test('target update ignores unrelated body failure, preserves metadata, commits exact target and is idempotent',()=>fixture(async(root,request,task)=>{
 const result=await planTaskBody(root,request); assert.equal(result.status,'preview');
 assert.ok(result.plan.entries[0].next.startsWith(task.trimEnd()));
 const applied=await executePlan(result.plan,result.approvalDigest);assert.equal(applied.state,'committed');
 assert.equal(git(root,'diff-tree','--no-commit-id','--name-only','-r','HEAD'),'docs/tasks/task_1_workflow_001_one.md');
 assert.equal((await planTaskBody(root,request)).status,'already_recorded');
 await assert.rejects(planTaskBody(root,{...request,body:'Changed evidence'}),/intent_conflict/);
}));
test('stale target, structural injection, duplicate IDs and mixed registry fail closed',()=>fixture(async(root,request,task,index)=>{
 await assert.rejects(planTaskBody(root,{...request,expectedSourceRevision:digest('stale')}),/stale_source_revision/);
 await assert.rejects(planTaskBody(root,{...request,body:'상태: completed'}),/structural_update_not_allowed/);
 await writeFile(path.join(root,'docs/tasks/index.md'),index.replace('[2 Two](task_2_workflow_002_two.md)','[1 Two](task_1_workflow_001_one.md)'));
 await assert.rejects(inspectTask(root,1),/duplicate_task_id/);
 await writeFile(path.join(root,'docs/tasks/index.md'),index);
 await mkdir(path.join(root,'docs/slices'));await writeFile(path.join(root,'docs/slices/index.md'),'legacy');
 await assert.rejects(inspectTask(root,1),/ambiguous_registry/);
}));
test('target drift after planning cannot write',()=>fixture(async(root,request)=>{
 const result=await planTaskBody(root,request);
 await writeFile(path.join(root,result.plan.entries[0].path),'concurrent');
 await assert.rejects(executePlan(result.plan,result.approvalDigest),/stale_source|target_dirty/);
 assert.equal(await readFile(path.join(root,result.plan.entries[0].path),'utf8'),'concurrent');
}));
test('symlink target is rejected',()=>fixture(async(root)=>{
 const target=path.join(root,'docs/tasks/task_1_workflow_001_one.md');await rm(target);await symlink('task_2_workflow_002_two.md',target);
 await assert.rejects(inspectTask(root,1));
}));
test('operation-local capability and QA observation differ from attestation',()=>{
 const catalog={operations:{register:{supported:true,requires:['atomic']}},guarantees:{atomic:true}};
 assert.equal(policy.operationCapability(catalog,'register').supported,true);
 assert.equal(policy.operationCapability(catalog,'complete').supported,false);
 assert.equal(policy.operationCapability({...catalog,guarantees:{}},'register').supported,false);
 assert.equal(policy.qaDecision('observe',{target:true,ownership:true}).allowed,true);
 assert.equal(policy.qaDecision('attest',{target:true,ownership:true}).allowed,false);
 assert.equal(policy.remoteDecision({parity:'not-required',disposition:'not-applicable',reason:'No corresponding surface'}).accepted,true);
 assert.equal(policy.remoteDecision({parity:'not-required',disposition:'deferred',reason:'Later'}).accepted,false);
});
test('restart reuse permits verified main advancement but not foreign dirty or changed termination scope',()=>{
 const grant={root:'r',requestId:'q',appIdentity:'a',terminationScope:'t',previewScope:'p',costScope:'c',permissionScope:'s',sourceRevision:'one',expiresAt:100};
 const current={...grant,now:50,sourceRevision:'two',verifiedMainAdvance:true,foreignDirty:false,sourceOwned:true,artifactBound:true};
 assert.equal(policy.restartDecision(grant,current),'reuse');
 assert.equal(policy.restartDecision(grant,{...current,foreignDirty:true}),'preparation_required');
 assert.equal(policy.restartDecision(grant,{...current,terminationScope:'other'}),'authority_required');
});
test('bounded read-only wait times out, stops on cancellation/owner end; unknown writes require inspection',async()=>{
 let time=0,calls=0;
 const result=await policy.waitForAvailability(async()=>{calls++;return {status:'busy',ownerActive:true};},{now:()=>time,wait:async ms=>{time+=ms;}});
 assert.equal(time,300000);assert.equal(result.code,'wait_timeout');assert.ok(calls<40);
 assert.equal((await policy.waitForAvailability(async()=>({status:'busy',ownerActive:false}))).code,'owner_ended');
 assert.equal((await policy.waitForAvailability(async()=>assert.fail(),{signal:{aborted:true}})).code,'cancelled');
 assert.equal(policy.retryDecision({requestState:'unknown',retryability:'wait_for_owner'}),'inspect_receipt');
 assert.equal(policy.retryDecision({requestState:'not_created',retryability:'correct_and_retry_same_turn',correctionCount:1}),'blocked');
});

import { previewOwnedCommit, beginOwnedEdit, applyOwnedEdit, commitOwnedEdit as commitOwnedEditRaw } from '../packs/decal-pack/src/contracts/task-work-bug/v13/owned-edit.mjs';
async function prepareOwned(root) {
 const source=Array.from({length:30},(_,i)=>`line ${i}`).join('\n')+'\n';
 await writeFile(path.join(root,'code.txt'),source);await writeFile(path.join(root,'other.txt'),'other baseline\n');
 git(root,'add','code.txt','other.txt');git(root,'commit','-m','source');
 await writeFile(path.join(root,'code.txt'),source.replace('line 1\n','foreign change\n'));
 await writeFile(path.join(root,'other.txt'),'foreign staged\n');git(root,'add','other.txt');
 const captured=await beginOwnedEdit({root,relative:'code.txt',taskId:1,ownerId:'agent-one'});
 await applyOwnedEdit({root,...captured,expectedSourceRevision:captured.sourceRevision,ownerId:'agent-one',find:'line 25\n',replace:'owned change\n'});
 return {...captured,source};
}
test('owned patch commit preserves foreign worktree and staged contents',()=>fixture(async(root)=>{
 const {token,source}=await prepareOwned(root);
 const foreignStage=git(root,'show',':other.txt');
 const working=await readFile(path.join(root,'code.txt'),'utf8');
 const args={root,token,ownerId:'agent-one',message:'owned patch',verification:'independent lines checked',independent:true};
 const result=await commitOwnedEdit(args);
 assert.equal(git(root,'show','HEAD:code.txt'),source.replace('line 25\n','owned change\n').trim());
 assert.equal(await readFile(path.join(root,'code.txt'),'utf8'),working);
 assert.equal(git(root,'show',':other.txt'),foreignStage);
 assert.equal(git(root,'diff','--cached','--name-only'),'other.txt');
 assert.equal(git(root,'diff-tree','--no-commit-id','--name-only','-r','HEAD'),'code.txt');
 assert.equal((await commitOwnedEdit(args)).commit,result.commit);
}));
test('owned commits reject drift, wrong owner and absent independence evidence',()=>fixture(async(root)=>{
 const {token}=await prepareOwned(root);
 const args={root,token,ownerId:'agent-one',message:'owned patch',verification:'checked',independent:true};
 await assert.rejects(commitOwnedEdit({...args,ownerId:'agent-two'}),/owner_mismatch/);
 await assert.rejects(commitOwnedEdit({...args,independent:false}),/independence_and_verification_required/);
 await writeFile(path.join(root,'code.txt'),'later edit');
 await assert.rejects(commitOwnedEdit(args),/source_drift/);
 assert.equal(await readFile(path.join(root,'code.txt'),'utf8'),'later edit');
}));
test('same-file staged contents and unsupported hooks block owned commit',()=>fixture(async(root)=>{
 const {token}=await prepareOwned(root);
 const args={root,token,ownerId:'agent-one',message:'owned patch',verification:'checked',independent:true};
 await writeFile(path.join(root,'.git/hooks/pre-commit'),'#!/bin/sh\nexit 0\n');
 await assert.rejects(commitOwnedEdit(args),/commit_hooks_unsupported/);
 await rm(path.join(root,'.git/hooks/pre-commit'));
 git(root,'add','code.txt');
 await assert.rejects(commitOwnedEdit(args),/target_staged/);
}));
test('overlap with pre-existing foreign edits cannot apply to HEAD',()=>fixture(async(root)=>{
 await writeFile(path.join(root,'code.txt'),'original\n');git(root,'add','code.txt');git(root,'commit','-m','seed');
 await writeFile(path.join(root,'code.txt'),'foreign\n');
 const captured=await beginOwnedEdit({root,relative:'code.txt',taskId:1,ownerId:'agent-one'});
 await applyOwnedEdit({root,...captured,expectedSourceRevision:captured.sourceRevision,ownerId:'agent-one',find:'foreign',replace:'owned'});
 const before=git(root,'rev-parse','HEAD');
 await assert.rejects(commitOwnedEdit({root,token:captured.token,ownerId:'agent-one',message:'overlap',verification:'checked',independent:true}));
 assert.equal(git(root,'rev-parse','HEAD'),before);
 assert.equal(await readFile(path.join(root,'code.txt'),'utf8'),'owned\n');
}));

async function commitOwnedEdit(args) { const preview=await previewOwnedCommit(args); return commitOwnedEditRaw({...args,approvedDigest:preview.approvalDigest}); }

test('modified ownership journal cannot manufacture provenance',()=>fixture(async(root)=>{
 const {token}=await prepareOwned(root);
 const file=path.join(root,'.git/decal-owned-edits-v1',`${token}.json`);
 const sealed=JSON.parse(await readFile(file,'utf8'));sealed.entry.ownerId='agent-two';await writeFile(file,JSON.stringify(sealed));
 await assert.rejects(previewOwnedCommit({root,token,ownerId:'agent-two'}),/invalid_edit_receipt/);
}));
