import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { planInstallation, installPackage } from '../scripts/install-decal-pack.mjs';
import { sha256, stableJson, repositoryRoot } from '../scripts/pack-lib.mjs';
const revision = 'a'.repeat(40);
const descriptor = JSON.parse(await readFile(path.join(repositoryRoot,'packs/decal-pack/pack.source.json')));
execFileSync(process.execPath,[path.join(repositoryRoot,'scripts/build-decal-pack.mjs'),'--source-revision',revision]);
const original = JSON.parse(await readFile(path.join(repositoryRoot,`dist/decal-pack-${descriptor.packVersion}.zuz-pack.json`)));
const profilePath='contracts/jig-task-authoring/v1';
function seal(value) {
 const next=structuredClone(value); delete next.manifestSha256;
 return {...next,manifestSha256:sha256(stableJson({...next,files:next.files.map(({contentBase64,...f})=>f)}))};
}
async function fixture(t) {
 const parent=await mkdtemp(path.join(tmpdir(),'jig-profile-installer-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const root=path.join(parent,'project');await mkdir(root);
 const packagePath=path.join(parent,'pack.json');await writeFile(packagePath,JSON.stringify(original));
 const options={rootValue:root,packagePath,modules:['zuz-its'],providers:['acp','claude','codex','gemini']};
 const first=await planInstallation(options);await installPackage({...options,approvedPlanDigest:first.installationPlanDigest});
 await rm(path.join(root,'.decal/decal-pack.lock.json'));
 await writeFile(path.join(root,'package.json'),JSON.stringify({name:'jig'}));await mkdir(path.join(root,'src-tauri'));
 await writeFile(path.join(root,'src-tauri/tauri.conf.json'),JSON.stringify({productName:'Jig',identifier:'com.jeremy.jig'}));
 const consumers={};
 for(const version of ['v1','v2','v3','v4']) {
  const prefix=path.join(root,'contracts/task-work-bug',version);
  const file=path.join(prefix,'manifest.json');const manifest=JSON.parse(await readFile(file));
  if(version==='v1') {
   const bytes=Buffer.from('Historical accepted Jig README\n');await writeFile(path.join(prefix,'README.md'),bytes);manifest.files['README.md']=sha256(bytes);await writeFile(file,JSON.stringify(manifest));
  }
  consumers[version]=sha256(await readFile(file));
 }
 const contract=Buffer.from(JSON.stringify({contractId:'jig.development-task-authoring/v1',taskDocumentContract:'decal.task-work-bug/v4',consumerManifestSha256:consumers}));
 const manifest=Buffer.from(JSON.stringify({schema:'jig.development-task-authoring.manifest/v1',files:{'contract.json':sha256(contract)}}));
 await mkdir(path.join(root,profilePath),{recursive:true});await writeFile(path.join(root,profilePath,'contract.json'),contract);await writeFile(path.join(root,profilePath,'manifest.json'),manifest);
 const value=structuredClone(original);const policy=value.files.find(f=>f.sourcePath==='project-skill-pack-policy.json');const body=JSON.parse(Buffer.from(policy.contentBase64,'base64'));
 body.repositoryAuthoringProfiles={'jig.development-task-authoring/v1':[sha256(manifest)]};
 const bytes=Buffer.from(JSON.stringify(body));policy.contentBase64=bytes.toString('base64');policy.size=bytes.length;policy.sha256=sha256(bytes);
 await writeFile(packagePath,JSON.stringify(seal(value)));
 // Make a genuine non-protected write, so rollback and approval tests exercise mutations.
 await rm(path.join(root,'.agents/skills/decal-task/SKILL.md'));
 return {root,options};
}
test('trusted Jig profile preserves historical consumers and emits exact ownership receipt',async t=>{
 const {root,options}=await fixture(t);const file=path.join(root,'contracts/task-work-bug/v1/README.md');const before=await readFile(file);
 const plan=await planInstallation(options);assert.equal(plan.status,'planned');assert.equal(plan.conflicts.length,0);
 assert.ok(plan.repositoryProfile.preservedPaths.includes('contracts/task-work-bug/v1/README.md'));
 assert.ok(!plan.writeSet.some(p=>p.startsWith('contracts/task-work-bug/v1/')));
 await installPackage({...options,approvedPlanDigest:plan.installationPlanDigest});assert.deepEqual(await readFile(file),before);
 const receipt=JSON.parse(await readFile(path.join(root,'.decal/decal-pack.lock.json')));assert.deepEqual(receipt.repositoryProfile,plan.repositoryProfile);
 assert.ok(!receipt.files.some(f=>f.path.startsWith('contracts/task-work-bug/v1/')));
 assert.equal((await planInstallation(options)).status,'current');
});
for(const [name,relative,content] of [
 ['changed consumer','contracts/task-work-bug/v1/README.md','tampered'],
 ['changed profile',`${profilePath}/contract.json`,'{}'],
 ['untrusted manifest',`${profilePath}/manifest.json`,'{}'],
 ['wrong product','package.json','{"name":"different"}'],
]) test(name+' rejects before installation',async t=>{
 const {root,options}=await fixture(t);await writeFile(path.join(root,relative),content);
 await assert.rejects(()=>planInstallation(options));
 await assert.rejects(()=>readFile(path.join(root,'.decal/decal-pack.lock.json')));
});
test('profile drift invalidates approval; unrelated modified files remain blocked',async t=>{
 const {root,options}=await fixture(t);const plan=await planInstallation(options);
 await writeFile(path.join(root,'package.json'),'{"name":"jig","newField":true}');
 await assert.rejects(()=>installPackage({...options,approvedPlanDigest:plan.installationPlanDigest}),/approval_plan_digest_mismatch/);
 await writeFile(path.join(root,'.claude/skills/decal-task/SKILL.md'),'user edits');
 const next=await planInstallation(options);assert.equal(next.status,'blocked');
 assert.ok(next.conflicts.includes('.claude/skills/decal-task/SKILL.md'));
});
test('profile symlinks reject and failure rolls back non-protected writes',async t=>{
 const {root,options}=await fixture(t);const plan=await planInstallation(options);
 const pinned=await readFile(path.join(root,'contracts/task-work-bug/v1/README.md'));
 await assert.rejects(()=>installPackage({...options,approvedPlanDigest:plan.installationPlanDigest,testFailAt:"after_first_write"}));
 assert.deepEqual(await readFile(path.join(root,'contracts/task-work-bug/v1/README.md')),pinned);
 await assert.rejects(()=>readFile(path.join(root,'.decal/decal-pack.lock.json')));
 const contract=path.join(root,profilePath,'contract.json');await rm(contract);await symlink(path.join(root,'package.json'),contract);
 await assert.rejects(()=>planInstallation(options),/symlink_rejected/);
});
test('profile removal is explicit rejection, never automatic contract retirement',async t=>{
 const {options}=await fixture(t);
 await assert.rejects(()=>planInstallation({...options,modules:['development-core']}),/repository_profile_its_removal_requires_owner/);
});

test('missing previously adopted profile rejects subsequent updates',async t=>{
 const {root,options}=await fixture(t);const plan=await planInstallation(options);
 await installPackage({...options,approvedPlanDigest:plan.installationPlanDigest});
 await rm(path.join(root,profilePath,'manifest.json'));
 await assert.rejects(()=>planInstallation(options),/repository_profile_missing/);
});
