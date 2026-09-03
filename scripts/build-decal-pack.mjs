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

function providerSkillTargets(skillId, relativePath = "SKILL.md") {
  return [
    { provider: "codex", path: `skills/${skillId}/${relativePath}` },
    { provider: "claude", path: `.claude/skills/${skillId}/${relativePath}` },
    { provider: "gemini", path: `.gemini/skills/${skillId}/${relativePath}` },
    { provider: "acp", path: `.agents/skills/${skillId}/${relativePath}` },
  ];
}

function promptAgentSkill(text, identity, relativePath) {
  const frontmatterEnd = text.indexOf("\n---\n", 4);
  if (frontmatterEnd < 0) throw new Error(`unterminated-frontmatter:${relativePath}`);
  const header = text.slice(4, frontmatterEnd);
  const value = (key) => header.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?$`, "m"))?.[1]?.trim() ?? null;
  const label = value("label");
  const template = value("template");
  if (!label) throw new Error(`missing-prompt-label:${relativePath}`);
  const body = text.slice(frontmatterEnd + 5).trim();
  const description = `${label} 규약을 프로젝트에서 실행합니다.`;
  return Buffer.from([
    "---",
    `name: ${identity.id}`,
    `description: ${JSON.stringify(description)}`,
    `version: ${identity.version}`,
    "---",
    "",
    `# ${label}`,
    "",
    template,
    template && body ? "" : null,
    body,
    "",
  ].filter((line) => line !== null && line !== undefined).join("\n"));
}

function installTargets(relativePath, moduleId) {
  if (relativePath.startsWith("skills/prompts/")) {
    const rest = relativePath.slice("skills/prompts/".length);
    const resource = rest.match(/^resources\/([^/]+)\/(.+)$/);
    if (resource) {
      return [
        { provider: "shared", path: `docs/skills/${rest}` },
        ...providerSkillTargets(resource[1], resource[2]),
      ];
    }
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
  if (relativePath.startsWith("consumer-acceptance/")) {
    return [{ provider: "shared", path: `docs/skills/vendor/decal-project-pack/${relativePath}` }];
  }
  if (relativePath.startsWith("vendor/")) return [{ provider: "shared", path: `docs/skills/${relativePath}` }];
  if (relativePath === "project-skill-pack-policy.json") return [];
  if (relativePath === "LICENSE" || relativePath === "NOTICE") {
    return [{ provider: "shared", path: `docs/skills/vendor/decal-project-pack/${relativePath}` }];
  }
  throw new Error(`unmapped-source-path:${relativePath}:${moduleId}`);
}

for (const absolute of await walkFiles()) {
  const relativePath = portablePath(sourceRoot, absolute);
  assertSafeRelativePath(relativePath);
  const bytes = await readFile(absolute);
  let moduleId = relativePath.startsWith("contracts/") ? "task-work-bug" : relativePath.startsWith("vendor/") ? "portable-core" : "portable-core";
  let promptIdentity = null;
  if (relativePath.startsWith("skills/prompts/") && relativePath.endsWith(".md") && !relativePath.includes("/resources/")) {
    const identity = parsePromptMetadata(bytes.toString("utf8"), relativePath);
    promptIdentity = identity;
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
  if (promptIdentity) {
    const agentBytes = promptAgentSkill(bytes.toString("utf8"), promptIdentity, relativePath);
    const generatedPath = `generated/skills/${promptIdentity.id}/SKILL.md`;
    files.push({
      sourcePath: generatedPath,
      derivedFrom: relativePath,
      moduleId,
      sha256: sha256(agentBytes),
      size: agentBytes.byteLength,
      executable: false,
      installTargets: providerSkillTargets(promptIdentity.id),
      contentBase64: agentBytes.toString("base64"),
    });
  }
}

skills.sort((a, b) => a.id.localeCompare(b.id));
files.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
const acceptanceFiles = new Map();
for (const file of files) {
  const match = file.sourcePath.match(/^consumer-acceptance\/v1\/([a-z0-9-]+)\.json$/);
  if (!match) continue;
  const fixture = JSON.parse(Buffer.from(file.contentBase64, "base64").toString("utf8"));
  if (fixture.schemaVersion !== 1 || fixture.fixtureId !== match[1]) {
    throw new Error(`invalid-consumer-acceptance-fixture:${file.sourcePath}`);
  }
  if (acceptanceFiles.has(fixture.fixtureId)) throw new Error(`duplicate-consumer-acceptance-fixture:${fixture.fixtureId}`);
  acceptanceFiles.set(fixture.fixtureId, file);
}
const consumerAcceptanceFixtures = descriptor.consumerAcceptance.map((id) => {
  const file = acceptanceFiles.get(id);
  if (!file) throw new Error(`missing-consumer-acceptance-fixture:${id}`);
  return { id, sourcePath: file.sourcePath, sha256: file.sha256, size: file.size };
});
if (acceptanceFiles.size !== consumerAcceptanceFixtures.length) throw new Error("undeclared-consumer-acceptance-fixture");
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
  consumerAcceptanceFixtures,
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
