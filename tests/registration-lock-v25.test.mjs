import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rm, symlink, rename, lstat } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { acquireRegistrationLock, windowsDenialMayRetry } from '../packs/decal-pack/src/contracts/task-work-bug/v25/registration-lock.mjs';
async function fixture(fn) { const root = await realpath(await mkdtemp(path.join(os.tmpdir(),'its-v25-lock-'))); try { await fn(root,path.join(root,'.decal-slice-completion.lock')); } finally { await rm(root,{recursive:true,force:true}); } }
test('dead owner lock is preserved byte-for-byte and no mutation executes',()=>fixture(async(root,file)=>{
 const pid=Number(execFileSync(process.execPath,['-p','process.pid'],{encoding:'utf8'}).trim());
 const bytes=JSON.stringify({pid,token:'old-owner'}); await writeFile(file,bytes);
 await assert.rejects(acquireRegistrationLock(root),{code:'repository_lock_owner_terminated'});
 assert.equal(await readFile(file,'utf8'),bytes);
}));
test('live owner timeout and cancellation preserve bytes',()=>fixture(async(root,file)=>{
 const bytes=JSON.stringify({pid:process.pid,token:'other-owner'});await writeFile(file,bytes);
 await assert.rejects(acquireRegistrationLock(root,{timeoutMs:10}),{code:'repository_lock_timeout'});
 const controller=new AbortController(); const pending=acquireRegistrationLock(root,{signal:controller.signal});controller.abort();
 await assert.rejects(pending,{code:'cancelled'});assert.equal(await readFile(file,'utf8'),bytes);
}));
test('malformed and symlink locks remain untouched',()=>fixture(async(root,file)=>{
 await writeFile(file,'partial');await assert.rejects(acquireRegistrationLock(root,{timeoutMs:0}),{code:'unsafe_repository_lock'});assert.equal(await readFile(file,'utf8'),'partial');
 await rename(file,file+'.saved'); await symlink(file+'.saved',file);
 await assert.rejects(acquireRegistrationLock(root),{code:'unsafe_repository_lock'});assert.ok((await lstat(file)).isSymbolicLink());
}));
test('normal release is idempotent and cannot unlink a replacement inode',()=>fixture(async(root,file)=>{
 const release=await acquireRegistrationLock(root);const original=await readFile(file,'utf8');await rename(file,file+'.original');await writeFile(file,original);await release();await release();assert.equal(await readFile(file,'utf8'),original);
 await rm(file);const second=await acquireRegistrationLock(root);await second();await assert.rejects(lstat(file),{code:'ENOENT'});
}));
test('owner normal release allows waiter to acquire without replay',()=>fixture(async(root,file)=>{
 const first=await acquireRegistrationLock(root);let resolved=false;const pending=acquireRegistrationLock(root,{timeoutMs:1000}).then(x=>{resolved=true;return x});await first();const release=await pending;assert.equal(resolved,true);assert.equal(JSON.parse(await readFile(file,'utf8')).pid,process.pid);await release();
}));
test('invalid wait bounds and pre-cancellation do not create a lock',()=>fixture(async(root,file)=>{
 for(const timeoutMs of [-1,300001,NaN]) await assert.rejects(acquireRegistrationLock(root,{timeoutMs}),{code:'invalid_wait_limit'});
 await assert.rejects(acquireRegistrationLock(root,{signal:AbortSignal.abort()}),{code:'cancelled'});await assert.rejects(lstat(file),{code:'ENOENT'});
}));
test('only a short Windows EPERM counts as lock contention',()=>{
 const denied={code:'EPERM'};
 assert.equal(windowsDenialMayRetry(denied,'win32',1000),true);
 assert.equal(windowsDenialMayRetry(denied,'win32',5000),false);
 assert.equal(windowsDenialMayRetry(denied,'darwin',1000),false);
 assert.equal(windowsDenialMayRetry({code:'EACCES'},'win32',1000),false);
});
test('eight processes take and release the lock in turn without a failure',()=>fixture(async(root)=>{
 const lockUrl=new URL('../packs/decal-pack/src/contracts/task-work-bug/v25/registration-lock.mjs',import.meta.url).href;
 const worker=`const {acquireRegistrationLock:a}=await import(${JSON.stringify(lockUrl)});for(let i=0;i<30;i++){let r;for(let n=0;!r;n++){try{r=await a(process.argv[1]);}catch(e){if(e.code!=='unsafe_repository_lock'||n===20)throw e;}}await r();}`;
 // Published v25 still reads link count 0 at its first look, while the holder's unlink is under way (BUG-5). its-register.mjs repeats that refusal; a Windows EPERM stays a failure here.
 const env={...process.env};delete env.DECAL_SESSION_ID;
 const results=await Promise.all(Array.from({length:8},()=>new Promise((resolve)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',worker,root],{env,stdio:['ignore','ignore','pipe'],windowsHide:true});
  let stderr='';child.stderr.on('data',(d)=>{stderr+=d;});child.once('close',(code)=>resolve({code,stderr}));
 })));
 assert.deepEqual(results.filter((r)=>r.code!==0),[]);
}));
test('v25 and v26 are selected on Windows only',async()=>{
 const table=JSON.parse(await readFile(new URL('../packs/decal-pack/src/contracts/task-work-bug/capabilities.json',import.meta.url),'utf8')).capabilities;
 for(const [name,base,win] of [['register-task-batch','v15','v25'],['register-ticket','v15','v25'],['register-incident','v16','v26']]){
  assert.equal(table[name].contract,base);assert.deepEqual(table[name].platformContracts,{win32:win});
 }
});
