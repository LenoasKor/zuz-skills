import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, writeFile, symlink, link, rm, cp, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { privateDirectory, assertPrivate } from '../packs/decal-pack/src/contracts/task-work-bug/v21/private-storage.mjs';

test('Windows private storage rejects public ACLs, symbolic links and hard links', {skip: process.platform !== 'win32'}, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'zuz-private-')));
  try {
    const directory = path.join(root, 'private');
    await privateDirectory(directory);
    const file = path.join(directory, 'secret');
    await writeFile(file, 'synthetic fixture', {flag: 'wx'});
    await assertPrivate(file);
    const alias = path.join(directory, 'alias');
    await symlink(file, alias, 'file');
    await assert.rejects(assertPrivate(alias));
    await rm(alias);
    await link(file, alias);
    await assert.rejects(assertPrivate(file));
    await rm(alias);
    const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'
$acl=[System.IO.File]::GetAccessControl($env:ZUZ_TEST_PRIVATE_FILE)
$sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow')
$acl.AddAccessRule($rule)
[System.IO.File]::SetAccessControl($env:ZUZ_TEST_PRIVATE_FILE,$acl)
`], {windowsHide: true, env: {...process.env, ZUZ_TEST_PRIVATE_FILE: file}});
    await assert.rejects(assertPrivate(file));
  } finally { await rm(root, {recursive: true, force: true, maxRetries: 5}); }
});

test('Windows LAN contract rejects actual dependency byte tampering', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'zuz-lan-integrity-')));
  try {
    await cp(new URL('../packs/decal-pack/src/contracts/task-work-bug/', import.meta.url), root, {recursive: true});
    const verifier = path.join(root, 'v22/verify-contract.mjs');
    const check = () => JSON.parse(execFileSync(process.execPath, [verifier], {encoding: 'utf8'}));
    assert.equal(check().status, 'accepted');
    for (const relative of ['v18/authority-common.mjs', 'v21/private-storage.mjs']) {
      const file = path.join(root, relative);
      await appendFile(file, '\n// tampered dependency\n');
      assert.throws(check);
      await cp(new URL(`../packs/decal-pack/src/contracts/task-work-bug/${relative}`, import.meta.url), file);
    }
    assert.equal(check().status, 'accepted');
  } finally { await rm(root, {recursive: true, force: true, maxRetries: 5}); }
});
