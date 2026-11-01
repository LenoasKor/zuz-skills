// Refuses a Task whose version impact the project's own build cannot read. A project opts in by committing
// config/its-version-policy.json; a project without the file keeps the permissive behavior of the older contracts.
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveMainAuthorityRoot } from "../v10/main-authority.mjs";

export const POLICY_FILE = "config/its-version-policy.json";
const POLICY_SCHEMA = "decal.its-version-policy/v1";
const POLICY_LIMIT_BYTES = 65536;
const FIELDS = ["versionImpact", "remoteVersionImpact"];

const invalid = (reason) => ({
  status: "rejected", code: "invalid_version_policy", policy: POLICY_FILE, reason,
  next: `Correct ${POLICY_FILE} or remove it. Nothing was registered.`,
});
const validValues = (values) => Array.isArray(values) && values.length > 0
  && values.every((value) => typeof value === "string" && /^\S+$/u.test(value));

/** Returns { policy } for a usable declaration, or the rejection. */
export function parseVersionPolicy(source) {
  let value;
  try { value = JSON.parse(source); } catch { return invalid("not_json"); }
  if (!value || typeof value !== "object" || value.schema !== POLICY_SCHEMA) return invalid("unknown_schema");
  if (Object.keys(value).some((key) => !["schema", "task"].includes(key))) return invalid("unknown_key");
  const declared = value.task;
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return invalid("task_section_required");
  const keys = Object.keys(declared);
  if (keys.length === 0 || keys.some((key) => !FIELDS.includes(key))) return invalid("task_section_keys");
  if (keys.some((key) => !validValues(declared[key]))) return invalid("task_section_values");
  return { policy: declared };
}

/** The record lands on the canonical main, so its committed declaration decides, not an older feature worktree's copy. */
async function policyRoot(root) {
  try { return (await resolveMainAuthorityRoot(root)).authorityRoot; } catch { return root; }
}

async function readPolicy(root) {
  const file = path.join(await policyRoot(root), POLICY_FILE);
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > POLICY_LIMIT_BYTES) return invalid("not_a_plain_file");
    return parseVersionPolicy(await readFile(file, "utf8"));
  } catch (error) {
    return ["ENOENT", "ENOTDIR"].includes(error?.code) ? { policy: null } : invalid("unreadable_file");
  }
}

/** Checks a Task batch intent only. Other malformed intents are left to the registration contract's own errors. */
export async function checkTaskVersionPolicy(root, intent) {
  const loaded = await readPolicy(root);
  if (loaded.status === "rejected") return loaded;
  if (!loaded.policy || !Array.isArray(intent?.tasks)) return { status: "accepted" };
  const violations = [];
  for (const task of intent.tasks) {
    for (const field of FIELDS) {
      const allowed = loaded.policy[field];
      if (!allowed) continue;
      const value = typeof task?.[field] === "string" ? task[field].trim() : (task?.[field] ?? null);
      if (!allowed.includes(value)) violations.push({ localRef: task?.localRef ?? null, field, value, allowed });
    }
  }
  if (violations.length === 0) return { status: "accepted" };
  return {
    status: "rejected", code: "unreadable_task_version_impact", policy: POLICY_FILE, violations,
    next: `Use a value from ${POLICY_FILE}, or correct that file if the build really reads this value. Nothing was registered.`,
  };
}
