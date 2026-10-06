// Repository-owned Jig contracts remain outside Pack ownership. Trust comes from
// the approved package policy, never from a project's self-declared manifest.
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ID = 'jig.development-task-authoring/v1';
const BASE = 'contracts/jig-task-authoring/v1';
const INITIALIZER = 'contracts/task-work-bug/initialize-task-registry.mjs';
// Unmodified canonical source at zuz-skills 1b99908d82dd9d029662a2efcad395c0af1cbf00.
const HISTORICAL_INITIALIZER = '09fd1a2b0e44b26c58b1d8e58bbb8a98fef8b439b133e4e30093cc803c4a6b52';
const reject = code => { throw Object.assign(new Error(code), { code }); };
export async function resolveRepositoryProfile(packageValue, readCurrent) {
  const observed = await readCurrent(`${BASE}/manifest.json`);
  if (!observed.exists) return null;
  const policyFile = packageValue.files.find(f => f.sourcePath === 'project-skill-pack-policy.json');
  if (!policyFile) reject('repository_profile_not_trusted');
  const policyBytes = Buffer.from(policyFile.contentBase64, 'base64');
  if (hash(policyBytes) !== policyFile.sha256) reject('repository_profile_not_trusted');
  const policy = JSON.parse(policyBytes);
  if (!policy.repositoryAuthoringProfiles?.[ID]?.includes(observed.sha256)) reject('repository_profile_not_trusted');
  const protectedFiles = [];
  async function pin(relative, expected = null) {
    const file = await readCurrent(relative);
    if (!file.exists || (expected !== null && file.sha256 !== expected)) reject('repository_profile_digest_mismatch');
    protectedFiles.push({ path: relative, sha256: file.sha256 });
    return file.bytes;
  }
  const pkg = JSON.parse(await pin('package.json'));
  const tauri = JSON.parse(await pin('src-tauri/tauri.conf.json'));
  if (pkg.name !== 'jig' || tauri.productName !== 'Jig' || tauri.identifier !== 'com.jeremy.jig') reject('repository_profile_identity_mismatch');
  const manifest = JSON.parse(await pin(`${BASE}/manifest.json`, observed.sha256));
  if (manifest.schema !== 'jig.development-task-authoring.manifest/v1' || !manifest.files?.['contract.json']) reject('repository_profile_invalid');
  for (const [relative, digest] of Object.entries(manifest.files)) await pin(`${BASE}/${relative}`, digest);
  const contract = JSON.parse((await readCurrent(`${BASE}/contract.json`)).bytes);
  if (contract.contractId !== ID || contract.taskDocumentContract !== 'decal.task-work-bug/v4') reject('repository_profile_invalid');
  const preservedPaths = [];
  for (const version of ['v1', 'v2', 'v3', 'v4']) {
    const prefix = `contracts/task-work-bug/${version}`;
    const relative = `${prefix}/manifest.json`;
    const digest = contract.consumerManifestSha256?.[version];
    if (!/^[a-f0-9]{64}$/.test(digest ?? '')) reject('repository_profile_invalid');
    const consumer = JSON.parse(await pin(relative, digest));
    preservedPaths.push(relative);
    if (!consumer.files || Array.isArray(consumer.files)) reject('repository_profile_invalid');
    for (const [name, expected] of Object.entries(consumer.files)) {
      await pin(`${prefix}/${name}`, expected);
      preservedPaths.push(`${prefix}/${name}`);
    }
  }
  const initializer = await readCurrent(INITIALIZER);
  if (initializer.exists && initializer.sha256 === HISTORICAL_INITIALIZER) {
    await pin(INITIALIZER, HISTORICAL_INITIALIZER);
    preservedPaths.push(INITIALIZER);
  }
  return { id: ID, manifestSha256: observed.sha256, preservedPaths: preservedPaths.sort(), protectedFiles: protectedFiles.sort((a,b)=>a.path.localeCompare(b.path)) };
}
