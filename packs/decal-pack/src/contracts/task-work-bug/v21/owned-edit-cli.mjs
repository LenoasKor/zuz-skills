#!/usr/bin/env node
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginOwnedEdit, applyOwnedEdit, commitOwnedEdit, inspectOwnedEdit, previewOwnedCommit } from './owned-edit.mjs';
import { parseStrictJson } from '../v9/strict-json.mjs';
import { fail } from '../v9/version-profile.mjs';
import { waitForAvailability } from '../v13/execution-policy.mjs';
export async function cli(argv, {signal} = {}) {
 if(Object.hasOwn(process.env,'DECAL_SESSION_ID')) fail('native_writer_required');
 const args=new Map();
 for(let i=0;i<argv.length;i++) {
  if(!['--root','--request','--operation','--approved-plan-digest'].includes(argv[i]) || args.has(argv[i]) || !argv[i+1] || argv[i+1].startsWith('--')) fail('usage_error');
  args.set(argv[i],argv[++i]);
 }
 if(!args.get('--root') || !args.get('--request')) fail('usage_error');
 const requestPath=path.resolve(args.get('--request'));const stat=await lstat(requestPath);
 if(!stat.isFile() || stat.isSymbolicLink() || stat.size>2*1024*1024) fail('unsafe_request_file');
 const request=parseStrictJson(await readFile(requestPath,'utf8'));
 if(!request || Array.isArray(request) || typeof request!=='object' || Object.hasOwn(request,'root') || Object.hasOwn(request,'approvedDigest')) fail('invalid_request');
 const operations={capture:beginOwnedEdit,apply:applyOwnedEdit,inspect:inspectOwnedEdit,preview:previewOwnedCommit,commit:commitOwnedEdit};
 const operation=args.get('--operation');if(!Object.hasOwn(operations,operation)) fail('usage_error');
 const root=path.resolve(args.get('--root'));
 if(!['inspect','preview'].includes(operation)) {
  const ready=await waitForAvailability(async()=>{
   try {
    const lockPath=path.join(root,'.decal-slice-completion.lock');
    const lock=await lstat(lockPath);
    if(!lock.isFile() || lock.isSymbolicLink() || lock.size>4096) return {status:'blocked',code:'unsafe_repository_lock'};
    let owner;
    try {owner=parseStrictJson(await readFile(lockPath,'utf8'));} catch {return {status:'blocked',code:'unknown_lock_owner'};}
    if(!Number.isSafeInteger(owner.pid) || owner.pid<1) return {status:'blocked',code:'unknown_lock_owner'};
    try {process.kill(owner.pid,0);} catch(error) {if(error.code==='ESRCH') return {status:'busy',ownerActive:false};}
    return {status:'busy'};
   }
   catch(error){if(error.code==='ENOENT')return {status:'ready'};throw error;}
  }, {signal});
  if(ready.status!=='ready') return ready;
 }
 if(signal?.aborted) return {status:'blocked',code:'cancelled'};
 return operations[operation]({...request,root,approvedDigest:args.get('--approved-plan-digest')});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const controller=new AbortController();
 const cancel=()=>controller.abort();
 process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
 try {console.log(JSON.stringify(await cli(process.argv.slice(2),{signal:controller.signal})));}
 catch(error){console.log(JSON.stringify({status:'rejected',code:error.code??'owned_edit_failed',nextAction:'Inspect the owned edit receipt before another mutation.'}));process.exitCode=2;}
 finally {process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
}
