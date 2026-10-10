import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isRegistered, validateIntentShape } from "../v18/authority-common.mjs";
import { fail } from "./lan-crypto.mjs";

const execFileAsync = promisify(execFile);
export { isRegistered };

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
export const validDigest = (value) => typeof value === "string" && DIGEST.test(value);

/** Incident records have their own broker (v16); everything else uses v15, or v10 on older packs. */
async function brokerScript(root, intent, kind) {
  const file = kind === "task-batch" ? "register-task-batch.mjs" : "register-ticket.mjs";
  const versions = kind === "ticket" && intent.kind === "incident" ? ["v16"] : ["v15", "v10"];
  for (const version of versions) {
    const script = path.join(root, "contracts", "task-work-bug", version, file);
    try { await access(script); return script; } catch { /* next */ }
  }
  return fail("broker_unavailable", `${versions.join("/")} ${file}`);
}

async function runBroker(script, args, cwd) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, ...args], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout.trim().split("\n").pop());
  } catch (error) {
    const line = String(error.stdout ?? "").trim().split("\n").pop();
    if (line) { try { return JSON.parse(line); } catch { /* fall through */ } }
    return fail("broker_failed", String(error.message).slice(0, 300));
  }
}

/**
 * Registers one intent through the project's own canonical-main broker. The dry-run digest binds exactly what is
 * written; a caller that already showed a digest to the user passes it as `approvedDigest` and a mismatch writes nothing.
 */
export async function registerLocal(root, intent, { approvedDigest = null } = {}) {
  const kind = validateIntentShape(intent);
  if (approvedDigest !== null && !validDigest(approvedDigest)) return { status: "rejected", code: "invalid_approved_digest" };
  const script = await brokerScript(root, intent, kind);
  const directory = await mkdtemp(path.join(os.tmpdir(), "decal-its-intent-"));
  try {
    const intentPath = path.join(directory, "intent.json");
    await writeFile(intentPath, JSON.stringify(intent), { mode: 0o600 });
    const plan = await runBroker(script, ["--root", root, "--intent", intentPath, "--dry-run"], root);
    if (plan.status === "replayed") return plan;
    if (plan.status !== "planned" || plan.code !== "accepted") return plan;
    if (approvedDigest !== null && plan.intentDigest !== approvedDigest) return { status: "rejected", code: "approval_digest_mismatch" };
    return await runBroker(script, ["--root", root, "--intent", intentPath, "--approved-digest", plan.intentDigest, "--write"], root);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
