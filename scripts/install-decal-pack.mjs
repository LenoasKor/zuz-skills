#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSafeRelativePath, stableJson } from "./pack-lib.mjs";

function fail(code, detail = null) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

async function plainTarget(root, relative) {
  assertSafeRelativePath(relative);
  const target = path.resolve(root, relative);
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) fail("path_escape", relative);
  let current = root;
  const parts = inside.split(path.sep);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) fail("symlink_rejected", relative);
      if (index < parts.length - 1 && !metadata.isDirectory()) fail("not_a_directory", relative);
      if (index === parts.length - 1 && !metadata.isFile()) fail("not_a_plain_file", relative);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      break;
    }
  }
  return target;
}

function verifyPackage(value) {
  if (!value || value.schemaVersion !== 1 || value.packId !== "decal-project-pack" || !Array.isArray(value.files)) fail("unsupported_package");
  const unsigned = { ...value };
  delete unsigned.manifestSha256;
  unsigned.files = value.files.map(({ contentBase64: _contentBase64, ...file }) => file);
  const computedManifest = sha256(stableJson(unsigned));
  if (computedManifest !== value.manifestSha256) fail("manifest_digest_mismatch");
  for (const file of value.files) {
    const bytes = Buffer.from(file.contentBase64, "base64");
    if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) fail("file_digest_mismatch", file.sourcePath);
  }
  return value;
}

async function buildPlan(packageValue, root, modules, providers) {
  const knownModules = new Set(packageValue.modules.map((module) => module.id));
  const knownProviders = new Set(["codex", "claude", "gemini", "acp"]);
  if (!modules.length || modules.some((module) => !knownModules.has(module))) fail("unknown_module");
  if (!providers.length || providers.some((provider) => !knownProviders.has(provider))) fail("unknown_provider");
  const selectedModules = new Set(modules);
  const selectedProviders = new Set(providers);
  const planned = new Map();
  for (const file of packageValue.files) {
    if (!selectedModules.has(file.moduleId)) continue;
    for (const target of file.installTargets) {
      if (target.provider !== "shared" && !selectedProviders.has(target.provider)) continue;
      const existing = planned.get(target.path);
      if (existing && existing.sha256 !== file.sha256) fail("duplicate_target_conflict", target.path);
      planned.set(target.path, { path: target.path, provider: target.provider, sha256: file.sha256, bytes: Buffer.from(file.contentBase64, "base64") });
    }
  }
  const entries = [];
  for (const item of [...planned.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    const target = await plainTarget(root, item.path);
    let state = "create";
    try {
      const bytes = await readFile(target);
      state = sha256(bytes) === item.sha256 ? "unchanged" : "conflict";
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    entries.push({ ...item, state });
  }
  return entries;
}

async function atomicCreate(target, bytes) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.decal-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await link(temporary, target);
    await rm(temporary, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function publicPlan(packageValue, root, modules, providers, entries) {
  return {
    schema: "zuz.decal-pack.installation-plan/v1",
    status: entries.some((entry) => entry.state === "conflict") ? "blocked" : "planned",
    packId: packageValue.packId,
    packVersion: packageValue.packVersion,
    sourceRevision: packageValue.sourceRevision,
    manifestSha256: packageValue.manifestSha256,
    projectRoot: root,
    modules,
    providers,
    createCount: entries.filter((entry) => entry.state === "create").length,
    unchangedCount: entries.filter((entry) => entry.state === "unchanged").length,
    conflicts: entries.filter((entry) => entry.state === "conflict").map((entry) => entry.path),
    writeSet: entries.filter((entry) => entry.state === "create").map((entry) => entry.path),
  };
}

try {
  const parsed = args(process.argv);
  const packagePath = parsed.get("--package");
  const rootValue = parsed.get("--root");
  const dryRun = parsed.has("--dry-run");
  const write = parsed.has("--write");
  if (typeof packagePath !== "string" || typeof rootValue !== "string" || dryRun === write) fail("usage_error");
  const root = path.resolve(rootValue);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) fail("invalid_project_root");
  const packageValue = verifyPackage(JSON.parse(await readFile(path.resolve(packagePath), "utf8")));
  const modules = values(parsed, "--module");
  const providers = values(parsed, "--provider");
  const entries = await buildPlan(packageValue, root, modules, providers);
  const plan = publicPlan(packageValue, root, modules, providers, entries);
  if (dryRun) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
  } else {
    if (plan.status !== "planned") fail("conflict_detected", plan.conflicts);
    if (parsed.get("--approved-manifest-sha256") !== packageValue.manifestSha256) fail("approval_digest_mismatch");
    const created = [];
    try {
      for (const entry of entries.filter((item) => item.state === "create")) {
        const target = await plainTarget(root, entry.path);
        await atomicCreate(target, entry.bytes);
        created.push(target);
      }
      const lockRelative = ".decal/decal-pack.lock.json";
      const lockTarget = await plainTarget(root, lockRelative);
      try { await lstat(lockTarget); fail("existing_lock_requires_update_flow"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      const lock = {
        schema: "zuz.decal-pack.installation-lock/v1",
        packId: packageValue.packId,
        packVersion: packageValue.packVersion,
        sourceRevision: packageValue.sourceRevision,
        manifestSha256: packageValue.manifestSha256,
        modules,
        providers,
        files: entries.map(({ path: filePath, provider, sha256: digest }) => ({ path: filePath, provider, sha256: digest })),
      };
      await atomicCreate(lockTarget, Buffer.from(`${JSON.stringify(lock, null, 2)}\n`));
      created.push(lockTarget);
      process.stdout.write(`${JSON.stringify({ ...plan, status: "installed", lockPath: lockRelative })}\n`);
    } catch (error) {
      for (const target of created.reverse()) await rm(target, { force: true });
      throw error;
    }
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({ schema: "zuz.decal-pack.installation-plan/v1", status: "rejected", code: error.code || "installation_failed", detail: error.detail ?? null })}\n`);
  process.exitCode = 2;
}
