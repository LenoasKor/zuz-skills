#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProject } from "../v4/registry.mjs";
import { digest, fail, loadProfile, planProductVersions, PROFILE_PATH } from "../v9/version-profile.mjs";
import { executePlan, git, gitBoundary, planDigest, validatePlan } from "../v9/transaction.mjs";
import { canonicalStatus, metadata, replaceMetadata } from "../v9/task-policy.mjs";
import { parseWorkBug, updateWorkBugApplied } from "../v9/work-bug-policy.mjs";
import { canonicalTicketId } from "../v9/ticket-path.mjs";
import { readSettlementMode } from "./settlement-mode.mjs";

const entry = (relative, source, next) => ({ path: relative, source, next, before: digest(source), after: digest(next) });
const PENDING = new Set(["pending", "pending-task"]);

// Collect from the committed tree; validatePlan then rejects any included file that is dirty,
// while unrelated dirty records do not block the release.
const committed = (root, head, relative) => git(root, ["show", `${head}:${relative}`]);

// One release applies one version per channel to everything shipped since the last release:
// a completed Task with a pending minor raises the minor, otherwise a closed Work/Bug with a
// pending patch raises the patch. A task-batch item ships only once its Task is completed.
export async function planReleaseSettlement({ root }) {
  const baseHead = await gitBoundary(root);
  const settlement = await readSettlementMode(root);
  if (settlement.mode !== "release") fail("release_mode_required");
  const loaded = await loadProfile(root);
  if (loaded.profile.engine !== "portable") fail("repository_settlement_required");
  const project = await validateProject(root);
  const tasks = [];
  const completed = new Set();
  for (const record of project.index.records) {
    if (canonicalStatus(record.status) !== "completed") continue;
    completed.add(record.rawId);
    const relative = `docs/tasks/${record.fileName}`;
    const source = await committed(root, baseHead, relative);
    const desktop = metadata(source, "Version Impact") === "desktop-minor" && metadata(source, "Version Applied") === "pending";
    const remote = metadata(source, "Remote Version Impact") === "remote-minor" && metadata(source, "Remote Version Applied") === "pending";
    if (desktop || remote) tasks.push({ id: record.rawId, relative, source, desktop, remote });
  }
  const items = [];
  const names = (await git(root, ["ls-tree", "-r", "--name-only", "-z", baseHead, "--", "docs/work-items/work", "docs/work-items/bugs"])).split("\0").filter(Boolean);
  for (const relative of names) {
    const match = /^docs\/work-items\/(work|bugs)\/((?:WORK|BUG)-\d+)\.md$/u.exec(relative);
    if (!match) continue;
    const kind = match[1] === "work" ? "work" : "bug";
    const source = await committed(root, baseHead, relative);
    // Only records still waiting for a version are parsed strictly; settled history is left alone.
    if (!/^(?:versionApplied|remoteVersionApplied):[ \t]*["']?pending(?:-task)?["']?[ \t]*\r?$/mu.test(source)) continue;
    const record = parseWorkBug(source, kind, match[2]);
    if (record.status !== "closed" || record.reason !== (kind === "work" ? "completed" : "fixed")) continue;
    if (record.releaseMode === "task-batch" && !completed.has(record.releaseTaskRef)) continue;
    const desktop = record.versionImpact === "desktop-patch" && PENDING.has(record.versionApplied);
    const remote = record.remoteVersionImpact === "remote-patch" && PENDING.has(record.remoteVersionApplied);
    if (desktop || remote) items.push({ id: record.id, relative, source, record, desktop, remote });
  }
  const impact = (channel) => tasks.some((task) => task[channel]) ? "minor" : items.some((item) => item[channel]) ? "patch" : "none";
  const impacts = { desktop: impact("desktop"), remote: impact("remote") };
  if (impacts.desktop === "none" && impacts.remote === "none") return { plan: null, tasks: [], items: [], versions: {} };
  const productPlan = await planProductVersions(root, loaded.profile, impacts);
  const version = (channel) => productPlan.versions[channel]?.after ?? null;
  const entries = [];
  for (const task of tasks.sort((a, b) => Number(a.id) - Number(b.id))) {
    let next = task.source;
    if (task.desktop) next = replaceMetadata(next, "Version Applied", version("desktop"));
    if (task.remote) next = replaceMetadata(next, "Remote Version Applied", version("remote"));
    entries.push(entry(task.relative, task.source, next));
  }
  for (const item of items) {
    entries.push(entry(item.relative, item.source, updateWorkBugApplied(item.source,
      item.desktop ? version("desktop") : item.record.versionApplied,
      item.remote ? version("remote") : item.record.remoteVersionApplied)));
  }
  entries.push(...productPlan.writes);
  const label = ["desktop", "remote"].filter((channel) => version(channel)).map((channel) => `${channel} ${version(channel)}`).join(", ");
  const plan = {
    root, baseHead, operation: "release-settlement", recordId: tasks[0]?.id ?? canonicalTicketId(items[0].record.kind, items[0].id),
    message: `chore(its): release ${label}`,
    reads: [{ path: PROFILE_PATH, before: loaded.revision }, settlement.read], entries,
  };
  await validatePlan(plan);
  return { plan, tasks: tasks.map((task) => task.id), items: items.map((item) => item.id), versions: productPlan.versions };
}

export async function cli(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (args.has(key)) fail("duplicate_argument");
    if (["--dry-run", "--write"].includes(key)) args.set(key, true);
    else if (["--root", "--approved-plan-digest"].includes(key) && argv[index + 1] && !argv[index + 1].startsWith("--")) args.set(key, argv[++index]);
    else fail("usage_error");
  }
  if (!args.get("--root") || Boolean(args.get("--write")) === Boolean(args.get("--dry-run"))) fail("usage_error");
  const result = await planReleaseSettlement({ root: path.resolve(args.get("--root")) });
  const summary = { schema: "zuz.its.release-settlement-result/v1", tasks: result.tasks, items: result.items, versions: result.versions };
  if (!result.plan) return { ...summary, status: "nothing_to_release", writeSet: [] };
  if (args.get("--dry-run")) return { ...summary, status: "preview", approvalDigest: planDigest(result.plan), root: result.plan.root,
    baseHead: result.plan.baseHead, writeSet: result.plan.entries.filter((item) => item.before !== item.after).map(({ path, before, after }) => ({ path, before, after })) };
  return { ...summary, ...await executePlan(result.plan, args.get("--approved-plan-digest")) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await cli(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stdout.write(JSON.stringify({ status: "rejected", code: error.code ?? "release_settlement_failed" }) + "\n"); process.exitCode = 2; }
}
