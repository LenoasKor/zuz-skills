#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertSafeRelativePath, stableJson } from "./pack-lib.mjs";

const INSTALLATION_LOCK_RELATIVE = ".decal/decal-pack.lock.json";
const TRANSACTION_LOCK_RELATIVE = ".decal/decal-pack.installing.lock";
const PLAN_SCHEMA = "zuz.decal-pack.installation-plan/v1";
const PLAN_BINDING_SCHEMA = "zuz.decal-pack.installation-plan-approval/v1";
const LOCK_SCHEMA = "zuz.decal-pack.installation-lock/v1";
const KNOWN_PROVIDERS = new Set(["codex", "claude", "gemini", "acp"]);

function fail(code, detail = null) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function prefixedSha256(bytes) {
  return `sha256:${sha256(bytes)}`;
}

function args(argv) {
  const result = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail("usage_error");
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result.set(key, true);
    else {
      const current = result.get(key);
      if (current === undefined) result.set(key, next);
      else result.set(key, [...(Array.isArray(current) ? current : [current]), next]);
      index += 1;
    }
  }
  return result;
}

function values(parsed, key) {
  const value = parsed.get(key);
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

async function metadata(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function canonicalProjectRoot(rootValue) {
  const requested = path.resolve(rootValue);
  const requestedMetadata = await metadata(requested);
  if (!requestedMetadata?.isDirectory() || requestedMetadata.isSymbolicLink()) fail("invalid_project_root");
  const canonical = await realpath(requested);
  const canonicalMetadata = await lstat(canonical);
  if (!canonicalMetadata.isDirectory() || canonicalMetadata.isSymbolicLink()) fail("invalid_project_root");
  return canonical;
}

async function plainTarget(root, relative) {
  assertSafeRelativePath(relative);
  const target = path.resolve(root, ...relative.split("/"));
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) fail("path_escape", relative);
  let current = root;
  const parts = inside.split(path.sep);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const currentMetadata = await metadata(current);
    if (!currentMetadata) break;
    if (currentMetadata.isSymbolicLink()) fail("symlink_rejected", relative);
    if (index < parts.length - 1 && !currentMetadata.isDirectory()) fail("not_a_directory", relative);
    if (index === parts.length - 1 && !currentMetadata.isFile()) fail("not_a_plain_file", relative);
  }
  return target;
}

async function ensurePlainDirectories(root, directory) {
  const relative = path.relative(root, directory);
  if (relative === "") return [];
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("path_escape");
  const created = [];
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let currentMetadata = await metadata(current);
    if (!currentMetadata) {
      try {
        await mkdir(current, { mode: 0o700 });
        created.push(current);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      currentMetadata = await lstat(current);
    }
    if (currentMetadata.isSymbolicLink()) fail("symlink_rejected");
    if (!currentMetadata.isDirectory()) fail("not_a_directory");
  }
  return created;
}

function verifyPackage(value) {
  if (
    !value
    || value.schemaVersion !== 1
    || value.packId !== "decal-project-pack"
    || !/^\d+\.\d+\.\d+$/u.test(value.packVersion ?? "")
    || !/^[0-9a-f]{40}$/u.test(value.sourceRevision ?? "")
    || !Array.isArray(value.modules)
    || !Array.isArray(value.files)
    || !/^[0-9a-f]{64}$/u.test(value.manifestSha256 ?? "")
  ) fail("unsupported_package");
  if (value.files.some((file) => !file || typeof file !== "object")) fail("unsupported_package");
  const moduleIds = new Set();
  for (const module of value.modules) {
    if (!module || typeof module.id !== "string" || moduleIds.has(module.id)) fail("unsupported_package");
    moduleIds.add(module.id);
  }
  const unsigned = { ...value };
  delete unsigned.manifestSha256;
  unsigned.files = value.files.map(({ contentBase64: _contentBase64, ...file }) => file);
  const computedManifest = sha256(stableJson(unsigned));
  if (computedManifest !== value.manifestSha256) fail("manifest_digest_mismatch");
  for (const file of value.files) {
    if (
      !file
      || typeof file.sourcePath !== "string"
      || !moduleIds.has(file.moduleId)
      || !/^[0-9a-f]{64}$/u.test(file.sha256 ?? "")
      || !Number.isSafeInteger(file.size)
      || file.size < 0
      || typeof file.contentBase64 !== "string"
      || !Array.isArray(file.installTargets)
    ) fail("unsupported_package");
    const bytes = Buffer.from(file.contentBase64, "base64");
    if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) fail("file_digest_mismatch", file.sourcePath);
    for (const target of file.installTargets) {
      if (!target || typeof target.path !== "string" || (target.provider !== "shared" && !KNOWN_PROVIDERS.has(target.provider))) {
        fail("unsupported_package");
      }
      assertSafeRelativePath(target.path);
      if (target.path === INSTALLATION_LOCK_RELATIVE || target.path === TRANSACTION_LOCK_RELATIVE) fail("unsupported_package");
    }
  }
  return value;
}

async function loadPackage(packagePath) {
  const packageBytes = await readFile(path.resolve(packagePath));
  let packageValue;
  try {
    packageValue = JSON.parse(packageBytes.toString("utf8"));
  } catch {
    fail("unsupported_package");
  }
  return { packageValue: verifyPackage(packageValue), packageSha256: sha256(packageBytes) };
}

function normalizeSelection(input, allowed, errorCode) {
  if (!input.length || input.some((value) => typeof value !== "string" || !allowed.has(value))) fail(errorCode);
  if (new Set(input).size !== input.length) fail("duplicate_selection");
  return [...input].sort((left, right) => left.localeCompare(right));
}

function sameSelection(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateInstallationLock(value, expectedPackId) {
  if (
    !value
    || value.schema !== LOCK_SCHEMA
    || value.packId !== expectedPackId
    || !/^\d+\.\d+\.\d+$/u.test(value.packVersion ?? "")
    || !/^[0-9a-f]{40}$/u.test(value.sourceRevision ?? "")
    || !/^[0-9a-f]{64}$/u.test(value.manifestSha256 ?? "")
    || !Array.isArray(value.modules)
    || !Array.isArray(value.providers)
    || !Array.isArray(value.files)
  ) fail("unsupported_installation_lock");
  if (
    value.modules.some((item) => typeof item !== "string" || !item)
    || value.providers.some((item) => !KNOWN_PROVIDERS.has(item))
    || new Set(value.modules).size !== value.modules.length
    || new Set(value.providers).size !== value.providers.length
  ) fail("unsupported_installation_lock");
  if (value.packageSha256 !== undefined && !/^[0-9a-f]{64}$/u.test(value.packageSha256)) fail("unsupported_installation_lock");
  if (value.mode !== undefined && !new Set(["initial-pack-bootstrap", "update"]).has(value.mode)) fail("unsupported_installation_lock");
  if (value.installationPlanDigest !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(value.installationPlanDigest)) {
    fail("unsupported_installation_lock");
  }
  if (value.previousRelease !== undefined && value.previousRelease !== null) {
    if (
      typeof value.previousRelease !== "object"
      || !/^\d+\.\d+\.\d+$/u.test(value.previousRelease.packVersion ?? "")
      || !/^[0-9a-f]{40}$/u.test(value.previousRelease.sourceRevision ?? "")
      || !/^[0-9a-f]{64}$/u.test(value.previousRelease.manifestSha256 ?? "")
      || !(value.previousRelease.packageSha256 === undefined || value.previousRelease.packageSha256 === null || /^[0-9a-f]{64}$/u.test(value.previousRelease.packageSha256))
      || !(value.previousRelease.installationPlanDigest === null || /^sha256:[0-9a-f]{64}$/u.test(value.previousRelease.installationPlanDigest ?? ""))
    ) fail("unsupported_installation_lock");
  }
  if (value.obsoleteManagedFiles !== undefined && !Array.isArray(value.obsoleteManagedFiles)) fail("unsupported_installation_lock");
  const seen = new Set();
  for (const file of value.files) {
    if (
      !file
      || typeof file.path !== "string"
      || (file.provider !== "shared" && !KNOWN_PROVIDERS.has(file.provider))
      || !/^[0-9a-f]{64}$/u.test(file.sha256 ?? "")
      || seen.has(file.path)
      || file.path === INSTALLATION_LOCK_RELATIVE
      || file.path === TRANSACTION_LOCK_RELATIVE
    ) fail("unsupported_installation_lock");
    assertSafeRelativePath(file.path);
    seen.add(file.path);
  }
  for (const file of value.obsoleteManagedFiles ?? []) {
    if (
      !file
      || typeof file.path !== "string"
      || (file.provider !== "shared" && !KNOWN_PROVIDERS.has(file.provider))
      || !/^[0-9a-f]{64}$/u.test(file.sha256 ?? "")
      || seen.has(file.path)
      || file.path === INSTALLATION_LOCK_RELATIVE
      || file.path === TRANSACTION_LOCK_RELATIVE
    ) fail("unsupported_installation_lock");
    assertSafeRelativePath(file.path);
    seen.add(file.path);
  }
  return value;
}

async function readInstallationLock(root, expectedPackId) {
  const target = await plainTarget(root, INSTALLATION_LOCK_RELATIVE);
  const targetMetadata = await metadata(target);
  if (!targetMetadata) return null;
  const bytes = await readFile(target);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("unsupported_installation_lock");
  }
  return { target, bytes, digest: sha256(bytes), value: validateInstallationLock(value, expectedPackId) };
}

async function currentFile(root, relative) {
  const target = await plainTarget(root, relative);
  try {
    const bytes = await readFile(target);
    return { target, exists: true, bytes, sha256: sha256(bytes) };
  } catch (error) {
    if (error?.code === "ENOENT") return { target, exists: false, bytes: null, sha256: null };
    throw error;
  }
}

function desiredFiles(packageValue, modules, providers) {
  const selectedModules = new Set(modules);
  const selectedProviders = new Set(providers);
  const planned = new Map();
  for (const file of packageValue.files) {
    if (!selectedModules.has(file.moduleId)) continue;
    for (const target of file.installTargets) {
      if (target.provider !== "shared" && !selectedProviders.has(target.provider)) continue;
      const existing = planned.get(target.path);
      if (existing && existing.sha256 !== file.sha256) fail("duplicate_target_conflict", target.path);
      planned.set(target.path, {
        path: target.path,
        provider: target.provider,
        sha256: file.sha256,
        bytes: Buffer.from(file.contentBase64, "base64"),
      });
    }
  }
  return [...planned.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function releaseIdentity(packageValue, packageSha256) {
  return {
    packVersion: packageValue.packVersion,
    sourceRevision: packageValue.sourceRevision,
    manifestSha256: packageValue.manifestSha256,
    packageSha256,
  };
}

function previousRelease(lock) {
  if (!lock) return null;
  return {
    packVersion: lock.value.packVersion,
    sourceRevision: lock.value.sourceRevision,
    manifestSha256: lock.value.manifestSha256,
    packageSha256: typeof lock.value.packageSha256 === "string" ? lock.value.packageSha256 : null,
    installationPlanDigest: typeof lock.value.installationPlanDigest === "string"
      ? lock.value.installationPlanDigest
      : null,
  };
}

async function createInstallationPlan({ packagePath, rootValue, modules: moduleInput, providers: providerInput }) {
  const root = await canonicalProjectRoot(rootValue);
  const { packageValue, packageSha256 } = await loadPackage(packagePath);
  const knownModules = new Set(packageValue.modules.map((module) => module.id));
  const modules = normalizeSelection(moduleInput, knownModules, "unknown_module");
  const providers = normalizeSelection(providerInput, KNOWN_PROVIDERS, "unknown_provider");
  const lock = await readInstallationLock(root, packageValue.packId);
  if (lock) {
    const lockedModules = [...lock.value.modules].sort((left, right) => left.localeCompare(right));
    const lockedProviders = [...lock.value.providers].sort((left, right) => left.localeCompare(right));
    if (!sameSelection(modules, lockedModules) || !sameSelection(providers, lockedProviders)) {
      fail("selection_change_requires_separate_flow", { modules: lock.value.modules, providers: lock.value.providers });
    }
  }

  const mode = lock ? "update" : "initial-pack-bootstrap";
  const previousManagedFiles = [
    ...(lock?.value.files ?? []),
    ...(lock?.value.obsoleteManagedFiles ?? []),
  ];
  const previousByPath = new Map(previousManagedFiles.map((file) => [file.path, file]));
  const desired = desiredFiles(packageValue, modules, providers);
  const desiredPaths = new Set(desired.map((file) => file.path));
  const entries = [];
  for (const file of desired) {
    const current = await currentFile(root, file.path);
    const previous = previousByPath.get(file.path) ?? null;
    let state;
    let conflictReason = null;
    if (!current.exists) {
      if (previous) {
        state = "conflict";
        conflictReason = "managed_file_missing";
      } else state = "create";
    } else if (current.sha256 === file.sha256) state = "unchanged";
    else if (previous && current.sha256 === previous.sha256) state = "update";
    else {
      state = "conflict";
      conflictReason = previous ? "managed_file_modified" : "unmanaged_target_present";
    }
    entries.push({
      ...file,
      target: current.target,
      state,
      previousSha256: previous?.sha256 ?? null,
      currentSha256: current.sha256,
      conflictReason,
    });
  }

  const obsoleteManagedFiles = [];
  for (const previous of [...previousByPath.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    if (desiredPaths.has(previous.path)) continue;
    const current = await currentFile(root, previous.path);
    obsoleteManagedFiles.push({
      path: previous.path,
      provider: previous.provider,
      sha256: previous.sha256,
      observedState: !current.exists ? "missing" : current.sha256 === previous.sha256 ? "managed" : "modified",
      observedSha256: current.sha256,
    });
  }

  const conflictDetails = entries
    .filter((entry) => entry.state === "conflict")
    .map(({ path: filePath, conflictReason, currentSha256, previousSha256, sha256: desiredSha256 }) => ({
      path: filePath,
      reason: conflictReason,
      currentSha256,
      previousSha256,
      desiredSha256,
    }));
  const release = releaseIdentity(packageValue, packageSha256);
  const priorRelease = previousRelease(lock);
  const releaseAlreadyCurrent = Boolean(lock)
    && lock.value.packVersion === packageValue.packVersion
    && lock.value.sourceRevision === packageValue.sourceRevision
    && lock.value.manifestSha256 === packageValue.manifestSha256
    && lock.value.packageSha256 === packageSha256
    && new Set(["initial-pack-bootstrap", "update"]).has(lock.value.mode)
    && /^sha256:[0-9a-f]{64}$/u.test(lock.value.installationPlanDigest ?? "");
  const status = conflictDetails.length > 0
    ? "blocked"
    : releaseAlreadyCurrent
      && entries.every((entry) => entry.state === "unchanged")
      ? "current"
      : "planned";
  const writeSet = status === "current"
    ? []
    : [
      ...entries.filter((entry) => entry.state === "create" || entry.state === "update").map((entry) => entry.path),
      INSTALLATION_LOCK_RELATIVE,
    ];
  const plannedFiles = entries.map(({ path: filePath, provider, sha256: desiredSha256, state, previousSha256, currentSha256 }) => ({
    path: filePath,
    provider,
    sha256: desiredSha256,
    state,
    previousSha256,
    currentSha256,
  }));
  const approvalBinding = {
    schema: PLAN_BINDING_SCHEMA,
    mode,
    projectRoot: root,
    packId: packageValue.packId,
    release,
    previousRelease: priorRelease,
    previousLockSha256: lock?.digest ?? null,
    modules,
    providers,
    plannedFiles,
    obsoleteManagedFiles,
    writeSet,
  };
  const installationPlanDigest = prefixedSha256(stableJson(approvalBinding));
  const lockValue = {
    schema: LOCK_SCHEMA,
    packId: packageValue.packId,
    packVersion: packageValue.packVersion,
    sourceRevision: packageValue.sourceRevision,
    manifestSha256: packageValue.manifestSha256,
    packageSha256,
    mode,
    installationPlanDigest,
    previousRelease: priorRelease,
    modules,
    providers,
    files: entries.map(({ path: filePath, provider, sha256: digest }) => ({ path: filePath, provider, sha256: digest })),
    obsoleteManagedFiles,
  };
  const lockBytes = Buffer.from(`${JSON.stringify(lockValue, null, 2)}\n`);
  return {
    packageValue,
    root,
    lock,
    lockBytes,
    entries,
    public: {
      schema: PLAN_SCHEMA,
      status,
      mode,
      installationPlanDigest,
      packId: packageValue.packId,
      packVersion: packageValue.packVersion,
      sourceRevision: packageValue.sourceRevision,
      manifestSha256: packageValue.manifestSha256,
      packageSha256,
      projectRoot: root,
      modules,
      providers,
      previousRelease: priorRelease,
      createCount: entries.filter((entry) => entry.state === "create").length,
      updateCount: entries.filter((entry) => entry.state === "update").length,
      unchangedCount: entries.filter((entry) => entry.state === "unchanged").length,
      conflicts: conflictDetails.map((entry) => entry.path),
      conflictDetails,
      obsoleteManagedFiles,
      plannedFiles,
      writeSet,
      lockPath: INSTALLATION_LOCK_RELATIVE,
    },
  };
}

async function acquireTransactionLock(root) {
  const target = await plainTarget(root, TRANSACTION_LOCK_RELATIVE);
  const createdDirectories = await ensurePlainDirectories(root, path.dirname(target));
  const owner = `${JSON.stringify({ schema: "zuz.decal-pack.installation-transaction-lock/v1", pid: process.pid, token: randomUUID() })}\n`;
  let handle;
  try {
    handle = await open(target, "wx", 0o600);
    await handle.writeFile(owner);
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error?.code === "EEXIST") fail("installation_transaction_locked");
    throw error;
  }
  return async () => {
    if (await readFile(target, "utf8").catch(() => null) === owner) await unlink(target);
    for (const directory of createdDirectories.reverse()) await rmdir(directory).catch(() => undefined);
  };
}

async function removeCreatedDirectories(directories) {
  for (const directory of [...new Set(directories)].sort((left, right) => right.length - left.length)) {
    await rmdir(directory).catch(() => undefined);
  }
}

async function applyTransaction(root, writes, testFailAt = null) {
  const token = randomUUID();
  const prepared = [];
  const applied = [];
  const createdDirectories = [];
  let originalError = null;
  try {
    for (const write of writes) {
      createdDirectories.push(...await ensurePlainDirectories(root, path.dirname(write.target)));
      await plainTarget(root, write.relative);
      const current = await currentFile(root, write.relative);
      if (write.state === "create" && current.exists) fail("installation_precondition_changed", write.relative);
      if (write.state === "update" && (!current.exists || current.sha256 !== write.beforeSha256)) {
        fail("installation_precondition_changed", write.relative);
      }
      const temporary = `${write.target}.decal-${token}.tmp`;
      await writeFile(temporary, write.bytes, { flag: "wx", mode: 0o600 });
      prepared.push({ ...write, temporary, afterSha256: sha256(write.bytes), backup: null, installed: false });
    }

    for (const entry of prepared) {
      if (entry.state === "update") {
        entry.backup = `${entry.target}.decal-${token}.bak`;
        await rename(entry.target, entry.backup);
        applied.push(entry);
        if (sha256(await readFile(entry.backup)) !== entry.beforeSha256) fail("installation_precondition_changed", entry.relative);
      }
      await link(entry.temporary, entry.target);
      entry.installed = true;
      if (!applied.includes(entry)) applied.push(entry);
      await unlink(entry.temporary);
      if (testFailAt === "after_first_write" && applied.length === 1) fail("injected_failure");
    }
    if (testFailAt === "after_all_writes") fail("injected_failure");

    for (const entry of prepared) {
      const current = await currentFile(root, entry.relative);
      if (!current.exists || current.sha256 !== entry.afterSha256) fail("installation_verification_failed", entry.relative);
    }
    // The transaction is committed once every installed digest verifies. A
    // backup-cleanup error must not enter rollback after earlier backups have
    // already been removed, because that would make a full restore impossible.
    for (const entry of applied) if (entry.backup) await rm(entry.backup, { force: true }).catch(() => undefined);
  } catch (error) {
    originalError = error;
    const rollbackFailures = [];
    for (const entry of [...applied].reverse()) {
      try {
        const current = await currentFile(root, entry.relative);
        if (entry.installed) {
          if (!current.exists || current.sha256 !== entry.afterSha256) fail("rollback_target_changed", entry.relative);
          await unlink(entry.target);
        } else if (current.exists) fail("rollback_target_changed", entry.relative);
        if (entry.backup) await rename(entry.backup, entry.target);
      } catch (rollbackError) {
        rollbackFailures.push({ path: entry.relative, code: rollbackError?.code ?? "rollback_failed" });
      }
    }
    if (rollbackFailures.length > 0) fail("installation_rollback_failed", { cause: error?.code ?? "installation_failed", rollbackFailures });
    throw error;
  } finally {
    for (const entry of prepared) {
      await rm(entry.temporary, { force: true }).catch(() => undefined);
    }
    if (originalError) await removeCreatedDirectories(createdDirectories);
  }
}

export async function planInstallation(options) {
  return (await createInstallationPlan(options)).public;
}

export async function installPackage({
  packagePath,
  rootValue,
  modules,
  providers,
  approvedPlanDigest,
  testFailAt = null,
}) {
  const root = await canonicalProjectRoot(rootValue);
  const release = await acquireTransactionLock(root);
  try {
    const plan = await createInstallationPlan({ packagePath, rootValue: root, modules, providers });
    if (approvedPlanDigest !== plan.public.installationPlanDigest) fail("approval_plan_digest_mismatch");
    if (plan.public.status === "blocked") fail("conflict_detected", plan.public.conflictDetails);
    if (plan.public.status === "current") return plan.public;
    const writes = plan.entries
      .filter((entry) => entry.state === "create" || entry.state === "update")
      .map((entry) => ({
        relative: entry.path,
        target: entry.target,
        state: entry.state,
        beforeSha256: entry.currentSha256,
        bytes: entry.bytes,
      }));
    const lockTarget = await plainTarget(root, INSTALLATION_LOCK_RELATIVE);
    writes.push({
      relative: INSTALLATION_LOCK_RELATIVE,
      target: lockTarget,
      state: plan.lock ? "update" : "create",
      beforeSha256: plan.lock?.digest ?? null,
      bytes: plan.lockBytes,
    });
    await applyTransaction(root, writes, testFailAt);
    return { ...plan.public, status: plan.public.mode === "initial-pack-bootstrap" ? "installed" : "updated" };
  } finally {
    await release();
  }
}

async function main() {
  try {
    const parsed = args(process.argv);
    const packagePath = parsed.get("--package");
    const rootValue = parsed.get("--root");
    const dryRun = parsed.has("--dry-run");
    const write = parsed.has("--write");
    if (typeof packagePath !== "string" || typeof rootValue !== "string" || dryRun === write) fail("usage_error");
    const options = {
      packagePath,
      rootValue,
      modules: values(parsed, "--module"),
      providers: values(parsed, "--provider"),
    };
    const result = dryRun
      ? await planInstallation(options)
      : await installPackage({ ...options, approvedPlanDigest: parsed.get("--approved-plan-digest") });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schema: PLAN_SCHEMA, status: "rejected", code: error.code || "installation_failed", detail: error.detail ?? null })}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
