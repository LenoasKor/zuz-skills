// Private JSON storage for the LAN authority and client.
// macOS and Linux: owner-only files, refused when they are links, shared, or owned by someone else; atomic replacement.
// Windows keeps the owner-only DACL route of v22 and v23.
export * from "../v18/authority-common.mjs";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { deviceHome } from "../v18/authority-common.mjs";
import { assertPrivate } from "../v22/private-storage.mjs";
import { readJson as windowsRead, writePrivateJson as windowsWrite } from "../v23/authority-storage.mjs";

const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const NON_BLOCK = fsConstants.O_NONBLOCK ?? 0;
const LINK_ERRORS = new Set(["ELOOP", "EMLINK", "EFTYPE"]);

function refuse(target, reason) {
  const error = new Error(`unsafe_private_storage: ${reason}: ${target}`);
  error.code = "unsafe_private_storage";
  error.detail = `${reason}: ${target}`;
  throw error;
}

const lstatOrNull = (target) => lstat(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
const isInside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

/** The device home belongs to this tool, so it may be tightened. A project's `.decal`, the user's home and `/` never are. */
function ownedByTool(directory) {
  const home = path.resolve(deviceHome());
  return isInside(home, directory) && home !== path.resolve(os.homedir()) && home !== path.parse(home).root;
}

/** Directories this storage answers for, from the outermost down: the device home, or the project's `.decal` and below. */
function storageChain(directory) {
  const target = path.resolve(directory);
  const parts = target.split(path.sep);
  const home = path.resolve(deviceHome());
  const dotDecal = parts.lastIndexOf(".decal");
  let top = target;
  if (isInside(home, target)) top = home;
  else if (dotDecal > 0) top = parts.slice(0, dotDecal + 1).join(path.sep);
  const chain = [top];
  for (const part of path.relative(top, target).split(path.sep).filter(Boolean)) chain.push(path.join(chain.at(-1), part));
  return chain;
}

function assertDirectory(directory, stat) {
  if (stat.isSymbolicLink()) refuse(directory, "directory_is_a_symbolic_link");
  if (!stat.isDirectory()) refuse(directory, "not_a_directory");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) refuse(directory, "directory_has_another_owner");
}

async function checkPermissions(directory, stat) {
  if ((stat.mode & 0o077) === 0) return;
  if (ownedByTool(directory)) {
    await chmod(directory, 0o700);
    if (((await lstat(directory)).mode & 0o077) !== 0) refuse(directory, "directory_could_not_be_tightened");
    return;
  }
  // The file's own mode, owner and no-follow checks protect it inside a directory such as a 0755 project `.decal`.
  // A directory anyone may write to is the exception: refuse it instead of changing the user's permissions.
  if ((stat.mode & 0o002) !== 0) refuse(directory, "directory_is_world_writable");
}

/** Creates missing directories as 0700, and refuses a link, another owner or a world-writable directory. Windows only creates. */
export async function ensurePrivateDirectory(directory) {
  if (process.platform === "win32") { await mkdir(directory, { recursive: true }); return; }
  const chain = storageChain(directory);
  await mkdir(path.dirname(chain[0]), { recursive: true, mode: 0o700 });
  for (const item of chain) {
    let stat = await lstatOrNull(item);
    if (!stat) {
      await mkdir(item, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
      stat = await lstat(item);
    }
    assertDirectory(item, stat);
    await checkPermissions(item, stat);
  }
}

function assertPrivateFile(file, stat) {
  if (!stat.isFile()) refuse(file, "not_a_regular_file");
  if (stat.nlink !== 1) refuse(file, "file_has_other_links");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) refuse(file, "file_has_another_owner");
  if ((stat.mode & 0o077) !== 0) refuse(file, "file_is_readable_by_others_run_chmod_600");
}

export async function readJson(file) {
  if (process.platform === "win32") return windowsRead(file);
  for (const item of storageChain(path.dirname(file))) {
    const stat = await lstatOrNull(item);
    if (!stat) return null;
    assertDirectory(item, stat);
  }
  let handle;
  try {
    handle = await open(file, fsConstants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (LINK_ERRORS.has(error.code)) refuse(file, "file_is_a_symbolic_link");
    throw error;
  }
  try {
    assertPrivateFile(file, await handle.stat());
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

export async function writePrivateJson(file, value) {
  if (process.platform === "win32") return windowsWrite(file, value);
  const parent = path.dirname(file);
  await ensurePrivateDirectory(parent);
  const existing = await lstatOrNull(file);
  if (existing?.isSymbolicLink()) refuse(file, "file_is_a_symbolic_link");
  if (existing && !existing.isFile()) refuse(file, "not_a_regular_file");
  const temporary = path.join(parent, `.${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW, 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await handle.sync();
      assertPrivateFile(temporary, await handle.stat());
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const directory = await open(parent, fsConstants.O_RDONLY).catch(() => null);
  if (directory) { await directory.sync().catch(() => {}); await directory.close(); }
}

// ---- Windows files written before the owner-only DACL check existed
const LEGACY_MAX_BYTES = 16 * 1024 * 1024;

/** Whether a file that failed the private-storage check may be rewritten. Only a wrong DACL is repairable; everything else stays refused. */
export function legacyAclDecision({ isFile, isSymbolicLink, nlink, realpathMatches, ownedByCurrentUser, contentValid }) {
  if (isSymbolicLink) return { migrate: false, reason: "symbolic_link" };
  if (!isFile) return { migrate: false, reason: "not_a_regular_file" };
  if (nlink !== 1) return { migrate: false, reason: "other_hard_links" };
  if (!realpathMatches) return { migrate: false, reason: "path_mismatch" };
  if (!ownedByCurrentUser) return { migrate: false, reason: "another_owner" };
  if (!contentValid) return { migrate: false, reason: "invalid_content" };
  return { migrate: true, reason: null };
}

/** Same static-script pattern as v22: the path is data in the child environment, never PowerShell code. */
function windowsOwnerIsCurrentUser(file) {
  const script = `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.IO.File]::GetAccessControl($env:ZUZ_PRIVATE_PATH)
if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner' }
`;
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve) => {
    execFile(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true, timeout: 15000, maxBuffer: 65536, env: { ...process.env, ZUZ_PRIVATE_PATH: file },
    }, (error) => resolve(!error));
  });
}

/**
 * Rewrites one known file through the private route when the DACL is its only fault. `original` is rethrown otherwise and
 * the file stays untouched. `ownerIsCurrentUser`, `write` and `verify` are parameters so the decision is testable on any OS.
 */
export async function migrateLegacyAcl(file, isValid, original, { ownerIsCurrentUser = windowsOwnerIsCurrentUser, write = windowsWrite, verify = assertPrivate } = {}) {
  const stat = await lstat(file).catch(() => null);
  if (!stat) throw original;
  const facts = { isFile: stat.isFile(), isSymbolicLink: stat.isSymbolicLink(), nlink: stat.nlink, realpathMatches: false, ownedByCurrentUser: false, contentValid: false };
  let value;
  if (facts.isFile && !facts.isSymbolicLink && facts.nlink === 1 && stat.size <= LEGACY_MAX_BYTES) {
    facts.realpathMatches = path.resolve(file) === file && await realpath(file).then((real) => real === file, () => false);
    if (facts.realpathMatches) facts.ownedByCurrentUser = await ownerIsCurrentUser(file);
    if (facts.ownedByCurrentUser) {
      try { value = JSON.parse(await readFile(file, "utf8")); facts.contentValid = isValid(value) === true; } catch { facts.contentValid = false; }
    }
  }
  if (!legacyAclDecision(facts).migrate) throw original;
  await write(file, value);
  await verify(file);
  return { value, migrated: true };
}

/** `readJson` for a file whose exact path and schema the caller knows. On Windows it repairs a DACL from before the check existed. */
export async function readJsonMigratingLegacyAcl(file, isValid) {
  try {
    return { value: await readJson(file), migrated: false };
  } catch (error) {
    if (process.platform !== "win32" || error.code !== "unsafe_private_storage") throw error;
    return migrateLegacyAcl(file, isValid, error);
  }
}
