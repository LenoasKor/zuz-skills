// Portable owned-edit transaction. Native must implement its own grant-bound adapter.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, open, lstat, realpath, mkdir, rename, unlink, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { digest, fail, safeFile, relativePath } from '../v9/version-profile.mjs';
import { acquireLock } from '../v9/transaction.mjs';
import { inspectTask } from './task-body.mjs';
import { verifyContract } from './verify-contract.mjs';
const run = promisify(execFile);
async function git(root,args,env={}) { return (await run('git',['-C',root,...args],{encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,...env}})).stdout; }
async function exists(file) { try { return await lstat(file); } catch(e) { if(e.code==='ENOENT') return null; throw e; } }
async function boundary(root,relative) {
 if(Object.hasOwn(process.env,'DECAL_SESSION_ID')) fail('native_writer_required');
 await verifyContract();
 relativePath(relative);
 if(!/^[A-Za-z0-9_./-]+$/.test(relative) || /^(?:\.git|\.decal|contracts|docs\/tasks|docs\/work-items)(?:\/|$)/.test(relative)) fail('owned_edit_path_not_supported');
 if(await realpath(root)!==root || (await git(root,['rev-parse','--show-toplevel'])).trim()!==root) fail('noncanonical_root');
 for(const key of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','sequencer']) {
  if(await exists(path.resolve(root,(await git(root,['rev-parse','--git-path',key])).trim()))) fail('git_operation_in_progress');
 }
 for(const journal of ['.decal/settlement-pending-v1.json','.decal/task-registration-pending-v7.json','.decal/its-ticket-registration-pending-v1.json']) if(await exists(path.join(root,journal))) fail('pending_transaction');
 if((await git(root,['diff','--name-only','--diff-filter=U','-z'])).length) fail('unmerged_index');
 if((await git(root,['diff','--cached','--name-only','-z','--',relative])).length) fail('target_staged');
 const mode=(await git(root,['ls-files','--stage','--',relative])).split(' ')[0];
 if(!['100644','100755'].includes(mode)) fail('tracked_text_required');
 const target=await safeFile(root,relative); const metadata=await lstat(target);
 if(process.platform!=='win32' && Boolean(metadata.mode & 0o111)!==(mode==='100755')) fail('file_mode_changed');
 const bytes=await readFile(target);
 if(bytes.length>1024*1024 || bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes)) fail('tracked_text_required');
 return {target,mode,permissions:metadata.mode & 0o777,source:bytes.toString('utf8'),head:(await git(root,['rev-parse','HEAD'])).trim(),branch:(await git(root,['symbolic-ref','HEAD'])).trim()};
}
async function storage(root, create=false) {
 const directory=path.resolve(root,(await git(root,['rev-parse','--git-path','decal-owned-edits-v1'])).trim());
 if(create) await mkdir(directory,{recursive:true,mode:0o700});
 if((await lstat(directory)).isSymbolicLink() || await realpath(directory)!==directory) fail('unsafe_journal');
 return directory;
}
async function keyFor(directory, create=false) {
 const file=path.join(directory,'integrity.key');
 if(create) {try {await writeFile(file,randomBytes(32),{flag:'wx',mode:0o600});} catch(error) {if(error.code!=='EEXIST')throw error;}} 
 const stat=await lstat(file);
 if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size!==32 || (stat.mode & 0o077)!==0) fail('unsafe_integrity_key');
 return readFile(file);
}
async function signature(directory,entry,create=false) {
 return createHmac('sha256',await keyFor(directory,create)).update(JSON.stringify(entry)).digest('hex');
}
async function load(root,token) {
 if(!/^[a-f0-9-]{36}$/.test(token)) fail('invalid_edit_token');
 const directory=await storage(root);const file=path.join(directory,`${token}.json`);const stat=await lstat(file);
 if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size>4*1024*1024) fail('unsafe_journal');
 const sealed=JSON.parse(await readFile(file,'utf8'));const entry=sealed.entry;
 const expected=await signature(directory,entry);
 if(typeof sealed.signature!=='string' || !/^[a-f0-9]{64}$/.test(sealed.signature) || !timingSafeEqual(Buffer.from(sealed.signature,'hex'),Buffer.from(expected,'hex'))) fail('invalid_edit_receipt');
 if(entry.schema!=='zuz.owned-edit/v1' || entry.root!==root || entry.token!==token || digest(entry.before)!==entry.beforeDigest) fail('invalid_edit_receipt');
 return {file,entry};
}
async function save(file,entry,initial=false) {
 const source=JSON.stringify({entry,signature:await signature(path.dirname(file),entry,initial)});
 if(initial) return writeFile(file,source,{flag:'wx',mode:0o600});
 const tmp=`${file}.${randomUUID()}.tmp`;
 await writeFile(tmp,source,{flag:'wx',mode:0o600});await rename(tmp,file);
}
async function owner(root,entry,ownerId) {
 if(entry.ownerId!==ownerId) fail('owner_mismatch');
 const task=await inspectTask(root,entry.taskId);
 if(!['in_progress','planned'].includes(task.row.status) || digest(task.source)!==entry.taskRevision) fail('owner_scope_changed');
}
export async function beginOwnedEdit({root,relative,taskId,ownerId}) {
 if(typeof ownerId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(ownerId)) fail('invalid_owner');
 const release=await acquireLock(root,1);
 try {
  const state=await boundary(root,relative); const task=await inspectTask(root,taskId);
  if(!['planned','in_progress'].includes(task.row.status)) fail('owner_scope_changed');
  const token=randomUUID(); const dir=await storage(root,true);
  const entry={schema:'zuz.owned-edit/v1',token,root,relative,ownerId,taskId,taskRevision:digest(task.source),phase:'captured',head:state.head,branch:state.branch,mode:state.mode,before:state.source,beforeDigest:digest(state.source)};
  await save(path.join(dir,`${token}.json`),entry,true);
  return {token,sourceRevision:entry.beforeDigest};
 } finally {await release();}
}
export async function applyOwnedEdit({root,token,ownerId,expectedSourceRevision,find,replace}) {
 const release=await acquireLock(root,1);
 try {
  const {file,entry}=await load(root,token);await owner(root,entry,ownerId);
  if(entry.phase!=='captured') fail('edit_already_applied');
  const state=await boundary(root,entry.relative);
  if(state.head!==entry.head || state.branch!==entry.branch || digest(state.source)!==entry.beforeDigest || expectedSourceRevision!==entry.beforeDigest) fail('source_drift');
  if(typeof find!=='string' || !find || typeof replace!=='string' || replace.includes('\0') || find===replace || replace.length>1024*1024 || state.source.split(find).length!==2) fail('unique_edit_required');
  const after=state.source.replace(find,()=>replace);
  // Record intent before mutation; a crash is inspectable and never blindly replayed.
  const prepared={...entry,phase:'applying',after,afterDigest:digest(after)};
  await save(file,prepared);
  if(digest(await readFile(state.target,'utf8'))!==entry.beforeDigest) fail('source_drift');
  const tmp=`${state.target}.owned-${token}`;
  await writeFile(tmp,after,{flag:'wx',mode:state.permissions});
  if(digest(await readFile(state.target,'utf8'))!==entry.beforeDigest) {await unlink(tmp);fail('source_drift');}
  await rename(tmp,state.target);await save(file,{...prepared,phase:'applied'});
  return {token,sourceRevision:digest(after)};
 } finally {await release();}
}
async function rejectHooks(root) {
 const hooks=path.resolve(root,(await git(root,['rev-parse','--git-path','hooks'])).trim());
 for(const name of ['pre-commit','prepare-commit-msg','commit-msg','post-commit']) if(await exists(path.join(hooks,name))) fail('commit_hooks_unsupported');
 const config=await git(root,['config','--get-regexp','^core\\.hooksPath$']).catch(e=>{if(e.code===1)return '';throw e;});
 if(config.trim()) fail('commit_hooks_unsupported');
}
export async function commitOwnedEdit({root,token,ownerId,message,verification,independent,approvedDigest}) {
 const preview=await previewOwnedCommit({root,token,ownerId,message,verification,independent});
 if(preview.approvalDigest!==approvedDigest) fail('approval_digest_mismatch');
 const release=await acquireLock(root,1);let temp=null,indexLock=null,indexLockIdentity=null,indexLockPath=null;
 try {
  const {file,entry}=await load(root,token);await owner(root,entry,ownerId);
  if(entry.phase==='committed') {
   await git(root,['merge-base','--is-ancestor',entry.commit,'HEAD']);
   if((await git(root,['rev-parse',`${entry.commit}:${entry.relative}`])).trim()!==entry.committedBlob) fail('receipt_mismatch');
   return {status:'committed',commit:entry.commit,reused:true};
  }
  if(entry.phase!=='applied' || digest(entry.after)!==entry.afterDigest) fail('edit_receipt_required');
  if(independent!==true || typeof verification!=='string' || !verification.trim()) fail('independence_and_verification_required');
  if(typeof message!=='string' || !message.trim() || message.length>2000 || /[\0\r\n]/.test(message)) fail('invalid_message');
  const state=await boundary(root,entry.relative);await rejectHooks(root);
  if(state.head!==entry.head || state.branch!==entry.branch || digest(state.source)!==entry.afterDigest) fail('source_drift');
  const indexPath=path.resolve(root,(await git(root,['rev-parse','--git-path','index'])).trim());
  if((await lstat(indexPath)).isSymbolicLink()) fail('unsafe_index');
  indexLockPath=`${indexPath}.lock`;
  indexLock=await open(indexLockPath,'wx',0o600);indexLockIdentity=await indexLock.stat();
  const ownsIndexLock=async()=>{const current=await exists(indexLockPath);return current?.isFile() && !current.isSymbolicLink() && current.dev===indexLockIdentity.dev && current.ino===indexLockIdentity.ino;};
  const originalIndex=await readFile(indexPath);
  temp=await mkdtemp(path.join(await realpath(os.tmpdir()),'owned-commit-'));
  const before=path.join(temp,'before'),after=path.join(temp,'after');
  await writeFile(before,entry.before);await writeFile(after,entry.after);
  let patch;
  try {patch=await git(root,['diff','--no-index','--no-ext-diff','--no-textconv','--',before,after]);}
  catch(e) {if(e.code!==1)throw e;patch=e.stdout;}
  patch=patch.split('\n').map(line=>line.startsWith('diff --git ')?`diff --git a/${entry.relative} b/${entry.relative}`:line.startsWith('--- ')?`--- a/${entry.relative}`:line.startsWith('+++ ')?`+++ b/${entry.relative}`:line).join('\n');
  const patchFile=path.join(temp,'owned.patch');await writeFile(patchFile,patch);
  const commitIndex=path.join(temp,'commit-index');const env={GIT_INDEX_FILE:commitIndex};
  await git(root,['read-tree',state.head],env);
  // Context must apply directly to HEAD. No fuzzy/3-way resolution of foreign changes.
  await git(root,['apply','--cached','--check',patchFile],env);
  await git(root,['apply','--cached',patchFile],env);
  const changed=(await git(root,['diff','--cached','--name-only','-z'],env)).split('\0').filter(Boolean);
  if(changed.length!==1 || changed[0]!==entry.relative) fail('unexpected_commit_scope');
  const tree=(await git(root,['write-tree'],env)).trim();
  const committedBlob=(await git(root,['rev-parse',`${tree}:${entry.relative}`])).trim();
  const nextIndex=path.join(temp,'next-index');await writeFile(nextIndex,originalIndex);
  await git(root,['update-index','--cacheinfo',entry.mode,committedBlob,entry.relative],{GIT_INDEX_FILE:nextIndex});
  const commit=(await git(root,['commit-tree',tree,'-p',state.head,'-m',message,'-m',`Zuz-Owned-Edit: ${token}`])).trim();
  await save(file,{...entry,phase:'committing',commit,committedBlob,verification,patchDigest:digest(patch)});
  if((await git(root,['rev-parse','HEAD'])).trim()!==state.head || digest(await readFile(state.target,'utf8'))!==entry.afterDigest || !originalIndex.equals(await readFile(indexPath))) fail('source_drift');
  if(!await ownsIndexLock()) fail('index_lock_lost');
  await indexLock.writeFile(await readFile(nextIndex));await indexLock.sync();
  if(!await ownsIndexLock()) fail('index_lock_lost');
  await git(root,['update-ref',state.branch,commit,state.head]);
  // Ref now contains only the verified patch; failed finalization retains the journal.
  await indexLock.close();indexLock=null;
  if(!await ownsIndexLock()) fail('index_lock_lost');
  await rename(indexLockPath,indexPath);
  await save(file,{...entry,phase:'committed',commit,committedBlob,verification,patchDigest:digest(patch)});
  return {status:'committed',commit,reused:false};
 } finally {
  if(indexLock) {await indexLock.close();const current=await exists(indexLockPath);
   if(current?.isFile() && !current.isSymbolicLink() && current.dev===indexLockIdentity.dev && current.ino===indexLockIdentity.ino) await unlink(indexLockPath);}
  if(temp) await rm(temp,{recursive:true,force:true});
  await release();
 }
}

export async function inspectOwnedEdit({root,token,ownerId}) {
 const {entry}=await load(root,token);await owner(root,entry,ownerId);
 const source=await readFile(await safeFile(root,entry.relative),'utf8');
 if(entry.phase==='committed') {
  await git(root,['merge-base','--is-ancestor',entry.commit,'HEAD']);
  if((await git(root,['rev-parse',`${entry.commit}:${entry.relative}`])).trim()!==entry.committedBlob) fail('receipt_mismatch');
 }
 return {status:entry.phase,token,sourceMatches:digest(source)===(entry.afterDigest??entry.beforeDigest),commit:entry.phase==='committed'?entry.commit:null,
  nextAction:['applying','committing'].includes(entry.phase)?'Inspect the preserved transaction; do not replay it.':null};
}
export async function previewOwnedCommit({root,token,ownerId,message,verification,independent}) {
 const {entry}=await load(root,token);await owner(root,entry,ownerId);
 const binding={schema:'zuz.owned-commit-plan/v1',root,token,ownerId,head:entry.head,branch:entry.branch,relative:entry.relative,before:entry.beforeDigest,after:entry.afterDigest,message,verification,independent};
 if(entry.phase!=='applied' && entry.phase!=='committed') fail('edit_receipt_required');
 return {status:'preview',approvalDigest:digest(JSON.stringify(binding)),writeSet:[entry.relative],baseHead:entry.head};
}
