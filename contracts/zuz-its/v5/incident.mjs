import { parseStrictIncident as parseV4 } from "../v4/incident.mjs";
import { sourceRevision } from "../v3/incident.mjs";
const TIME_KEYS = ["occurredAt", "detectedAt", "mitigatedAt", "recoveredAt", "createdAt", "updatedAt"];
function fail(code) { throw Object.assign(new Error(code), { code }); }
function scalar(header, key) {
  const match = new RegExp(`^${key}:[ \t]*([^\r\n]*)$`, "mu").exec(header);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw || raw === "null") return null;
  try { return JSON.parse(raw); } catch { return raw.replace(/^['"]|['"]$/gu, ""); }
}
/** UTC calendar validation retains arbitrary decimal precision without Number conversion. */
export function utcKey(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/u.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== match[1]) return null;
  return { second: match[1], fraction: match[2] || "" };
}
export function compareUtc(left, right) {
  const a = utcKey(left), b = utcKey(right);
  if (!a || !b) fail("incident_timestamp_invalid");
  if (a.second !== b.second) return a.second < b.second ? -1 : 1;
  const length = Math.max(a.fraction.length, b.fraction.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.fraction[index] || "0", y = b.fraction[index] || "0";
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
export function parseStrictIncident(source, fileName) {
  const normalized = source.replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(normalized);
  if (!match) fail("frontmatter_invalid");
  const times = Object.fromEntries(TIME_KEYS.map(key => [key, scalar(match[1], key)]));
  // Validate the canonical shape first with a read-only, whole-second projection.
  // Null optional fields retain the legacy value semantics. No source bytes are rewritten.
  let projected = match[1];
  for (const key of TIME_KEYS) {
    const value = times[key];
    if (value != null && !utcKey(value)) fail(key === "createdAt" || key === "updatedAt" ? "timestamp_invalid" : "incident_timestamp_invalid");
    if (value != null) projected = projected.replace(new RegExp(`^${key}:[^\r\n]*$`, "gmu"), `${key}: "${utcKey(value).second}.000Z"`);
  }
  const record = parseV4(`---\n${projected}\n---\n`, fileName);
  if (compareUtc(times.detectedAt, times.occurredAt) < 0 ||
      (times.mitigatedAt && compareUtc(times.mitigatedAt, times.detectedAt) < 0) ||
      (times.recoveredAt && compareUtc(times.recoveredAt, times.mitigatedAt ?? times.detectedAt) < 0)) fail("incident_timestamp_order_invalid");
  if (compareUtc(times.updatedAt, times.createdAt) < 0) fail("timestamp_invalid");
  return { ...record, occurredAt: times.occurredAt, detectedAt: times.detectedAt,
    mitigatedAt: times.mitigatedAt, recoveredAt: times.recoveredAt, revision: sourceRevision(source) };
}
