import { readFile } from "node:fs/promises";
import { portablePath, loadSourceDescriptor, parseAgentMetadata, parsePromptMetadata, sourceRoot, walkFiles } from "./pack-lib.mjs";

const descriptor = await loadSourceDescriptor();
const failures = [];
const semver = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const policy = JSON.parse(await readFile(new URL("../packs/decal-pack/src/project-skill-pack-policy.json", import.meta.url), "utf8"));

if (descriptor.schemaVersion !== 1) failures.push("schemaVersion must be 1");
if (descriptor.packId !== "decal-project-pack") failures.push("packId must preserve the installed decal-project-pack identity");
if (!semver.test(descriptor.packVersion ?? "")) failures.push("packVersion must be SemVer");
if (descriptor.defaultSelected !== false) failures.push("Pack must never be selected by default");
if (descriptor.publicReleaseBlocked !== (descriptor.firstPartyLicense === "UNLICENSED")) failures.push("public release block must match first-party license state");
if (policy.packId !== descriptor.packId || policy.packVersion !== descriptor.packVersion) failures.push("project skill Pack policy identity must match source descriptor");
if (descriptor.executionPolicies?.repositoryAuthority?.crossProjectAccess !== "explicit-current-user-approval") failures.push("cross-project access must require explicit current-user approval");
if (descriptor.executionPolicies?.repositoryAuthority?.identityProbe !== "root-and-product-identity-only") failures.push("cross-project pre-approval probe must be identity-only");
if (descriptor.executionPolicies?.settlementCommit?.externalHost !== "explicit-settlement-request-authorizes-exact-settlement-commit") failures.push("external settlement must include its exact commit checkpoint");
if (descriptor.executionPolicies?.settlementCommit?.finalizerRequired !== true) failures.push("settlement finalizer must be required");
if (descriptor.executionPolicies?.settlementCommit?.pushIncluded !== false) failures.push("settlement authority must not include push");

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
const acceptanceFixtures = new Map();
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
  const acceptanceMatch = relative.match(/^consumer-acceptance\/v1\/([a-z0-9-]+)\.json$/);
  if (acceptanceMatch) {
    const fixture = JSON.parse(await readFile(absolute, "utf8"));
    const id = acceptanceMatch[1];
    if (fixture.schemaVersion !== 1 || fixture.fixtureId !== id || typeof fixture.consumer !== "string") {
      failures.push(`invalid consumer acceptance fixture:${relative}`);
    }
    if (!Array.isArray(fixture.requiredCases) || fixture.requiredCases.length === 0 || fixture.requiredCases.some((item) => typeof item !== "string" || !item)) {
      failures.push(`consumer acceptance cases required:${relative}`);
    }
    if (acceptanceFixtures.has(id)) failures.push(`duplicate consumer acceptance fixture:${id}`);
    acceptanceFixtures.set(id, relative);
  }
}

for (const skillId of membership.keys()) if (!discovered.has(skillId)) failures.push(`manifest skill missing:${skillId}`);
for (const skillId of discovered.keys()) if (!membership.has(skillId)) failures.push(`source skill missing module:${skillId}`);

for (const required of ["codex-portable-v1", "claude-portable-v1", "gemini-portable-v1", "acp-portable-v1", "decal-bundled-v1", "primer-embedded-v1", "jig-embedded-v1"]) {
  if (!(descriptor.consumerAcceptance ?? []).includes(required)) failures.push(`missing consumer acceptance:${required}`);
  if (!acceptanceFixtures.has(required)) failures.push(`missing consumer acceptance fixture:${required}`);
}
for (const id of acceptanceFixtures.keys()) if (!(descriptor.consumerAcceptance ?? []).includes(id)) failures.push(`undeclared consumer acceptance fixture:${id}`);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Decal Pack source verified: ${discovered.size} skills across ${moduleIds.size} modules.`);
