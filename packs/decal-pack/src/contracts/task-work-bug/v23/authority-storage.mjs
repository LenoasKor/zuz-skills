export * from '../v18/authority-common.mjs';
import { readJson as legacyRead, writePrivateJson as legacyWrite } from '../v18/authority-common.mjs';
import { privateDirectory, assertPrivate } from '../v22/private-storage.mjs';
import { mkdir, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export async function readJson(file) {
 if(process.platform==='win32') {
  try { await lstat(file); } catch(error) { if(error.code==='ENOENT') return null;throw error; }
  await assertPrivate(file);
 }
 return legacyRead(file);
}
export async function writePrivateJson(file,value) {
 if(process.platform!=='win32') return legacyWrite(file,value);
 const parent=path.dirname(file);
 await mkdir(parent,{recursive:true});
 if(await realpath(parent)!==parent || (await lstat(parent)).isSymbolicLink()) throw new Error('unsafe_private_storage');
 const directory=path.join(parent,`.its-private-${randomUUID()}`);
 await privateDirectory(directory);
 const temporary=path.join(directory,'value.json');
 try {
  await writeFile(temporary,`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});
  await assertPrivate(temporary);
  // Same-volume rename retains the source security descriptor, including its private DACL.
  await rename(temporary,file);
  await assertPrivate(file);
 } finally { await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50}); }
}
