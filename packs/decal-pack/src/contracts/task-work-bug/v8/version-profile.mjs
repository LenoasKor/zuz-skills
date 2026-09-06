import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseStrictJson } from "./strict-json.mjs";

export const PROFILE_SCHEMA = "zuz.its.settlement-profile/v1";
export const PROFILE_PATH = ".decal/settlement-profile.json";
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const ID = /^[a-z][a-z0-9-]{0,63}$/u;

export function fail(code, detail = null) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function object(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !allowed.includes(key))
      || required.some((key) => !Object.hasOwn(value, key))) fail("invalid_profile");
}

export function relativePath(value) {
  if (typeof value !== "string" || !value || value.length > 500
      || /[\\\u0000-\u001f\u007f:]/u.test(value)
      || path.posix.isAbsolute(value)
      || value.split("/").some((part) => !part || part === "." || part === ".."
        || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part))) {
    fail("unsafe_relative_path");
  }
  return value;
}

// Check every ancestor, not just the leaf. realpath alone would hide symlinks.
export async function safeFile(root, relative) {
  relativePath(relative);
  const canonical = await realpath(root);
  if (canonical !== path.resolve(root)) fail("noncanonical_root");
  let target = canonical;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part);
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      fail("unsafe_file", relative);
    }
    if (index === parts.length - 1 && (stat.nlink !== 1 || stat.size > 16 * 1024 * 1024)) {
      fail("unsafe_file", relative);
    }
  }
  return target;
}

export function parseVersion(value) {
  if (typeof value !== "string" || !SEMVER.test(value)) fail("invalid_version");
  const numbers = value.split(".").map(Number);
  if (numbers.some((number) => !Number.isSafeInteger(number))) fail("invalid_version");
  return numbers;
}

export function bumpVersion(value, impact) {
  const [major, minor, patch] = parseVersion(value);
  const next = impact === "minor" ? `${major}.${minor + 1}.0`
    : impact === "patch" ? `${major}.${minor}.${patch + 1}`
      : impact === "none" ? value : fail("invalid_version_impact");
  parseVersion(next);
  return next;
}

function pointerParts(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/") || /~(?![01])/u.test(pointer)) {
    fail("invalid_json_pointer");
  }
  const parts = pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) fail("invalid_json_pointer");
  return parts;
}

export function validateProfile(profile) {
  object(profile, ["schema", "engine", "channels", "products"]);
  if (profile.schema !== PROFILE_SCHEMA || !["portable", "repository"].includes(profile.engine)) fail("unsupported_profile");
  object(profile.channels, ["desktop", "remote"]);
  if (!Array.isArray(profile.products) || profile.products.length > 16) fail("invalid_profile");
  const ids = new Set();
  const ownership = new Map();
  for (const product of profile.products) {
    object(product, ["id", "files"]);
    if (typeof product.id !== "string" || !ID.test(product.id) || ids.has(product.id)) fail("invalid_product_id");
    ids.add(product.id);
    if (!Array.isArray(product.files) || !product.files.length || product.files.length > 32) fail("invalid_version_files");
    for (const file of product.files) {
      object(file, ["path", "format", "pointers", "packageName"], ["path", "format"]);
      relativePath(file.path);
      if (/^(?:\.git|\.decal|contracts|docs\/tasks|docs\/work-items)(?:\/|$)/u.test(file.path)) fail("reserved_version_path");
      if (ownership.has(file.path)) fail("duplicate_version_path");
      ownership.set(file.path, product.id);
      if (file.format === "json") {
        if (Object.hasOwn(file, "packageName")) fail("invalid_version_files");
        if (!Array.isArray(file.pointers) || !file.pointers.length || file.pointers.length > 16
            || new Set(file.pointers).size !== file.pointers.length) fail("invalid_json_pointer");
        file.pointers.forEach(pointerParts);
      } else if (file.format === "cargo-lock-package") {
        if (Object.hasOwn(file, "pointers") || typeof file.packageName !== "string"
            || !/^[A-Za-z0-9_-]+$/u.test(file.packageName)) fail("invalid_version_files");
      } else if (!["cargo-package", "plain-semver"].includes(file.format)
          || Object.hasOwn(file, "pointers") || Object.hasOwn(file, "packageName")) {
        fail("unsupported_version_format");
      }
    }
  }
  const selected = Object.values(profile.channels).filter((id) => id !== null);
  if (selected.some((id) => typeof id !== "string" || !ids.has(id))
      || new Set(selected).size !== selected.length || selected.length !== ids.size) fail("invalid_product_channels");
  return profile;
}

function jsonTarget(value, pointer) {
  const parts = pointerParts(pointer);
  let parent = value;
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part)) fail("missing_version_field");
    parent = parent[part];
  }
  const key = parts.at(-1);
  if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) fail("missing_version_field");
  parseVersion(parent[key]);
  return { parent, key };
}

function cargoVersion(source) {
  // Intentionally only a literal [package].version, never workspace inheritance,
  // dependency versions, repeated [[package]] lock entries, or general TOML edits.
  const sections = [...source.matchAll(/^\[([^\]\r\n]+)\][ \t]*(?:#[^\r\n]*)?\r?$/gmu)];
  const packages = sections.filter((match) => match[1] === "package");
  if (packages.length !== 1 || /^\[\[/mu.test(source)) fail("unsupported_cargo_version");
  const section = packages[0];
  const end = sections.find((match) => match.index > section.index)?.index ?? source.length;
  const body = source.slice(section.index, end);
  const versions = [...body.matchAll(/^(version[ \t]*=[ \t]*["'])([^"'\r\n]+)(["'][ \t]*(?:#[^\r\n]*)?\r?)$/gmu)];
  if (versions.length !== 1) fail("unsupported_cargo_version");
  const match = versions[0];
  parseVersion(match[2]);
  return { version: match[2], offset: section.index + match.index + match[1].length };
}

function cargoLockVersion(source, packageName) {
  const sections = [...source.matchAll(/^\[\[package\]\][ \t]*\r?$/gmu)];
  const matches = [];
  for (const [index, section] of sections.entries()) {
    const block = source.slice(section.index, sections[index + 1]?.index ?? source.length);
    const names = [...block.matchAll(/^name[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*\r?$/gmu)];
    if (!names.some((match) => match[1] === packageName)) continue;
    // A registry/git dependency with the same name is not the local product.
    if (names.length !== 1 || /^source[ \t]*=/mu.test(block)) fail("ambiguous_cargo_package");
    const versions = [...block.matchAll(/^(version[ \t]*=[ \t]*")([^"\r\n]+)("[ \t]*\r?)$/gmu)];
    if (versions.length !== 1) fail("ambiguous_cargo_package");
    parseVersion(versions[0][2]);
    matches.push({ version: versions[0][2], offset: section.index + versions[0].index + versions[0][1].length });
  }
  if (matches.length !== 1) fail("ambiguous_cargo_package");
  return matches[0];
}

export function readVersionFile(source, file) {
  if (file.format === "json") {
    const value = parseStrictJson(source);
    const versions = file.pointers.map((pointer) => {
      const { parent, key } = jsonTarget(value, pointer);
      return parent[key];
    });
    if (new Set(versions).size !== 1) fail("version_mismatch", file.path);
    return versions[0];
  }
  if (file.format === "cargo-package") return cargoVersion(source).version;
  if (file.format === "cargo-lock-package") return cargoLockVersion(source, file.packageName).version;
  if (file.format !== "plain-semver") fail("unsupported_version_format");
  parseVersion(source.trim());
  return source.trim();
}

export function updateVersionFile(source, file, next) {
  const previous = readVersionFile(source, file);
  parseVersion(next);
  if (previous === next) return source;
  if (file.format === "json") {
    const value = parseStrictJson(source);
    for (const pointer of file.pointers) {
      const { parent, key } = jsonTarget(value, pointer);
      parent[key] = next;
    }
    const indent = /\n([ \t]+)"/u.exec(source)?.[1] ?? 2;
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    return JSON.stringify(value, null, indent).replaceAll("\n", eol) + (source.endsWith("\n") ? eol : "");
  }
  if (file.format === "cargo-package" || file.format === "cargo-lock-package") {
    const { offset } = file.format === "cargo-package" ? cargoVersion(source) : cargoLockVersion(source, file.packageName);
    return source.slice(0, offset) + next + source.slice(offset + previous.length);
  }
  return source.replace(previous, next);
}

export async function loadProfile(root) {
  const source = await readFile(await safeFile(root, PROFILE_PATH), "utf8");
  return { profile: validateProfile(parseStrictJson(source)), source, revision: digest(source) };
}

// Read-only planner. No config discovery, package hooks, installs, or Git writes.
export async function planProductVersions(root, profile, impacts) {
  validateProfile(profile);
  if (profile.engine !== "portable") fail("repository_settlement_required");
  object(impacts, ["desktop", "remote"]);
  const writes = [];
  const versions = {};
  for (const channel of ["desktop", "remote"]) {
    if (!["none", "minor", "patch"].includes(impacts[channel])) fail("invalid_version_impact");
    const id = profile.channels[channel];
    if (impacts[channel] === "none") {
      versions[channel] = null;
      continue;
    }
    if (id === null) {
      if (impacts[channel] !== "none") fail("product_configuration_required", channel);
      versions[channel] = null;
      continue;
    }
    const product = profile.products.find((candidate) => candidate.id === id);
    const files = await Promise.all(product.files.map(async (file) => {
      const source = await readFile(await safeFile(root, file.path), "utf8");
      return { file, source, version: readVersionFile(source, file) };
    }));
    if (new Set(files.map((file) => file.version)).size !== 1) fail("version_mismatch", id);
    const before = files[0].version;
    const after = bumpVersion(before, impacts[channel]);
    versions[channel] = { productId: id, before, after };
    for (const { file, source } of files) {
      const next = updateVersionFile(source, file, after);
      writes.push({ path: file.path, source, next, before: digest(source), after: digest(next) });
    }
  }
  return { versions, writes };
}
