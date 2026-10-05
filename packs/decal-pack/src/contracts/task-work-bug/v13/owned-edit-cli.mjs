#!/usr/bin/env node
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginOwnedEdit, applyOwnedEdit, commitOwnedEdit, inspectOwnedEdit, previewOwnedCommit } from './owned-edit.mjs';
import { parseStrictJson } from '../v9/strict-json.mjs';
import { fail } from '../v9/version-profile.mjs';
import { waitForAvailability } from './execution-policy.mjs';
export async function cli(argv) {
 if(Object.hasOwn(process.env,'DECAL_SESSION_ID')) fail('native_writer_required');
 const args=new Map();
 for(let i=0;i<argv.length;i++) {
  if(!['--root','--request','--operation','--approved-plan-digest'].includes(argv[i]) || args.has(argv[i]) || !argv[i+1]) fail('usage_error');
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
   try {const lock=await lstat(path.join(root,'.decal-slice-completion.lock'));return lock.isFile()&&!lock.isSymbolicLink()?{status:'busy'}:{status:'blocked',code:'unsafe_repository_lock'};}
   catch(error){if(error.code==='ENOENT')return {status:'ready'};throw error;}
  });
  if(ready.status!=='ready') return ready;
 }
 return operations[operation]({...request,root,approvedDigest:args.get('--approved-plan-digest')});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {console.log(JSON.stringify(await cli(process.argv.slice(2))));}
 catch(error){console.log(JSON.stringify({status:'rejected',code:error.code??'owned_edit_failed',nextAction:'Inspect the owned edit receipt before another mutation.'}));process.exitCode=2;}
}
