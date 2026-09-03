import { readFile } from "node:fs/promises";
import { portablePath, loadSourceDescriptor, parseAgentMetadata, parsePromptMetadata, sourceRoot, walkFiles } from "./pack-lib.mjs";

const descriptor = await loadSourceDescriptor();
const failures = [];
const semver = /^[0-9]+\.[0-9]+\.[0-9]+$/;

if (descriptor.schemaVersion !== 1) failures.push("schemaVersion must be 1");
if (descriptor.packId !== "zuz.decal-pack") failures.push("packId must be zuz.decal-pack");
if (!semver.test(descriptor.packVersion ?? "")) failures.push("packVersion must be SemVer");
if (descriptor.defaultSelected !== false) failures.push("Pack must never be selected by default");
if (descriptor.publicReleaseBlocked !== (descriptor.firstPartyLicense === "UNLICENSED")) failures.push("public release block must match first-party license state");

const moduleIds = new Set();
const membership = new Map();
for (const module of descriptor.modules ?? []) {
  if (moduleIds.has(module.id)) failures.push(`duplicate module:${module.id}`);
  moduleIds.add(module.id);
  if (module.defaultSelected !== false) failures.push(`module selected by default:${module.id}`);
  if (module.projectInitialization !== false) failures.push(`module initializes project state:${module.id}`);
  for (const skillId of module.skillIds ?? []) {
    const owner = membership.get(skillId);
    if (owner) failures.push(`skill belongs to two modules:${skillId}:${owner}:${module.id}`);
    membership.set(skillId, module.id);
  }
}

const discovered = new Map();
for (const absolute of await walkFiles()) {
  const relative = portablePath(sourceRoot, absolute);
  if (relative.startsWith("skills/prompts/") && relative.endsWith(".md") && !relative.includes("/resources/")) {
    const metadata = parsePromptMetadata(await readFile(absolute, "utf8"), relative);
    discovered.set(metadata.id, { ...metadata, kind: "prompt", relative });
  }
  if (relative.startsWith("skills/agents/") && relative.endsWith("/SKILL.md")) {
    const metadata = parseAgentMetadata(await readFile(absolute, "utf8"), relative);
    discovered.set(metadata.id, { ...metadata, kind: "agent", relative });
  }
}

for (const skillId of membership.keys()) if (!discovered.has(skillId)) failures.push(`manifest skill missing:${skillId}`);
for (const skillId of discovered.keys()) if (!membership.has(skillId)) failures.push(`source skill missing module:${skillId}`);

for (const required of ["codex-portable-v1", "claude-portable-v1", "decal-bundled-v1", "primer-embedded-v1", "jig-embedded-v1"]) {
  if (!(descriptor.consumerAcceptance ?? []).includes(required)) failures.push(`missing consumer acceptance:${required}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Decal Pack source verified: ${discovered.size} skills across ${moduleIds.size} modules.`);

