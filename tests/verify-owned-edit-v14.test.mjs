import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, realpath, mkdir, cp, lstat, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const selected=process.env.OWNED_EDIT_BUDGET_TEST_CONTRACT??'v14';
assert(['v13','v14'].includes(selected));
const source=fileURLToPath(new URL('../packs/decal-pack/src/',import.meta.url));
const api=await import(new URL(`../packs/decal-pack/src/contracts/task-work-bug/${selected}/owned-edit.mjs`,import.meta.url));
const digest=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const TEXT=1024*1024,JOURNAL=4*1024*1024,ownerId='budget-fixture';
const roots=[];
async function fixture(before='marker\n') {
 const root=await realpath(await mkdtemp('/private/tmp/bug323-v14-test-'));roots.push(root);
 await cp(path.join(source,'contracts'),path.join(root,'contracts'),{recursive:true});
 await mkdir(path.join(root,'docs/tasks'),{recursive:true});await mkdir(path.join(root,'.decal'));
 await writeFile(path.join(root,'.decal/settlement-profile.json'),'{}\n');
 await writeFile(path.join(root,'.gitignore'),'.decal/\n.decal-slice-completion.lock\n');
 await writeFile(path.join(root,'docs/tasks/index.md'),'# Tasks\n\n| Task | 상태 | 우선순위 | 관련 영역 | 검증/다음 액션 |\n| --- | --- | --- | --- | --- |\n| [1 One](task_1_workflow_001_one.md) | `in_progress` | `P1` | fixture | evidence |\n');
 await writeFile(path.join(root,'docs/tasks/category_index.md'),await readFile(path.join(source,'contracts/task-work-bug/v3/fixtures/project/docs/tasks/category_index.md')));
 await writeFile(path.join(root,'docs/tasks/task_1_workflow_001_one.md'),'# Task 1 · workflow — One\n\n상태: in_progress\n\nVersion Applied: pending\n\n## Context Budget\nfixture\n');
 await writeFile(path.join(root,'code.txt'),before);await writeFile(path.join(root,'other.txt'),'other\n');
 git(root,'init','-b','main');git(root,'config','user.email','fixture@example.invalid');git(root,'config','user.name','BUG323 fixture');git(root,'add','.');git(root,'commit','-m','fixture');
 const captured=await api.beginOwnedEdit({root,relative:'code.txt',taskId:1,ownerId});
 const journal=path.resolve(root,git(root,'rev-parse','--git-path','decal-owned-edits-v1'),captured.token+'.json');
 return {root,captured,journal};
}
async function snapshot(f) {
 return {source:digest(await readFile(path.join(f.root,'code.txt'))),journal:digest(await readFile(f.journal)),head:git(f.root,'rev-parse','HEAD'),index:digest(await readFile(path.resolve(f.root,git(f.root,'rev-parse','--git-path','index'))))};
}
const apply=(f,find,replace)=>api.applyOwnedEdit({root:f.root,token:f.captured.token,ownerId,expectedSourceRevision:f.captured.sourceRevision,find,replace});
const inspect=f=>api.inspectOwnedEdit({root:f.root,token:f.captured.token,ownerId});
const commitArgs=f=>({root:f.root,token:f.captured.token,ownerId,message:'fixture edit',verification:'Fixture assertions only',independent:true});
const errorCode=code=>e=>e.code===code;

test('budget: oversized UTF8 result rejects before file/receipt/HEAD/index writes',async()=>{
 const f=await fixture(),before=await snapshot(f);const replacement='😀'.repeat(350000);assert(replacement.length<=TEXT&&Buffer.byteLength(replacement)>TEXT);
 await assert.rejects(apply(f,'marker',replacement),errorCode('owned_edit_text_too_large'));
 assert.deepEqual(await snapshot(f),before);assert.equal((await inspect(f)).status,'captured');
});
test('budget: ASCII quote receipt exceeding 4MiB rejects before writes',async()=>{
 const f=await fixture('"'.repeat(TEXT-1)+'A'),before=await snapshot(f);
 await assert.rejects(apply(f,'A','"'),errorCode('owned_edit_receipt_too_large'));
 assert.deepEqual(await snapshot(f),before);assert.equal((await inspect(f)).status,'captured');
});
test('invalid Unicode and NUL replacement leave the captured state unchanged',async()=>{
 const f=await fixture(),before=await snapshot(f);
 for(const text of ['\ud800','\udc00','bad\0text']){
  await assert.rejects(apply(f,'marker',text));assert.deepEqual(await snapshot(f),before);
 }
});
test('capture rejects escaped receipt overflow without creating edit storage or integrity key',async()=>{
 const f=await fixture();const before=await snapshot(f);
 await writeFile(path.join(f.root,'code.txt'),'\u0001'.repeat(TEXT));
 const captureRoot=await realpath(await mkdtemp('/private/tmp/bug323-v14-capture-'));roots.push(captureRoot);
 await cp(f.root,captureRoot,{recursive:true});
 // A copied Git tree is an isolated fixture; remove nothing and use a new Git-private directory name by moving the old one.
 const storage=path.resolve(captureRoot,git(captureRoot,'rev-parse','--git-path','decal-owned-edits-v1'));
 const {rename}=await import('node:fs/promises');await rename(storage,storage+'.fixture-preserved');
 await assert.rejects(api.beginOwnedEdit({root:captureRoot,relative:'code.txt',taskId:1,ownerId}),errorCode('owned_edit_receipt_too_large'));
 await assert.rejects(lstat(storage),e=>e.code==='ENOENT');
 assert.equal((await readFile(path.join(captureRoot,'code.txt'))).length,TEXT);
 assert.equal(git(captureRoot,'rev-parse','HEAD'),before.head);
});
test('exact text limit accepts nonASCII result, then normal inspect/commit/idempotent receipt',async()=>{
 const f=await fixture('marker');await apply(f,'marker','😀'.repeat(TEXT/4));
 assert.equal((await readFile(path.join(f.root,'code.txt'))).length,TEXT);assert.equal((await inspect(f)).status,'applied');
 const args=commitArgs(f),preview=await api.previewOwnedCommit(args);const first=await api.commitOwnedEdit({...args,approvedDigest:preview.approvalDigest});
 const second=await api.commitOwnedEdit({...args,approvedDigest:preview.approvalDigest});assert.equal(second.commit,first.commit);assert.equal(second.reused,true);assert.equal((await inspect(f)).status,'committed');
});
test('commit exact sealed limit passes; plus one byte rejects before index/HEAD/receipt writes',async()=>{
 const f=await fixture();await apply(f,'marker','new');const entry=JSON.parse(await readFile(f.journal,'utf8')).entry;
 const objectId='0'.repeat(entry.head.length),mac='0'.repeat(64);
 const shape={...entry,phase:'committing',commit:objectId,committedBlob:objectId,verification:'',patchDigest:'sha256:'+mac};
 const room=JOURNAL-Buffer.byteLength(JSON.stringify({entry:shape,signature:mac}));assert(room>0);
 const before=await snapshot(f),args={...commitArgs(f),verification:'x'.repeat(room+1)};const preview=await api.previewOwnedCommit(args);
 await assert.rejects(api.commitOwnedEdit({...args,approvedDigest:preview.approvalDigest}),errorCode('owned_edit_receipt_too_large'));assert.deepEqual(await snapshot(f),before);
 const exact={...args,verification:'x'.repeat(room)},accepted=await api.previewOwnedCommit(exact);await api.commitOwnedEdit({...exact,approvedDigest:accepted.approvalDigest});
 assert.equal((await lstat(f.journal)).size,JOURNAL-1);assert.equal((await inspect(f)).status,'committed');
});
test('owner, source drift, staged target, hooks, mode and Native-host protections remain',async()=>{
 const f=await fixture();await assert.rejects(api.applyOwnedEdit({root:f.root,token:f.captured.token,ownerId:'wrong',expectedSourceRevision:f.captured.sourceRevision,find:'marker',replace:'new'}),errorCode('owner_mismatch'));
 await writeFile(path.join(f.root,'code.txt'),'foreign\n');await assert.rejects(apply(f,'marker','new'),errorCode('source_drift'));await writeFile(path.join(f.root,'code.txt'),'marker\n');
 git(f.root,'add','code.txt'); // stage is equal to HEAD, so make a genuinely changed staged version next.
 await writeFile(path.join(f.root,'code.txt'),'staged\n');git(f.root,'add','code.txt');await assert.rejects(apply(f,'staged','new'),errorCode('target_staged'));git(f.root,'reset','--','code.txt');await writeFile(path.join(f.root,'code.txt'),'marker\n');
 if(process.platform!=='win32'){await chmod(path.join(f.root,'code.txt'),0o755);await assert.rejects(apply(f,'marker','new'),errorCode('file_mode_changed'));await chmod(path.join(f.root,'code.txt'),0o644);}
 const had=Object.hasOwn(process.env,'DECAL_SESSION_ID'),value=process.env.DECAL_SESSION_ID;process.env.DECAL_SESSION_ID='fixture';
 try{await assert.rejects(apply(f,'marker','new'),errorCode('native_writer_required'));}finally{if(had)process.env.DECAL_SESSION_ID=value;else delete process.env.DECAL_SESSION_ID;}
 await apply(f,'marker','new');await writeFile(path.resolve(f.root,git(f.root,'rev-parse','--git-path','hooks/pre-commit')),'fixture hook');
 const args=commitArgs(f),preview=await api.previewOwnedCommit(args);await assert.rejects(api.commitOwnedEdit({...args,approvedDigest:preview.approvalDigest}),errorCode('commit_hooks_unsupported'));
});
test('partial committing failure retains an inspectable journal and refuses blind replay',async()=>{
 const f=await fixture();await apply(f,'marker','new');const args=commitArgs(f),preview=await api.previewOwnedCommit(args),beforeHead=git(f.root,'rev-parse','HEAD');
 const realGit=execFileSync('/bin/sh',['-c','command -v git'],{encoding:'utf8'}).trim();const wrapper=path.join(f.root,'fixture-bin');await mkdir(wrapper);
 await writeFile(path.join(wrapper,'git'),'#!/usr/bin/env node\nimport {spawnSync} from "node:child_process";\nconst args=process.argv.slice(2);if(args.includes("update-ref"))process.exit(2);const r=spawnSync('+JSON.stringify(realGit)+',args,{stdio:"inherit"});process.exit(r.status??2);\n',{mode:0o755});
 // ESM syntax is enabled only for this test wrapper, with no source instrumentation.
 await writeFile(path.join(wrapper,'package.json'),' {"type":"module"}\n');
 const previous=process.env.PATH;process.env.PATH=wrapper+path.delimiter+previous;
 try{await assert.rejects(api.commitOwnedEdit({...args,approvedDigest:preview.approvalDigest}));}finally{process.env.PATH=previous;}
 assert.equal(git(f.root,'rev-parse','HEAD'),beforeHead);assert.equal((await inspect(f)).status,'committing');
 await assert.rejects(api.commitOwnedEdit({...args,approvedDigest:preview.approvalDigest}),errorCode('edit_receipt_required'));
});
test.after(()=>console.log('BUG323 synthetic fixtures preserved:',JSON.stringify(roots)));
test('exact owned commit preserves same-file foreign edits and other staged index bytes',async()=>{
 const original=Array.from({length:30},(_,i)=>`line ${i}`).join('\n')+'\n';const f=await fixture(original);
 const foreign=original.replace('line 1\n','foreign line\n');await writeFile(path.join(f.root,'code.txt'),foreign);
 await writeFile(path.join(f.root,'other.txt'),'foreign staged\n');git(f.root,'add','other.txt');
 f.captured=await api.beginOwnedEdit({root:f.root,relative:'code.txt',taskId:1,ownerId});
 f.journal=path.resolve(f.root,git(f.root,'rev-parse','--git-path','decal-owned-edits-v1'),f.captured.token+'.json');
 const stagedBefore=git(f.root,'show',':other.txt');await apply(f,'line 25\n','owned line\n');const args=commitArgs(f),preview=await api.previewOwnedCommit(args);await api.commitOwnedEdit({...args,approvedDigest:preview.approvalDigest});
 assert.equal(await readFile(path.join(f.root,'code.txt'),'utf8'),foreign.replace('line 25\n','owned line\n'));
 assert.equal(git(f.root,'show','HEAD:code.txt'),original.replace('line 25\n','owned line\n').trim());assert.equal(git(f.root,'show',':other.txt'),stagedBefore);
 assert.equal(git(f.root,'diff','--cached','--name-only'),'other.txt');assert.equal(git(f.root,'diff-tree','--no-commit-id','--name-only','-r','HEAD'),'code.txt');
});
for(const name of ['task-body.mjs','execution-policy.mjs','verify-contract.mjs']) {
 test(`actual imported legacy dependency ${name} drift rejects with unchanged project state`,async()=>{
  const f=await fixture(),before=await snapshot(f);const file=path.join(f.root,'contracts/task-work-bug/v13',name);
  await writeFile(file,Buffer.concat([await readFile(file),Buffer.from('\n// inert synthetic dependency drift\n')]));
  const {verifyContract}=await import('../packs/decal-pack/src/contracts/task-work-bug/v14/verify-contract.mjs');
  await assert.rejects(verifyContract(path.join(f.root,'contracts/task-work-bug/v14')));
  const copiedApi=await import(pathToFileURL(path.join(f.root,'contracts/task-work-bug/v14/owned-edit.mjs')).href);
  await assert.rejects(copiedApi.beginOwnedEdit({root:f.root,relative:'code.txt',taskId:1,ownerId}));
  assert.deepEqual(await snapshot(f),before);
 });
}
