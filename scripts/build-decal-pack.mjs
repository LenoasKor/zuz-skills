import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertSafeRelativePath,
  loadSourceDescriptor,
  packRoot,
  parseAgentMetadata,
  parsePromptMetadata,
  portablePath,
  repositoryRoot,
  sha256,
  sourceRoot,
  stableJson,
  walkFiles,
  writeStableJson,
} from "./pack-lib.mjs";

const revisionIndex = process.argv.indexOf("--source-revision");
const sourceRevision = revisionIndex >= 0 ? process.argv[revisionIndex + 1] : null;
if (!sourceRevision || !/^[0-9a-f]{40}$/.test(sourceRevision)) {
  console.error("Usage: npm run build:decal-pack -- --source-revision <40-character-git-sha>");
  process.exit(2);
}

const descriptor = await loadSourceDescriptor();
if (descriptor.publicReleaseBlocked) {
  console.error("Public release is blocked until a first-party license is selected.");
  process.exit(3);
}

const skillModules = new Map(descriptor.modules.flatMap((module) => module.skillIds.map((id) => [id, module.id])));
const skills = [];
const files = [];

function installTargets(relativePath, moduleId) {
  if (relativePath.startsWith("skills/prompts/")) {
    const rest = relativePath.slice("skills/prompts/".length);
    return [{ provider: "shared", path: `docs/skills/${rest}` }];
  }
  if (relativePath.startsWith("skills/agents/")) {
    const rest = relativePath.slice("skills/agents/".length);
    return [
      { provider: "codex", path: `skills/${rest}` },
      { provider: "claude", path: `.claude/skills/${rest}` },
      { provider: "gemini", path: `.gemini/skills/${rest}` },
      { provider: "acp", path: `.agents/skills/${rest}` },
    ];
  }
  if (relativePath.startsWith("contracts/")) return [{ provider: "shared", path: relativePath }];
  if (relativePath.startsWith("vendor/")) return [{ provider: "shared", path: `docs/skills/${relativePath}` }];
  if (relativePath === "project-skill-pack-policy.json") return [];
  if (relativePath === "LICENSE" || relativePath === "NOTICE") {
    return [{ provider: "shared", path: `docs/skills/vendor/zuz.decal-pack/${relativePath}` }];
  }
  throw new Error(`unmapped-source-path:${relativePath}:${moduleId}`);
}

for (const absolute of await walkFiles()) {
  const relativePath = portablePath(sourceRoot, absolute);
  assertSafeRelativePath(relativePath);
  const bytes = await readFile(absolute);
  let moduleId = relativePath.startsWith("contracts/") ? "task-work-bug" : relativePath.startsWith("vendor/") ? "portable-core" : "portable-core";
  if (relativePath.startsWith("skills/prompts/") && relativePath.endsWith(".md") && !relativePath.includes("/resources/")) {
    const identity = parsePromptMetadata(bytes.toString("utf8"), relativePath);
    moduleId = skillModules.get(identity.id);
    skills.push({ ...identity, kind: "prompt", moduleId, sourcePath: relativePath });
  } else if (relativePath.startsWith("skills/agents/") && relativePath.endsWith("/SKILL.md")) {
    const identity = parseAgentMetadata(bytes.toString("utf8"), relativePath);
    moduleId = skillModules.get(identity.id);
    skills.push({ ...identity, kind: "agent", moduleId, sourcePath: relativePath });
  } else if (relativePath.startsWith("skills/prompts/resources/")) {
    const resourceSkillId = relativePath.split("/")[3];
    moduleId = skillModules.get(resourceSkillId);
  }
  if (!moduleId) throw new Error(`source-file-without-module:${relativePath}`);
  const targets = installTargets(relativePath, moduleId);
  for (const target of targets) assertSafeRelativePath(target.path);
  files.push({
    sourcePath: relativePath,
    moduleId,
    sha256: sha256(bytes),
    size: bytes.byteLength,
    executable: false,
    installTargets: targets,
    contentBase64: bytes.toString("base64"),
  });
}

skills.sort((a, b) => a.id.localeCompare(b.id));
files.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
const unsignedManifest = {
  schemaVersion: 1,
  packageType: "zuz-portable-pack",
  packId: descriptor.packId,
  packVersion: descriptor.packVersion,
  sourceRepository: "https://github.com/LenoasKor/zuz-skills",
  sourceRevision,
  generatedFrom: "packs/decal-pack/pack.source.json",
  modules: descriptor.modules,
  compatibility: descriptor.compatibility,
  capabilities: descriptor.capabilities,
  revocations: descriptor.revocations,
  consumerAcceptance: descriptor.consumerAcceptance,
  license: descriptor.firstPartyLicense,
  skills,
  files: files.map(({ contentBase64: _contentBase64, ...file }) => file),
};
const manifestSha256 = sha256(stableJson(unsignedManifest));
const packageValue = { ...unsignedManifest, manifestSha256, files };
const packageBytes = `${stableJson(packageValue)}\n`;
const packageSha256 = sha256(packageBytes);
const outputDirectory = join(repositoryRoot, "dist");
await writeStableJson(join(outputDirectory, `decal-pack-${descriptor.packVersion}.manifest.json`), { ...unsignedManifest, manifestSha256, packageSha256 });
await writeStableJson(join(outputDirectory, `decal-pack-${descriptor.packVersion}.zuz-pack.json`), packageValue);
console.log(JSON.stringify({ packId: descriptor.packId, packVersion: descriptor.packVersion, sourceRevision, manifestSha256, packageSha256, skills: skills.length, files: files.length }));
