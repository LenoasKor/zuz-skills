import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LOCK_FILE = ".decal-slice-completion.lock";
const JOURNAL_FILE = ".decal/its-ticket-registration-pending-v1.json";
const INTENT_SCHEMA = "decal.zuz-its.ticket-registration-intent/v7";
const RESULT_SCHEMA = "decal.zuz-its.ticket-registration/v7";
const PREDECESSOR_MANIFEST_SHA256 = "6d5176a773e03724b36e1be333a533ae223988d56a1f924f43ba0def8529db5e";
const CONTRACT_ROOT = path.dirname(fileURLToPath(import.meta.url));

const KINDS = {
  work: { directory: "work", prefix: "WORK-", schema: "decal.task-work-bug.work-document" },
  bug: { directory: "bugs", prefix: "BUG-", schema: "decal.task-work-bug.bug-card" },
  incident: { directory: "incidents", prefix: "INC-", schema: "zuz.its.incident-ticket" },
};

function fail(code, detail = null) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function scalar(value) {
  return value === null || value === undefined ? "null" : JSON.stringify(value);
}

async function git(root, args, options = {}) {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: options.encoding ?? "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout;
}

async function metadata(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertPlainPath(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("path_escape");
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const entry = await metadata(current);
    if (entry?.isSymbolicLink()) fail("symlink_rejected");
  }
}

async function validatePackage(root) {
  const predecessor = path.join(root, "contracts/task-work-bug/v6/manifest.json");
  const predecessorMetadata = await metadata(predecessor);
  if (predecessorMetadata?.isSymbolicLink() || !predecessorMetadata?.isFile()) fail("contract_digest_mismatch");
  if (digest(await readFile(predecessor)) !== `sha256:${PREDECESSOR_MANIFEST_SHA256}`) fail("contract_digest_mismatch");
  const manifestPath = path.join(CONTRACT_ROOT, "manifest.json");
  const manifestMetadata = await metadata(manifestPath);
  if (manifestMetadata?.isSymbolicLink() || !manifestMetadata?.isFile()) fail("contract_digest_mismatch");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest?.schema !== "decal.task-work-bug.fixture-manifest/v7" || !manifest.files) fail("contract_digest_mismatch");
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const target = path.join(CONTRACT_ROOT, ...relative.split("/"));
    const entry = await metadata(target);
    if (entry?.isSymbolicLink() || !entry?.isFile() || digest(await readFile(target)) !== `sha256:${expected}`) {
      fail("contract_digest_mismatch", relative);
    }
  }
}

function normalizeIntent(value) {
  if (!value || value.schema !== INTENT_SCHEMA || !KINDS[value.kind]) fail("invalid_intent");
  for (const key of ["intentId", "title", "priority", "body", "versionImpact", "remoteVersionImpact", "releaseMode"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) fail("invalid_intent", key);
  }
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(value.intentId)) fail("invalid_intent_id");
  if (!/^P[0-3]$/u.test(value.priority)) fail("invalid_priority");
  if (!value.body.trimStart().startsWith("## ")) fail("invalid_body");
  if (!Array.isArray(value.taskRefs) || value.taskRefs.some((item) => !/^[1-9][0-9]*$/u.test(String(item)))) fail("invalid_task_refs");
  if (!new Set(["desktop-patch", "none"]).has(value.versionImpact)) fail("invalid_version_impact");
  if (!new Set(["remote-patch", "none"]).has(value.remoteVersionImpact)) fail("invalid_remote_version_impact");
  if (!new Set(["standalone", "task-batch"]).has(value.releaseMode)) fail("invalid_release_mode");
  if (value.releaseMode === "task-batch" && !/^[1-9][0-9]*$/u.test(String(value.releaseTaskRef ?? ""))) fail("invalid_release_task_ref");
  if (value.releaseMode === "standalone" && value.releaseTaskRef != null) fail("invalid_release_task_ref");
  if (value.nextAction !== undefined && (typeof value.nextAction !== "string" || !value.nextAction.trim())) fail("invalid_next_action");
  if (value.kind === "incident") {
    const incident = value.incident;
    if (!incident || typeof incident !== "object") fail("incident_details_required");
    for (const key of ["impact", "occurredAt", "detectedAt"]) {
      if (typeof incident[key] !== "string" || !incident[key].trim()) fail("invalid_incident_details");
    }
    for (const key of ["affectedServices", "classifications", "resolutionEvidence"]) {
      if (!Array.isArray(incident[key]) || incident[key].some((item) => typeof item !== "string" || !item.trim())) fail("invalid_incident_details");
    }
  } else if (value.incident !== undefined) fail("incident_details_not_allowed");
  return {
    schema: INTENT_SCHEMA,
    intentId: value.intentId,
    kind: value.kind,
    title: value.title.trim(),
    priority: value.priority,
    taskRefs: value.taskRefs.map(String),
    ...(value.nextAction ? { nextAction: value.nextAction.trim() } : {}),
    versionImpact: value.versionImpact,
    remoteVersionImpact: value.remoteVersionImpact,
    releaseMode: value.releaseMode,
    ...(value.releaseTaskRef ? { releaseTaskRef: String(value.releaseTaskRef) } : {}),
    body: value.body.trim(),
    ...(value.incident ? { incident: stable(value.incident) } : {}),
    commitMessage: typeof value.commitMessage === "string" && value.commitMessage.trim()
      ? value.commitMessage.trim()
      : `docs(its): register ${value.kind}`,
  };
}

export function ticketRegistrationIntentDigest(value) {
  return digest(JSON.stringify(stable(normalizeIntent(value))));
}

function compareDecimal(left, right) {
  const a = left.replace(/^0+(?=\d)/u, "");
  const b = right.replace(/^0+(?=\d)/u, "");
  if (a.length !== b.length) return a.length - b.length;
  return a.localeCompare(b);
}

function incrementDecimal(value) {
  const digits = [...value];
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry; index -= 1) {
    if (digits[index] === "9") digits[index] = "0";
    else {
      digits[index] = String(Number(digits[index]) + 1);
      carry = 0;
    }
  }
  if (carry) digits.unshift("1");
  return digits.join("");
}

function recordIdentity(kind, source) {
  const definition = KINDS[kind];
  const read = (key) => new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)$`, "mu").exec(source)?.[1]?.trim().replace(/^['"]|['"]$/gu, "");
  const id = read("id");
  if (read("schema") !== definition.schema || read("schemaVersion") !== "1") fail("unsupported_record_schema");
  if (!new RegExp(`^${definition.prefix}[0-9]{3,}$`, "u").test(id ?? "")) fail("invalid_identity");
  return id;
}

async function scanKind(root, kind) {
  const definition = KINDS[kind];
  const directory = path.join(root, "docs/work-items", definition.directory);
  await assertPlainPath(root, directory);
  const directoryMetadata = await metadata(directory);
  if (directoryMetadata && !directoryMetadata.isDirectory()) fail("not_a_directory");
  if (!directoryMetadata) return { directory, maximum: "0" };
  let maximum = "0";
  const pattern = new RegExp(`^${definition.prefix}([0-9]{3,})\\.md$`, "u");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const match = pattern.exec(entry.name);
    if (!match) continue;
    if (entry.isSymbolicLink() || !entry.isFile()) fail("symlink_or_invalid_file");
    const source = await readFile(path.join(directory, entry.name), "utf8");
    if (recordIdentity(kind, source) !== entry.name.slice(0, -3)) fail("identity_filename_mismatch");
    if (compareDecimal(match[1], maximum) > 0) maximum = match[1];
  }
  return { directory, maximum };
}

function render(intent, id, timestamp) {
  const pending = intent.releaseMode === "task-batch" ? "pending-task" : "pending";
  const lines = [
    "---",
    `schema: ${KINDS[intent.kind].schema}`,
    "schemaVersion: 1",
    `id: ${id}`,
    `title: ${scalar(intent.title)}`,
    "status: new",
    `priority: ${intent.priority}`,
    ...(intent.taskRefs.length ? ["taskRefs:", ...intent.taskRefs.map((ref) => `  - ${scalar(ref)}`)] : ["taskRefs: []"]),
    ...(intent.nextAction ? [`nextAction: ${scalar(intent.nextAction)}`] : []),
    `versionImpact: ${intent.versionImpact}`,
    `remoteVersionImpact: ${intent.remoteVersionImpact}`,
    `releaseMode: ${intent.releaseMode}`,
    `releaseTaskRef: ${intent.releaseTaskRef ? scalar(intent.releaseTaskRef) : "null"}`,
    `versionApplied: ${intent.versionImpact === "none" ? "not-required" : pending}`,
    `remoteVersionApplied: ${intent.remoteVersionImpact === "none" ? "not-required" : pending}`,
    `createdAt: ${scalar(timestamp)}`,
    `updatedAt: ${scalar(timestamp)}`,
    "blocked: null",
    "completion: null",
    "closure: null",
  ];
  if (intent.incident) {
    lines.push(
      "incident:",
      `  impact: ${scalar(intent.incident.impact)}`,
      ...(intent.incident.affectedServices.length
        ? ["  affectedServices:", ...intent.incident.affectedServices.map((item) => `    - ${scalar(item)}`)]
        : ["  affectedServices: []"]),
      ...(intent.incident.classifications.length
        ? ["  classifications:", ...intent.incident.classifications.map((item) => `    - ${scalar(item)}`)]
        : ["  classifications: []"]),
      `  occurredAt: ${scalar(intent.incident.occurredAt)}`,
      `  detectedAt: ${scalar(intent.incident.detectedAt)}`,
      `  mitigatedAt: ${scalar(intent.incident.mitigatedAt)}`,
      `  recoveredAt: ${scalar(intent.incident.recoveredAt)}`,
      ...(intent.incident.resolutionEvidence.length
        ? ["  resolutionEvidence:", ...intent.incident.resolutionEvidence.map((item) => `    - ${scalar(item)}`)]
        : ["  resolutionEvidence: []"]),
    );
  }
  lines.push("---", "", intent.body, "");
  return lines.join("\n");
}

async function assertGitBoundary(root) {
  const top = String(await git(root, ["rev-parse", "--show-toplevel"])).trim();
  if (await realpath(top) !== await realpath(root)) fail("main_repository_required");
  const branch = String(await git(root, ["branch", "--show-current"])).trim();
  if (branch !== "main") fail("main_branch_required");
  if (String(await git(root, ["diff", "--cached", "--name-only"])).trim()) fail("staged_changes_present");
  if (String(await git(root, ["diff", "--name-only", "--diff-filter=U"])).trim()) fail("unmerged_paths_present");
  const gitDirectory = path.resolve(root, String(await git(root, ["rev-parse", "--git-dir"])).trim());
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
    if (await metadata(path.join(gitDirectory, marker))) fail("git_operation_in_progress");
  }
  return String(await git(root, ["rev-parse", "HEAD"])).trim();
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function acquireLock(root, timeoutMs = 30_000) {
  const target = path.join(root, LOCK_FILE);
  const owner = `${JSON.stringify({ schema: "decal.repository-lock/v1", pid: process.pid, token: randomUUID() })}\n`;
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(target, "wx", 0o600);
      await handle.writeFile(owner);
      await handle.close();
      return async () => {
        if (await readFile(target, "utf8").catch(() => null) === owner) await unlink(target);
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lockMetadata = await metadata(target);
      if (!lockMetadata) {
        await sleep(40);
        continue;
      }
      if (lockMetadata.isSymbolicLink() || !lockMetadata.isFile()) fail("unsafe_repository_lock");
      let pid = null;
      try {
        const source = await readFile(target, "utf8");
        try {
          pid = JSON.parse(source).pid;
        } catch {
          // Another writer may observe the lock after open("wx") succeeds but
          // before the small owner JSON write is complete. Treat any incomplete
          // JSON as ordinary contention during the bounded acquisition window.
          if (Date.now() - started < timeoutMs) {
            await sleep(40);
            continue;
          }
          fail("unsafe_repository_lock");
        }
      } catch (error) {
        if (error?.code === "ENOENT") {
          await sleep(40);
          continue;
        }
        throw error;
      }
      if (!Number.isSafeInteger(pid) || pid < 1) {
        if (Date.now() - started < timeoutMs) {
          await sleep(40);
          continue;
        }
        fail("unsafe_repository_lock");
      }
      try { process.kill(pid, 0); } catch (presenceError) {
        if (presenceError?.code === "ESRCH") { await unlink(target); continue; }
      }
      if (Date.now() - started >= timeoutMs) fail("repository_lock_timeout");
      await sleep(40);
    }
  }
}

async function journal(root, value) {
  const target = path.join(root, JOURNAL_FILE);
  await assertPlainPath(root, target);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const current = await metadata(target);
  if (current?.isSymbolicLink() || (current && !current.isFile())) fail("unsafe_journal");
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, target);
}

async function findCommit(root, intentDigest) {
  return String(await git(root, ["log", "HEAD", "--format=%H", "--fixed-strings", "--grep", `Decal-ITS-Registration-Intent: ${intentDigest}`]))
    .trim().split(/\r?\n/u).filter(Boolean)[0] ?? null;
}

async function receipt(root, intentDigest, commit, status = "replayed") {
  const paths = String(await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit])).trim().split(/\r?\n/u).filter(Boolean);
  if (paths.length !== 1 || !/^docs\/work-items\/(?:work|bugs|incidents)\/(?:WORK|BUG|INC)-[0-9]{3,}\.md$/u.test(paths[0])) fail("invalid_replay_commit");
  const source = String(await git(root, ["show", `${commit}:${paths[0]}`]));
  const id = /^id:\s*((?:WORK|BUG|INC)-[0-9]{3,})$/mu.exec(source)?.[1];
  if (!id) fail("invalid_replay_commit");
  return { schema: RESULT_SCHEMA, status, code: "accepted", intentDigest, commit, assigned: { id, path: paths[0] }, writeSet: paths };
}

export async function recoverTicketRegistration(root) {
  const target = path.join(root, JOURNAL_FILE);
  const entry = await metadata(target);
  if (!entry) return { state: "none" };
  if (entry.isSymbolicLink() || !entry.isFile()) fail("unsafe_journal");
  const value = JSON.parse(await readFile(target, "utf8"));
  if (
    value?.schema !== "decal.zuz-its.ticket-registration-journal/v1"
    || typeof value.path !== "string"
    || !/^docs\/work-items\/(?:work|bugs|incidents)\/(?:WORK|BUG|INC)-[0-9]{3,}\.md$/u.test(value.path)
    || typeof value.intentDigest !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.intentDigest)
    || typeof value.afterDigest !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(value.afterDigest)
  ) fail("invalid_journal");
  const committed = await findCommit(root, value.intentDigest);
  if (committed) {
    await unlink(target);
    return { state: "committed", receipt: await receipt(root, value.intentDigest, committed) };
  }
  const record = path.join(root, ...value.path.split("/"));
  await assertPlainPath(root, record);
  const recordMetadata = await metadata(record);
  if (recordMetadata) {
    if (recordMetadata.isSymbolicLink() || !recordMetadata.isFile()) fail("recovery_mixed_state");
    if (digest(await readFile(record)) !== value.afterDigest) fail("recovery_mixed_state");
    await git(root, ["restore", "--staged", "--", value.path]).catch(() => undefined);
    await rm(record);
  }
  await unlink(target);
  return { state: "rolled_back" };
}

export async function planTicketRegistration(root, rawIntent) {
  await validatePackage(root);
  const intent = normalizeIntent(rawIntent);
  await assertGitBoundary(root);
  return {
    intent,
    intentDigest: digest(JSON.stringify(stable(intent))),
    identityPending: true,
    preview: { kind: intent.kind, title: intent.title, priority: intent.priority, taskRefs: intent.taskRefs },
    writeSet: [`docs/work-items/${KINDS[intent.kind].directory}/${KINDS[intent.kind].prefix}<assigned>.md`],
  };
}

export async function registerTicket({ root, intent: rawIntent, approvedDigest, testFailAt = null }) {
  await validatePackage(root);
  const intent = normalizeIntent(rawIntent);
  const intentDigest = digest(JSON.stringify(stable(intent)));
  if (approvedDigest !== intentDigest) fail("approval_digest_mismatch");
  const release = await acquireLock(root);
  try {
    const recovered = await recoverTicketRegistration(root);
    if (recovered.receipt?.intentDigest === intentDigest) return recovered.receipt;
    const baseHead = await assertGitBoundary(root);
    const replayCommit = await findCommit(root, intentDigest);
    if (replayCommit) return receipt(root, intentDigest, replayCommit);
    const scan = await scanKind(root, intent.kind);
    const number = incrementDecimal(scan.maximum);
    const id = `${KINDS[intent.kind].prefix}${number.padStart(3, "0")}`;
    const relative = `docs/work-items/${KINDS[intent.kind].directory}/${id}.md`;
    const target = path.join(root, ...relative.split("/"));
    await assertPlainPath(root, target);
    if (await metadata(target)) fail("target_overlap");
    const source = render(intent, id, new Date().toISOString());
    if (recordIdentity(intent.kind, source) !== id) fail("render_validation_failed");
    await mkdir(scan.directory, { recursive: true });
    const pending = {
      schema: "decal.zuz-its.ticket-registration-journal/v1",
      phase: "prepared",
      intentDigest,
      baseHead,
      path: relative,
      afterDigest: digest(source),
    };
    await journal(root, pending);
    try {
      const temporary = `${target}.decal-${randomUUID()}.tmp`;
      await writeFile(temporary, source, { flag: "wx" });
      await rename(temporary, target);
      await journal(root, { ...pending, phase: "sealed" });
      if (testFailAt === "after_write") fail("injected_failure");
      if (String(await git(root, ["rev-parse", "HEAD"])).trim() !== baseHead) fail("head_changed");
      await git(root, ["add", "--", relative]);
      const staged = String(await git(root, ["diff", "--cached", "--name-only"])).trim();
      if (staged !== relative) fail("staged_write_set_mismatch");
      await git(root, ["commit", "--only", "-m", intent.commitMessage, "-m", `Decal-ITS-Registration-Intent: ${intentDigest}`, "--", relative]);
      if (testFailAt === "after_commit") fail("injected_failure");
      const commit = String(await git(root, ["rev-parse", "HEAD"])).trim();
      const result = await receipt(root, intentDigest, commit, "committed");
      if (result.assigned.id !== id || result.assigned.path !== relative) fail("commit_content_mismatch");
      await unlink(path.join(root, JOURNAL_FILE));
      return { ...result, baseHead };
    } catch (error) {
      if (await findCommit(root, intentDigest).catch(() => null)) throw error;
      await git(root, ["restore", "--staged", "--", relative]).catch(() => undefined);
      await recoverTicketRegistration(root);
      throw error;
    }
  } finally {
    await release();
  }
}

export const ticketRegistrationResultSchema = RESULT_SCHEMA;
