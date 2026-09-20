#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFile,
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
const LOCK_SCHEMA_V1 = "zuz.decal-pack.installation-lock/v1";
const LOCK_SCHEMA = "zuz.decal-pack.installation-lock/v2";
const RETIRED_ROOT_RELATIVE = ".decal/retired/decal-project-pack";
const KNOWN_PROVIDERS = new Set(["codex", "claude", "gemini", "acp"]);
const PACK_RULE_FILES = ["AGENTS.md", "CLAUDE.md"];
const PACK_RULES_BLOCK_START = "<!-- decal-pack-rules:start -->";
const PACK_RULES_BLOCK_END = "<!-- decal-pack-rules:end -->";

function decalPackRulesBlock() {
  const body = [
    "## Decal Pack 변경 등록 규칙",
    "",
    "- 프로젝트 코드·문서·설정·자산·Git 또는 배포 상태를 바꾸기 전에 `Task`, `Work`, `Bug` 중 정확히 하나를 주 작업 정본으로 선택하고 등록합니다.",
    "- 읽기 전용 질의·브리핑·조사는 등록 없이 진행할 수 있지만, 실제 변경으로 전환하는 순간 먼저 등록합니다.",
    "- 요청 범위를 정확히 포함하는 기존 정본이 있으면 재사용하고 중복 등록하지 않습니다.",
    "- 사용자가 `등록`이라고 말하지 않아도 AI가 변경 업무를 식별하면 종류·제목·분류 근거·상위 Task·범위를 먼저 제안합니다.",
    "- Decal Native 기능이 없는 외부 개발환경도 작업을 거부하지 않고 설치된 portable zuz ITS 스킬과 계약의 외부 host fallback으로 등록·진행합니다.",
  ].join("\n");
  return `${PACK_RULES_BLOCK_START}\n<!-- schema: zuz.decal-pack.project-rules/v1; content-sha256: ${sha256(Buffer.from(body))} -->\n${body}\n${PACK_RULES_BLOCK_END}`;
}

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
    || ![1, 2].includes(value.schemaVersion)
    || value.packId !== "decal-project-pack"
    || !/^\d+\.\d+\.\d+$/u.test(value.packVersion ?? "")
    || !/^[0-9a-f]{40}$/u.test(value.sourceRevision ?? "")
    || !Array.isArray(value.modules)
    || !Array.isArray(value.files)
    || !/^[0-9a-f]{64}$/u.test(value.manifestSha256 ?? "")
  ) fail("unsupported_package");
  if (value.schemaVersion === 2) {
    if (stableJson(value.requiredFiles) !== stableJson(["LICENSE", "NOTICE"])) fail("unsupported_required_files");
    for (const name of value.requiredFiles) {
      const matches = value.files.filter((file) => file?.sourcePath === name);
      if (matches.length !== 1 || matches[0].executable !== false
        || stableJson(matches[0].installTargets) !== stableJson([{ provider: "shared", path: `docs/skills/vendor/decal-project-pack/${name}` }])) fail("unsupported_required_files");
    }
  } else if (value.requiredFiles !== undefined) fail("unsupported_required_files");
  if (value.files.some((file) => !file || typeof file !== "object")) fail("unsupported_package");
  const moduleIds = new Set();
  for (const module of value.modules) {
    if (
      !module
      || typeof module.id !== "string"
      || moduleIds.has(module.id)
      || !/^\d+\.\d+\.\d+$/u.test(module.version ?? "")
      || !/^[0-9a-f]{64}$/u.test(module.digest ?? "")
      || !Number.isSafeInteger(module.fileCount)
      || module.fileCount < 1
    ) fail("unsupported_package");
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
    || !new Set([LOCK_SCHEMA_V1, LOCK_SCHEMA]).has(value.schema)
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
  if (value.mode !== undefined && !new Set(["initial-pack-bootstrap", "update", "change-modules"]).has(value.mode)) fail("unsupported_installation_lock");
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
  if (value.retiredFiles !== undefined && !Array.isArray(value.retiredFiles)) fail("unsupported_installation_lock");
  if (value.moduleStates !== undefined && !Array.isArray(value.moduleStates)) fail("unsupported_installation_lock");
  if (value.ruleFiles !== undefined && !Array.isArray(value.ruleFiles)) fail("unsupported_installation_lock");
  for (const module of value.moduleStates ?? []) {
    if (
      !module
      || typeof module.id !== "string"
      || !/^\d+\.\d+\.\d+$/u.test(module.version ?? "")
      || !/^[0-9a-f]{64}$/u.test(module.digest ?? "")
      || !new Set(["installed", "removed"]).has(module.status)
    ) fail("unsupported_installation_lock");
  }
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
  for (const file of value.retiredFiles ?? []) {
    if (
      !file
      || typeof file.path !== "string"
      || typeof file.retiredPath !== "string"
      || typeof file.moduleId !== "string"
      || (file.provider !== "shared" && !KNOWN_PROVIDERS.has(file.provider))
      || !/^[0-9a-f]{64}$/u.test(file.sha256 ?? "")
      || seen.has(file.path)
    ) fail("unsupported_installation_lock");
    assertSafeRelativePath(file.path);
    assertSafeRelativePath(file.retiredPath);
    if (!file.retiredPath.startsWith(`${RETIRED_ROOT_RELATIVE}/`)) fail("unsupported_installation_lock");
    seen.add(file.path);
  }
  const seenRuleFiles = new Set();
  for (const file of value.ruleFiles ?? []) {
    if (
      !file
      || !PACK_RULE_FILES.includes(file.path)
      || !/^[0-9a-f]{64}$/u.test(file.blockSha256 ?? "")
      || seenRuleFiles.has(file.path)
    ) fail("unsupported_installation_lock");
    seenRuleFiles.add(file.path);
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

function uniquePackRulesBlock(source, relative) {
  const starts = source.split(PACK_RULES_BLOCK_START).length - 1;
  const ends = source.split(PACK_RULES_BLOCK_END).length - 1;
  if (starts === 0 && ends === 0) return null;
  if (starts !== 1 || ends !== 1) fail("managed_rule_block_invalid", relative);
  const start = source.indexOf(PACK_RULES_BLOCK_START);
  const end = source.indexOf(PACK_RULES_BLOCK_END, start) + PACK_RULES_BLOCK_END.length;
  if (end < start + PACK_RULES_BLOCK_START.length) fail("managed_rule_block_invalid", relative);
  return { start, end, block: source.slice(start, end) };
}

function appendPackRulesBlock(source, block) {
  if (!source) return `${block}\n`;
  const separator = source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n";
  return `${source}${separator}${block}\n`;
}

async function plannedPackRuleFiles(root, hasIts, lock) {
  const desiredBlock = decalPackRulesBlock();
  const desiredBlockSha256 = sha256(Buffer.from(desiredBlock));
  const previous = new Map((lock?.value.ruleFiles ?? []).map((file) => [file.path, file]));
  const entries = [];
  const conflicts = [];
  for (const relative of PACK_RULE_FILES) {
    const current = await currentFile(root, relative);
    let source = "";
    if (current.exists) {
      source = current.bytes.toString("utf8");
      if (!Buffer.from(source).equals(current.bytes)) fail("managed_rule_file_not_utf8", relative);
    }
    const found = uniquePackRulesBlock(source, relative);
    const prior = previous.get(relative) ?? null;
    let next = source;
    let reason = null;
    if (found) {
      const blockSha256 = sha256(Buffer.from(found.block));
      if (prior ? blockSha256 !== prior.blockSha256 : blockSha256 !== desiredBlockSha256) {
        reason = prior ? "managed_rule_block_modified" : "unmanaged_rule_block_present";
      } else if (hasIts) {
        next = `${source.slice(0, found.start)}${desiredBlock}${source.slice(found.end)}`;
      } else if (prior) {
        next = `${source.slice(0, found.start)}${source.slice(found.end)}`;
      } else {
        reason = "unmanaged_rule_block_present";
      }
    } else if (prior) {
      reason = "managed_rule_block_missing";
    } else if (hasIts) {
      next = appendPackRulesBlock(source, desiredBlock);
    }
    if (reason) {
      conflicts.push({
        path: relative,
        reason,
        currentSha256: current.sha256,
        previousSha256: prior?.blockSha256 ?? null,
        desiredSha256: hasIts ? desiredBlockSha256 : null,
      });
      continue;
    }
    const bytes = Buffer.from(next);
    entries.push({
      path: relative,
      target: current.target,
      state: bytes.equals(current.bytes ?? Buffer.alloc(0)) ? "unchanged" : current.exists ? "update" : "create",
      currentSha256: current.sha256,
      sha256: sha256(bytes),
      bytes,
      blockSha256: hasIts ? desiredBlockSha256 : null,
    });
  }
  return { entries, conflicts };
}

function desiredFiles(packageValue, modules, providers) {
  const selectedModules = new Set(modules);
  const selectedProviders = new Set(providers);
  const planned = new Map();
  for (const file of packageValue.files) {
    if (!selectedModules.has(file.moduleId) && !packageValue.requiredFiles?.includes(file.sourcePath)) continue;
    for (const target of file.installTargets) {
      if (target.provider !== "shared" && !selectedProviders.has(target.provider)) continue;
      const existing = planned.get(target.path);
      if (existing && existing.sha256 !== file.sha256) fail("duplicate_target_conflict", target.path);
      planned.set(target.path, {
        path: target.path,
        required: packageValue.requiredFiles?.includes(file.sourcePath) ?? false,
        provider: target.provider,
        sha256: file.sha256,
        bytes: Buffer.from(file.contentBase64, "base64"),
      });
    }
  }
  return [...planned.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function moduleStatesForSelection(packageValue, modules) {
  const selected = new Set(modules);
  return packageValue.modules
    .map((module) => ({
      id: module.id,
      version: module.version,
      digest: module.digest,
      status: selected.has(module.id) ? "installed" : "removed",
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function moduleByTarget(packageValue) {
  const result = new Map();
  for (const file of packageValue.files) {
    for (const target of file.installTargets) {
      const existing = result.get(target.path);
      if (existing && existing !== file.moduleId) fail("duplicate_target_conflict", target.path);
      result.set(target.path, file.moduleId);
    }
  }
  return result;
}

function retiredPath(moduleId, targetPath) {
  assertSafeRelativePath(moduleId);
  assertSafeRelativePath(targetPath);
  return `${RETIRED_ROOT_RELATIVE}/${moduleId}/${targetPath}`;
}

async function existingItsDocuments(root) {
  const candidates = [
    "docs/tasks/index.md",
    "docs/tasks/category_index.md",
    "docs/slices/index.md",
    "docs/slices/category_index.md",
    "docs/work-items/work",
    "docs/work-items/bugs",
    "docs/work-items/incidents",
  ];
  const existing = [];
  for (const relative of candidates) {
    const target = path.join(root, ...relative.split("/"));
    const targetMetadata = await metadata(target);
    if (targetMetadata && !targetMetadata.isSymbolicLink()) existing.push(relative);
  }
  return existing;
}

async function assertItsRemovalIsIdle(root) {
  const markers = [
    ".decal/settlement-pending-v1.json",
    ".decal/task-registration-pending-v7.json",
    ".decal/its-ticket-registration-pending-v1.json",
    ".decal/task-registration-pending-v9.json",
    ".decal/task-registration-pending-v10.json",
    ".decal/ticket-registration-pending-v9.json",
    ".decal/ticket-registration-pending-v10.json",
  ];
  const active = [];
  for (const relative of markers) if (await metadata(path.join(root, ...relative.split("/")))) active.push(relative);
  if (active.length > 0) fail("its_operation_in_progress", active);
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
  const lockedModules = [...(lock?.value.modules ?? [])].sort((left, right) => left.localeCompare(right));
  const lockedProviders = [...(lock?.value.providers ?? [])].sort((left, right) => left.localeCompare(right));
  const selectionChanged = Boolean(lock)
    && (!sameSelection(modules, lockedModules) || !sameSelection(providers, lockedProviders));
  const hadIts = lockedModules.some((moduleId) => moduleId === "task-work-bug" || moduleId === "zuz-its");
  const hasIts = modules.includes("zuz-its");
  if (hadIts && !hasIts) await assertItsRemovalIsIdle(root);
  const rulePlan = await plannedPackRuleFiles(root, hasIts, lock);

  const mode = !lock ? "initial-pack-bootstrap" : selectionChanged ? "change-modules" : "update";
  const previousManagedFiles = [
    ...(lock?.value.files ?? []),
    ...(lock?.value.obsoleteManagedFiles ?? []),
  ];
  const previousByPath = new Map(previousManagedFiles.map((file) => [file.path, file]));
  const previousRetiredByPath = new Map((lock?.value.retiredFiles ?? []).map((file) => [file.path, file]));
  const desired = desiredFiles(packageValue, modules, providers);
  const desiredPaths = new Set(desired.map((file) => file.path));
  const entries = [];
  for (const file of desired) {
    const current = await currentFile(root, file.path);
    const previous = previousByPath.get(file.path) ?? null;
    const retired = previousRetiredByPath.get(file.path) ?? null;
    let state;
    let conflictReason = null;
    if (!current.exists) {
      if (retired && retired.sha256 === file.sha256) {
        const retiredCurrent = await currentFile(root, retired.retiredPath);
        if (retiredCurrent.exists && retiredCurrent.sha256 === retired.sha256) state = "restore";
        else {
          state = "conflict";
          conflictReason = "retired_file_changed";
        }
      } else if (previous) {
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
      retiredPath: state === "restore" ? retired.retiredPath : null,
    });
  }

  const obsoleteManagedFiles = [];
  const retirementEntries = [];
  const targetModules = moduleByTarget(packageValue);
  for (const previous of [...previousByPath.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    if (desiredPaths.has(previous.path)) continue;
    const current = await currentFile(root, previous.path);
    const moduleId = targetModules.get(previous.path) ?? null;
    const shouldRetire = moduleId && !modules.includes(moduleId);
    const observedState = !current.exists ? "missing" : current.sha256 === previous.sha256 ? "managed" : "modified";
    const obsolete = {
      path: previous.path,
      provider: previous.provider,
      sha256: previous.sha256,
      moduleId,
      observedState,
      observedSha256: current.sha256,
    };
    obsoleteManagedFiles.push(obsolete);
    if (shouldRetire && observedState === "managed") {
      const destination = retiredPath(moduleId, previous.path);
      const retiredCurrent = await currentFile(root, destination);
      if (retiredCurrent.exists) {
        obsolete.conflictReason = "retired_target_present";
        obsolete.retiredPath = destination;
      } else {
        obsolete.retiredPath = destination;
        retirementEntries.push({
          path: previous.path,
          target: current.target,
          provider: previous.provider,
          moduleId,
          sha256: previous.sha256,
          state: "retire",
          currentSha256: current.sha256,
          retiredPath: destination,
          retiredTarget: retiredCurrent.target,
        });
      }
    } else if (shouldRetire && observedState === "modified") {
      obsolete.conflictReason = "managed_file_modified";
    }
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
  conflictDetails.push(...obsoleteManagedFiles
    .filter((entry) => entry.conflictReason)
    .map((entry) => ({
      path: entry.path,
      reason: entry.conflictReason,
      currentSha256: entry.observedSha256,
      previousSha256: entry.sha256,
      desiredSha256: null,
    })));
  conflictDetails.push(...rulePlan.conflicts);
  const release = releaseIdentity(packageValue, packageSha256);
  const priorRelease = previousRelease(lock);
  const releaseAlreadyCurrent = Boolean(lock)
    && !selectionChanged
    && lock.value.packVersion === packageValue.packVersion
    && lock.value.sourceRevision === packageValue.sourceRevision
    && lock.value.manifestSha256 === packageValue.manifestSha256
    && lock.value.packageSha256 === packageSha256
    && stableJson(lock.value.ruleFiles ?? []) === stableJson(
      rulePlan.entries.filter((entry) => entry.blockSha256).map((entry) => ({ path: entry.path, blockSha256: entry.blockSha256 })),
    )
    && new Set(["initial-pack-bootstrap", "update", "change-modules"]).has(lock.value.mode)
    && /^sha256:[0-9a-f]{64}$/u.test(lock.value.installationPlanDigest ?? "");
  const status = conflictDetails.length > 0
    ? "blocked"
    : releaseAlreadyCurrent
      && entries.every((entry) => entry.state === "unchanged")
      && rulePlan.entries.every((entry) => entry.state === "unchanged")
      ? "current"
      : "planned";
  const writeSet = status === "current"
    ? []
    : [
      ...entries.filter((entry) => new Set(["create", "update", "restore"]).has(entry.state)).map((entry) => entry.path),
      ...entries.filter((entry) => entry.state === "restore").map((entry) => entry.retiredPath),
      ...rulePlan.entries.filter((entry) => new Set(["create", "update"]).has(entry.state)).map((entry) => entry.path),
      ...retirementEntries.flatMap((entry) => [entry.path, entry.retiredPath]),
      INSTALLATION_LOCK_RELATIVE,
    ];
  const plannedFiles = entries.map(({ path: filePath, provider, required, sha256: desiredSha256, state, previousSha256, currentSha256, retiredPath: restoreFrom }) => ({
    path: filePath,
    required,
    provider,
    sha256: desiredSha256,
    state,
    previousSha256,
    currentSha256,
    restoreFrom,
  }));
  const addingIts = hasIts && !hadIts;
  const adoptionPaths = addingIts ? await existingItsDocuments(root) : [];
  const moduleStates = moduleStatesForSelection(packageValue, modules);
  const approvalBinding = {
    schema: PLAN_BINDING_SCHEMA,
    mode,
    projectRoot: root,
    packId: packageValue.packId,
    release,
    previousRelease: priorRelease,
    previousLockSha256: lock?.digest ?? null,
    modules,
    moduleStates,
    providers,
    plannedFiles,
    plannedRuleFiles: rulePlan.entries.map(({ path: filePath, state, currentSha256, sha256: desiredSha256, blockSha256 }) => ({
      path: filePath,
      state,
      currentSha256,
      desiredSha256,
      blockSha256,
    })),
    obsoleteManagedFiles,
    retirementEntries: retirementEntries.map(({ target: _target, retiredTarget: _retiredTarget, ...entry }) => entry),
    adoption: { required: addingIts && adoptionPaths.length > 0, preservedPaths: adoptionPaths },
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
    moduleStates,
    providers,
    files: entries.map(({ path: filePath, provider, sha256: digest }) => ({ path: filePath, provider, sha256: digest })),
    ruleFiles: rulePlan.entries
      .filter((entry) => entry.blockSha256)
      .map((entry) => ({ path: entry.path, blockSha256: entry.blockSha256 })),
    obsoleteManagedFiles: obsoleteManagedFiles.filter((entry) => !entry.retiredPath && !entry.moduleId),
    retiredFiles: [
      ...(lock?.value.retiredFiles ?? []).filter((file) => !desiredPaths.has(file.path)),
      ...retirementEntries.map((entry) => ({
        path: entry.path,
        retiredPath: entry.retiredPath,
        provider: entry.provider,
        moduleId: entry.moduleId,
        sha256: entry.sha256,
      })),
    ],
  };
  const lockBytes = Buffer.from(`${JSON.stringify(lockValue, null, 2)}\n`);
  const commitExpected = new Map();
  for (const entry of entries.filter((item) => new Set(["create", "update", "restore"]).has(item.state))) {
    commitExpected.set(entry.path, entry.sha256);
    if (entry.state === "restore") commitExpected.set(entry.retiredPath, null);
  }
  for (const entry of rulePlan.entries.filter((item) => new Set(["create", "update"]).has(item.state))) {
    commitExpected.set(entry.path, entry.sha256);
  }
  for (const entry of retirementEntries) {
    commitExpected.set(entry.path, null);
    commitExpected.set(entry.retiredPath, entry.sha256);
  }
  commitExpected.set(INSTALLATION_LOCK_RELATIVE, sha256(lockBytes));
  return {
    packageValue,
    root,
    lock,
    lockBytes,
    commitExpected: [...commitExpected].map(([filePath, digest]) => ({ path: filePath, sha256: digest })),
    entries,
    ruleEntries: rulePlan.entries,
    retirementEntries,
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
      moduleStates,
      providers,
      previousRelease: priorRelease,
      createCount: entries.filter((entry) => entry.state === "create").length,
      updateCount: entries.filter((entry) => entry.state === "update").length,
      restoreCount: entries.filter((entry) => entry.state === "restore").length,
      retireCount: retirementEntries.length,
      unchangedCount: entries.filter((entry) => entry.state === "unchanged").length,
      ruleFileChangeCount: rulePlan.entries.filter((entry) => entry.state !== "unchanged").length,
      conflicts: conflictDetails.map((entry) => entry.path),
      conflictDetails,
      obsoleteManagedFiles,
      retirementEntries: retirementEntries.map(({ target: _target, retiredTarget: _retiredTarget, ...entry }) => entry),
      adoption: { required: addingIts && adoptionPaths.length > 0, preservedPaths: adoptionPaths },
      plannedFiles,
      plannedRuleFiles: approvalBinding.plannedRuleFiles,
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
      if (write.state === "retire") {
        createdDirectories.push(...await ensurePlainDirectories(root, path.dirname(write.retiredTarget)));
        await plainTarget(root, write.retiredRelative);
        const retiredCurrent = await currentFile(root, write.retiredRelative);
        if (!current.exists || current.sha256 !== write.beforeSha256 || retiredCurrent.exists) {
          fail("installation_precondition_changed", write.relative);
        }
        prepared.push({ ...write, temporary: null, afterSha256: write.beforeSha256, backup: null, installed: false });
        continue;
      }
      if (write.state === "restore") {
        await plainTarget(root, write.retiredRelative);
        const retiredCurrent = await currentFile(root, write.retiredRelative);
        if (current.exists || !retiredCurrent.exists || retiredCurrent.sha256 !== write.afterSha256) {
          fail("installation_precondition_changed", write.relative);
        }
        prepared.push({ ...write, temporary: null, backup: null, installed: false });
        continue;
      }
      if (write.state === "create" && current.exists) fail("installation_precondition_changed", write.relative);
      if (write.state === "update" && (!current.exists || current.sha256 !== write.beforeSha256)) {
        fail("installation_precondition_changed", write.relative);
      }
      const temporary = `${write.target}.decal-${token}.tmp`;
      await writeFile(temporary, write.bytes, { flag: "wx", mode: 0o600 });
      prepared.push({ ...write, temporary, afterSha256: sha256(write.bytes), backup: null, installed: false });
    }

    for (const entry of prepared) {
      if (entry.state === "retire") {
        await rename(entry.target, entry.retiredTarget);
        entry.installed = true;
        applied.push(entry);
        if (testFailAt === "after_first_write" && applied.length === 1) fail("injected_failure");
        continue;
      }
      if (entry.state === "restore") {
        await rename(entry.retiredTarget, entry.target);
        entry.installed = true;
        applied.push(entry);
        if (testFailAt === "after_first_write" && applied.length === 1) fail("injected_failure");
        continue;
      }
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
      if (entry.state === "retire") {
        const original = await currentFile(root, entry.relative);
        const retired = await currentFile(root, entry.retiredRelative);
        if (original.exists || !retired.exists || retired.sha256 !== entry.afterSha256) {
          fail("installation_verification_failed", entry.relative);
        }
        continue;
      }
      if (entry.state === "restore") {
        const current = await currentFile(root, entry.relative);
        const retired = await currentFile(root, entry.retiredRelative);
        if (!current.exists || current.sha256 !== entry.afterSha256 || retired.exists) {
          fail("installation_verification_failed", entry.relative);
        }
        continue;
      }
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
        if (entry.state === "retire") {
          const original = await currentFile(root, entry.relative);
          const retired = await currentFile(root, entry.retiredRelative);
          if (original.exists || !retired.exists || retired.sha256 !== entry.afterSha256) {
            fail("rollback_target_changed", entry.relative);
          }
          await rename(entry.retiredTarget, entry.target);
          continue;
        }
        if (entry.state === "restore") {
          const current = await currentFile(root, entry.relative);
          const retired = await currentFile(root, entry.retiredRelative);
          if (!current.exists || current.sha256 !== entry.afterSha256 || retired.exists) {
            fail("rollback_target_changed", entry.relative);
          }
          await rename(entry.target, entry.retiredTarget);
          continue;
        }
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
      if (entry.temporary) await rm(entry.temporary, { force: true }).catch(() => undefined);
    }
    if (originalError) await removeCreatedDirectories(createdDirectories);
  }
}

function runGit(root, gitArgs) {
  return spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" });
}

function gitText(root, gitArgs) {
  const result = runGit(root, gitArgs);
  if (result.status !== 0) fail("git_command_failed", { args: gitArgs, stderr: result.stderr.trim() });
  return result.stdout.trim();
}

async function gitCommitBlockReason(root) {
  const topLevel = runGit(root, ["rev-parse", "--show-toplevel"]);
  if (topLevel.status !== 0) return "not_git_repository";
  if (await realpath(topLevel.stdout.trim()).catch(() => null) !== root) return "git_root_mismatch";
  for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
    const gitPath = runGit(root, ["rev-parse", "--git-path", name]);
    if (gitPath.status !== 0) return "git_state_unavailable";
    if (await metadata(path.resolve(root, gitPath.stdout.trim()))) return "git_operation_in_progress";
  }
  const unmerged = runGit(root, ["diff", "--name-only", "--diff-filter=U", "-z"]);
  if (unmerged.status !== 0) return "git_state_unavailable";
  if (unmerged.stdout.length > 0) return "git_unmerged_paths";
  const staged = runGit(root, ["diff", "--cached", "--quiet", "--"]);
  if (![0, 1].includes(staged.status)) return "git_state_unavailable";
  if (staged.status === 1) return "git_staged_changes";
  for (const hook of ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit"]) {
    const hookPath = runGit(root, ["rev-parse", "--git-path", `hooks/${hook}`]);
    if (hookPath.status !== 0) return "git_state_unavailable";
    if (await metadata(path.resolve(root, hookPath.stdout.trim()))) return "git_hooks_unsupported";
  }
  return null;
}

async function settleExactPackCommit(root, plan) {
  const blockReason = await gitCommitBlockReason(root).catch(() => "git_state_unavailable");
  if (blockReason === "not_git_repository") {
    return { gitOutcome: "installed_not_git", gitBlockReason: blockReason, commit: null };
  }
  if (blockReason) {
    return { gitOutcome: "installed_commit_required", gitBlockReason: blockReason, commit: null };
  }
  const paths = [...new Set(plan.public.writeSet)].sort((left, right) => left.localeCompare(right));
  for (const expected of plan.commitExpected) {
    const observed = await currentFile(root, expected.path);
    if (observed.sha256 !== expected.sha256) {
      return { gitOutcome: "installed_commit_required", gitBlockReason: "git_target_changed", commit: null };
    }
  }
  const renameProbe = runGit(root, ["diff", "--name-status", "-z", "-M", "-C", "HEAD", "--", ...paths]);
  if (renameProbe.status !== 0 || /(?:^|\0)[RC][0-9]*\0/u.test(renameProbe.stdout)) {
    return { gitOutcome: "installed_commit_required", gitBlockReason: "git_rename_copy_ambiguous", commit: null };
  }
  let beforeHead;
  let beforeBranch;
  try {
    beforeHead = gitText(root, ["rev-parse", "HEAD"]);
    beforeBranch = gitText(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch {
    return { gitOutcome: "installed_commit_required", gitBlockReason: "git_head_unavailable", commit: null };
  }
  if (!beforeBranch) {
    return { gitOutcome: "installed_commit_required", gitBlockReason: "git_detached_head", commit: null };
  }
  let indexPathText;
  try {
    indexPathText = gitText(root, ["rev-parse", "--git-path", "index"]);
  } catch {
    return { gitOutcome: "installed_commit_required", gitBlockReason: "git_state_unavailable", commit: null };
  }
  const indexPath = path.resolve(root, indexPathText);
  const indexBackup = `${indexPath}.decal-pack-${randomUUID()}.bak`;
  const indexExisted = Boolean(await metadata(indexPath));
  if (indexExisted) {
    try {
      await copyFile(indexPath, indexBackup);
    } catch {
      return { gitOutcome: "installed_commit_required", gitBlockReason: "git_index_backup_failed", commit: null };
    }
  }
  const restoreIndex = async () => {
    if (indexExisted) await copyFile(indexBackup, indexPath);
    else await rm(indexPath, { force: true });
  };
  let createdCommitSha = null;
  try {
    const untracked = [];
    for (const relative of paths) {
      const tracked = runGit(root, ["ls-files", "--error-unmatch", "--", relative]);
      if (tracked.status !== 0 && (await currentFile(root, relative)).exists) untracked.push(relative);
    }
    if (untracked.length > 0) {
      const intent = runGit(root, ["add", "--intent-to-add", "--", ...untracked]);
      if (intent.status !== 0) fail("git_intent_to_add_failed", intent.stderr.trim());
    }
    const commitMessage = `chore(decal-pack): install ${plan.public.packVersion}`;
    const committed = runGit(root, ["commit", "--only", "-m", commitMessage, "--", ...paths]);
    if (committed.status !== 0) fail("git_commit_failed", committed.stderr.trim());
    const commitSha = gitText(root, ["rev-parse", "HEAD"]);
    createdCommitSha = commitSha;
    const treeSha = gitText(root, ["rev-parse", "HEAD^{tree}"]);
    const branch = gitText(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const actual = gitText(root, ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", commitSha])
      .split("\n").filter(Boolean).sort((left, right) => left.localeCompare(right));
    if (branch !== beforeBranch || stableJson(actual) !== stableJson(paths)) {
      const rollback = runGit(root, ["update-ref", "HEAD", beforeHead, commitSha]);
      await restoreIndex();
      if (rollback.status !== 0) fail("git_commit_rollback_failed");
      createdCommitSha = null;
      return { gitOutcome: "installed_commit_required", gitBlockReason: "git_unexpected_commit_scope", commit: null };
    }
    for (const expected of plan.commitExpected) {
      const object = `${commitSha}:${expected.path}`;
      if (expected.sha256 === null) {
        if (runGit(root, ["cat-file", "-e", object]).status === 0) fail("git_committed_content_mismatch", expected.path);
      } else {
        const committedBytes = spawnSync("git", ["show", object], { cwd: root, encoding: null });
        if (committedBytes.status !== 0 || sha256(committedBytes.stdout) !== expected.sha256) {
          fail("git_committed_content_mismatch", expected.path);
        }
      }
    }
    const receipt = {
      files: plan.commitExpected,
      writeSetDigest: prefixedSha256(stableJson(plan.commitExpected)),
    };
    return {
      gitOutcome: "committed",
      gitBlockReason: null,
      commit: {
        schema: "zuz.decal-pack.git-settlement/v1",
        commitSha,
        treeSha,
        branch,
        baseHead: beforeHead,
        writeSetDigest: receipt.writeSetDigest,
        files: receipt.files,
        packVersion: plan.public.packVersion,
        packageSha256: plan.public.packageSha256,
      },
    };
  } catch (error) {
    if (createdCommitSha) {
      const rollback = runGit(root, ["update-ref", "HEAD", beforeHead, createdCommitSha]);
      if (rollback.status !== 0) {
        return { gitOutcome: "installed_commit_required", gitBlockReason: "git_commit_rollback_failed", commit: null };
      }
    }
    await restoreIndex().catch(() => undefined);
    return {
      gitOutcome: "installed_commit_required",
      gitBlockReason: error?.code ?? "git_commit_failed",
      commit: null,
    };
  } finally {
    await rm(indexBackup, { force: true }).catch(() => undefined);
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
  commit = false,
  testFailAt = null,
}) {
  const root = await canonicalProjectRoot(rootValue);
  const release = await acquireTransactionLock(root);
  try {
    const plan = await createInstallationPlan({ packagePath, rootValue: root, modules, providers });
    if (approvedPlanDigest !== plan.public.installationPlanDigest) fail("approval_plan_digest_mismatch");
    if (plan.public.status === "blocked") fail("conflict_detected", plan.public.conflictDetails);
    if (plan.public.status === "current") {
      return { ...plan.public, gitOutcome: commit ? "not_required" : "not_requested", gitBlockReason: null, commit: null };
    }
    const writes = plan.entries
      .filter((entry) => new Set(["create", "update", "restore"]).has(entry.state))
      .map((entry) => ({
        relative: entry.path,
        target: entry.target,
        state: entry.state,
        beforeSha256: entry.currentSha256,
        afterSha256: entry.sha256,
        retiredRelative: entry.retiredPath,
        retiredTarget: entry.retiredPath ? path.join(root, ...entry.retiredPath.split("/")) : null,
        bytes: entry.bytes,
      }));
    writes.push(...plan.ruleEntries
      .filter((entry) => new Set(["create", "update"]).has(entry.state))
      .map((entry) => ({
        relative: entry.path,
        target: entry.target,
        state: entry.state,
        beforeSha256: entry.currentSha256,
        afterSha256: entry.sha256,
        bytes: entry.bytes,
      })));
    writes.push(...plan.retirementEntries.map((entry) => ({
      relative: entry.path,
      target: entry.target,
      state: "retire",
      beforeSha256: entry.currentSha256,
      retiredRelative: entry.retiredPath,
      retiredTarget: entry.retiredTarget,
      bytes: null,
    })));
    const lockTarget = await plainTarget(root, INSTALLATION_LOCK_RELATIVE);
    writes.push({
      relative: INSTALLATION_LOCK_RELATIVE,
      target: lockTarget,
      state: plan.lock ? "update" : "create",
      beforeSha256: plan.lock?.digest ?? null,
      bytes: plan.lockBytes,
    });
    await applyTransaction(root, writes, testFailAt);
    const gitResult = commit
      ? await settleExactPackCommit(root, plan)
      : { gitOutcome: "not_requested", gitBlockReason: null, commit: null };
    return {
      ...plan.public,
      status: plan.public.mode === "initial-pack-bootstrap" ? "installed" : "updated",
      ...gitResult,
    };
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
    const commit = parsed.has("--commit");
    if (typeof packagePath !== "string" || typeof rootValue !== "string" || dryRun === write || (commit && !write)) fail("usage_error");
    const options = {
      packagePath,
      rootValue,
      modules: values(parsed, "--module"),
      providers: values(parsed, "--provider"),
    };
    const result = dryRun
      ? await planInstallation(options)
      : await installPackage({ ...options, approvedPlanDigest: parsed.get("--approved-plan-digest"), commit });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schema: PLAN_SCHEMA, status: "rejected", code: error.code || "installation_failed", detail: error.detail ?? null })}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
