import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

export const repositoryRoot = resolve(import.meta.dirname, "..");
export const packRoot = join(repositoryRoot, "packs/decal-pack");
export const sourceRoot = join(packRoot, "src");
export const sourceDescriptorPath = join(packRoot, "pack.source.json");

export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function portablePath(root, target) {
  return relative(root, target).split(sep).join(posix.sep);
}

export function assertSafeRelativePath(path) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`unsafe-relative-path:${path}`);
  }
}

export async function loadSourceDescriptor() {
  return JSON.parse(await readFile(sourceDescriptorPath, "utf8"));
}

export async function walkFiles(root = sourceRoot) {
  const output = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`symlink-not-allowed:${portablePath(root, absolute)}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(absolute);
      else throw new Error(`unsupported-file-type:${portablePath(root, absolute)}`);
    }
  }
  await visit(root);
  return output;
}

export function parsePromptMetadata(text, path) {
  if (!text.startsWith("---\n")) throw new Error(`missing-frontmatter:${path}`);
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`unterminated-frontmatter:${path}`);
  const header = text.slice(4, end);
  const value = (key) => header.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?$`, "m"))?.[1]?.trim() ?? null;
  const id = value("id");
  const version = value("version");
  if (!id || !version) throw new Error(`missing-prompt-identity:${path}`);
  return { id, version };
}

export function parseAgentMetadata(text, path) {
  if (!text.startsWith("---\n")) throw new Error(`missing-frontmatter:${path}`);
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`unterminated-frontmatter:${path}`);
  const header = text.slice(4, end);
  const name = header.match(/^name:\s*["']?([^"'\n]+)["']?$/m)?.[1]?.trim() ?? null;
  const version = header.match(/^\s*version:\s*["']?([^"'\n]+)["']?$/m)?.[1]?.trim() ?? null;
  if (!name || !version) throw new Error(`missing-agent-identity:${path}`);
  return { id: name, version };
}

export async function writeStableJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableJson(value)}\n`);
}

