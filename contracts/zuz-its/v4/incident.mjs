import { parseIncident, sourceRevision } from "../v3/incident.mjs";

const REQUIRED = ["schema", "schemaVersion", "id", "title", "issueKind", "status", "priority", "taskRefs", "impact", "affectedServices", "classifications", "occurredAt", "detectedAt", "mitigatedAt", "recoveredAt", "resolutionEvidence", "createdAt", "updatedAt", "blocked", "completion", "closure"];

function fail(code) { throw Object.assign(new Error(code), { code }); }

/** Validate the canonical header before the immutable v3 value parser sees it.
 * Body examples must never supply a missing identity/status/impact field.
 * Unknown header fields and the body are read without transforming them.
 */
export function parseStrictIncident(source, fileName) {
  const normalized = source.replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(normalized);
  if (!match) fail("frontmatter_invalid");
  const keys = [...match[1].matchAll(/^([^\s:#][^:\r\n]*):/gmu)].map((item) => item[1]);
  if (new Set(keys).size !== keys.length) fail("ambiguous_frontmatter");
  if (REQUIRED.some((key) => !keys.includes(key))) fail("missing_frontmatter_field");
  const record = parseIncident(`---\n${match[1]}\n---\n`, fileName);
  return { ...record, revision: sourceRevision(source) };
}
