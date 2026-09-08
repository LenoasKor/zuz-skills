import { parseIndex, splitCells } from "../v4/registry.mjs";
import { digest, fail } from "./version-profile.mjs";

export const TASK_FLOW = ["backlog", "planned", "in_progress", "development_complete", "release_ready", "completed"];
const TRANSITIONS = {
  backlog: ["planned"], planned: ["backlog", "in_progress", "blocked", "postponed", "archived", "deprecated"],
  in_progress: ["blocked", "postponed", "development_complete", "archived", "deprecated"], postponed: ["planned"],
  development_complete: ["in_progress", "blocked", "postponed", "release_ready", "completed", "archived", "deprecated"],
  release_ready: ["in_progress", "blocked", "postponed", "completed"], completed: ["maintained", "in_progress"],
  maintained: ["in_progress", "postponed", "archived", "deprecated"], archived: [], deprecated: [],
};
const LIFECYCLE = ["Blocked From", "Blocked Reason", "Blocked Exit Criteria", "Postponed From", "Postponed Reason", "Resume Criteria", "Target Release"];
export const canonicalStatus = (status) => status === "complete" ? "completed" : status;

function header(source) {
  const end = /^##[ \t]+/mu.exec(source)?.index ?? source.length;
  return source.slice(0, end);
}

export function metadata(source, key, optional = false) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const values = [...header(source).matchAll(new RegExp(`^${escaped}:[ \\t]*([^\\r\\n]*)`, "gmu"))];
  if (values.length === 0 && optional) return null;
  if (values.length !== 1 || !values[0][1].trim()) fail("invalid_task_metadata", key);
  return values[0][1].trim();
}

export function replaceMetadata(source, key, value) {
  const head = header(source);
  metadata(source, key);
  return head.replace(new RegExp(`^${key}:[ \\t]*[^\\r\\n]*`, "mu"), () => `${key}: ${value}`) + source.slice(head.length);
}

export function assertCriteria(source) {
  const match = /^##[ \t]+완료 기준[ \t]*\r?$/mu.exec(source);
  if (!match) fail("completion_criteria_required");
  const remaining = source.slice(match.index + match[0].length);
  const section = remaining.slice(0, /^##[ \t]+/mu.exec(remaining)?.index ?? remaining.length);
  // Code examples are not user completion criteria.
  const lines = section.split(/\r?\n/u);
  let fence = null;
  const checks = [];
  for (const line of lines) {
    const marker = /^[ \t]*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = null; continue; }
    if (fence) continue;
    const check = /^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+/u.exec(line);
    if (check) checks.push(check[1]);
  }
  if (!checks.length || checks.includes(" ")) fail("unchecked_completion_criteria");
}

function oneLine(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000 || /[\r\n\u0000-\u001f]/u.test(value)) fail("invalid_verification", label);
  return value.trim();
}

export function validateVerification(value, { head, tree, recordId, target }) {
  if (!value || value.schema !== "zuz.its.completion-verification/v1" || value.outcome !== "passed"
      || !["clean-snapshot", "trusted-ci"].includes(value.source)
      || value.verifiedHead !== head || value.verifiedTree !== tree
      || value.recordId !== String(recordId) || value.targetStatus !== target
      || !["user", "ai"].includes(value.confirmedBy)
      || typeof value.confirmedAt !== "string" || !/^\d{4}-\d\d-\d\dT.*Z$/u.test(value.confirmedAt)
      || !Number.isFinite(Date.parse(value.confirmedAt))
      || !Array.isArray(value.evidence) || !value.evidence.length) fail("verification_binding_mismatch");
  for (const key of ["summary", "environment"]) oneLine(value[key], key);
  value.evidence.forEach((item) => oneLine(item, "evidence"));
  return value;
}

export function appendVerification(source, verification, from) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  return source.trimEnd() + eol + eol + [
    "## 완료 확인 기록", "", "<!-- decal-slice-completion:v1 -->",
    `- Kind: ${verification.confirmedBy === "ai" ? "automated-smoke" : "user-test"}`,
    `- Confirmed At: ${verification.confirmedAt}`, `- Confirmed By: ${verification.confirmedBy}`,
    `- Environment: ${verification.environment}`, `- Summary: ${verification.summary}`,
    `- Source Status: ${from}`, `- Target Status: ${verification.targetStatus}`,
    `- Verified HEAD: ${verification.verifiedHead}`, `- Verified Tree: ${verification.verifiedTree}`,
    `- Verification Source: ${verification.source}`, `- Verification Receipt: ${digest(JSON.stringify(verification))}`,
    ...verification.evidence.map((item) => `- Evidence: ${item}`), "",
  ].join(eol);
}

export function transitionTaskDocument(source, to, details = {}, { testPass = false } = {}) {
  const from = canonicalStatus(metadata(source, "상태"));
  if (!Object.hasOwn(TRANSITIONS, to) && to !== "blocked") fail("invalid_status_transition");
  if (from === to) return source;
  const forward = TASK_FLOW.indexOf(from) >= 0 && TASK_FLOW.indexOf(to) > TASK_FLOW.indexOf(from);
  const skipped = !TRANSITIONS[from]?.includes(to);
  if (from === "blocked") {
    if (to !== "postponed" && to !== metadata(source, "Blocked From")) fail("invalid_blocked_resume");
  } else if (skipped && !(forward && (to === "development_complete" || testPass))) fail("invalid_status_transition");
  if (["development_complete", "release_ready", "completed"].includes(to)) assertCriteria(source);
  if (["release_ready", "completed"].includes(to) && !details.verification) fail("completion_verification_required");
  let next = replaceMetadata(source, "상태", to);
  const oldHeader = header(next);
  let newHeader = oldHeader;
  for (const field of LIFECYCLE) newHeader = newHeader.replace(new RegExp(`^${field}:[^\\r\\n]*(?:\\r?\\n)?`, "mu"), "");
  const additions = to === "blocked" ? {
    "Blocked From": from, "Blocked Reason": details.reason, "Blocked Exit Criteria": details.exitCriteria,
  } : to === "postponed" ? {
    "Postponed From": from, "Postponed Reason": details.reason, "Resume Criteria": details.resumeCriteria, "Target Release": details.targetRelease,
  } : {};
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  for (const [key, value] of Object.entries(additions)) oneLine(value, key);
  next = newHeader + Object.entries(additions).map(([key, value]) => `${key}: ${value}${eol}${eol}`).join("") + next.slice(oldHeader.length);
  return next;
}

export function updateTaskIndex(source, id, to) {
  const parsed = parseIndex(source);
  const record = parsed.records.find((entry) => entry.rawId === String(id));
  if (!record) fail("task_not_found");
  if (canonicalStatus(record.status) === to) return source;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(eol);
  const cells = splitCells(lines[record.line - 1]);
  cells[2] = `\`${to}\``;
  lines[record.line - 1] = `| ${cells.slice(1, -1).join(" | ")} |`;
  const heading = lines.findIndex((line) => line.trim() === "## 상태 요약");
  if (heading >= 0) {
    const counts = new Map();
    for (const item of parsed.records) counts.set(canonicalStatus(item.status), (counts.get(canonicalStatus(item.status)) ?? 0) + 1);
    for (const [status, delta] of [[canonicalStatus(record.status), -1], [to, 1]]) {
      const matches = [];
      for (let i = heading + 1; i < lines.length && !lines[i].startsWith("## "); i += 1) {
        if (lines[i].startsWith(`| \`${status}\` |`)) matches.push(i);
      }
      if (matches.length !== 1) fail("invalid_status_summary");
      const index = matches[0]; const summary = splitCells(lines[index]);
      if (summary.length !== 5 || !/^\d+$/u.test(summary[2]) || Number(summary[2]) !== (counts.get(status) ?? 0)) fail("invalid_status_summary");
      summary[2] = String(Number(summary[2]) + delta);
      // Preserve prose notes; maintain exact-ID lists when this summary uses them.
      const listed = !summary[3] || summary[3] === "없음" || /^Task \d+(?:, Task \d+)*$/u.test(summary[3]);
      if (listed) {
        const entries = summary[3].startsWith("Task ") ? summary[3].split(", ") : [];
        summary[3] = (delta < 0 ? entries.filter((item) => item !== `Task ${id}`) : [...entries.filter((item) => item !== `Task ${id}`), `Task ${id}`]).join(", ") || "없음";
      }
      lines[index] = `| ${summary.slice(1, -1).join(" | ")} |`;
    }
  }
  return lines.join(eol);
}
