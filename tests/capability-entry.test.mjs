// The stable entry runs only contracts listed in capabilities.json, only after they verify, and never falls back.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const contracts = path.join(repositoryRoot, "packs/decal-pack/src/contracts");
const base = await mkdtemp(path.join(tmpdir(), "its-entry-"));
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
delete env.DECAL_SESSION_ID;

const run = (file, args, cwd) => {
  const r = spawnSync(file, args, { cwd, env, encoding: "utf8" });
  let body = null;
  try { body = JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch { /* not json */ }
  return { ...r, body };
};
const git = (cwd, ...args) => { const r = run("git", args, cwd); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };

async function makeProject(name) {
  const root = path.join(base, name);
  await mkdir(root, { recursive: true });
  await cp(contracts, path.join(root, "contracts"), { recursive: true });
  await cp(path.join(contracts, "task-work-bug/v4/fixtures/project/docs"), path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), ".decal/\n.decal-slice-completion.lock\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return root;
}
const entry = (root, kind, file, ...rest) => run(process.execPath, [path.join(root, "contracts/task-work-bug/its-register.mjs"), "--kind", kind, "--root", root, "--intent", file, ...rest], root);
const taskCount = async (root) => (await readdir(path.join(root, "docs/tasks"))).filter((n) => /^task_\d+_/u.test(n)).length;

const context = "## 사용자 요약\n\n```zuz-its-context\n" + JSON.stringify({ schemaVersion: 1, reason: "시험", goal: "시험", completion: "시험", nextAction: "시험" }) + "\n```\n";
const taskIntent = (id) => ({
  schema: "decal.task-work-bug.task-registration-batch-intent/v7", intentId: id, commitMessage: `docs(tasks): ${id}`,
  tasks: [{ localRef: "t", category: "product", slug: id.replaceAll("-", "_"), title: id, priority: "P1", areas: ["ITS"], summary: "입구 시험", versionImpact: "none", remoteVersionImpact: "none", body: `## Context Budget\n\n- 시험\n\n${context}` }],
});
const ticketIntent = (kind, id, extra = {}) => ({
  schema: "decal.zuz-its.ticket-registration-intent/v9", intentId: id, kind, title: id, priority: "P1", taskRefs: ["1"],
  versionImpact: "none", remoteVersionImpact: "none", releaseMode: "standalone", body: context, ...extra,
});
const incident = { impact: "major", affectedServices: ["fixture"], classifications: ["security"], occurredAt: "2026-10-06T01:00:00Z", detectedAt: "2026-10-06T01:00:00.5001Z", mitigatedAt: null, recoveredAt: null, resolutionEvidence: [] };
async function put(root, name, value) { const file = path.join(root, name); await writeFile(file, JSON.stringify(value)); return file; }

async function register(root, kind, intent) {
  const file = await put(root, `${intent.intentId}.json`, intent);
  const plan = entry(root, kind, file, "--dry-run");
  assert.equal(plan.body?.status, "planned", `${intent.intentId}: ${plan.stdout}`);
  return entry(root, kind, file, "--approved-digest", plan.body.intentDigest, "--write");
}

try {
  // 1. Every registration kind goes through the one entry.
  {
    const root = await makeProject("kinds");
    const task = await register(root, "task", taskIntent("entry-task"));
    assert.equal(task.body.status, "committed", task.stdout);
    for (const [kind, extra, folder] of [["work", {}, "work"], ["bug", {}, "bugs"], ["incident", { incident }, "incidents"]]) {
      const done = await register(root, "ticket", ticketIntent(kind, `entry-${kind}`, extra));
      assert.equal(done.body.status, "committed", `${kind}: ${done.stdout}`);
      assert.equal((await readdir(path.join(root, "docs/work-items", folder))).length, 1);
    }
    assert.equal(await taskCount(root), 2);
    console.log("ok 1  Task, Work, Bug and Incident register through the single entry");
  }

  // 2. A folder that is not in the table never runs, however it names itself.
  {
    const root = await makeProject("decoy");
    const decoy = path.join(root, "contracts/task-work-bug/v99");
    await mkdir(decoy, { recursive: true });
    await writeFile(path.join(decoy, "register-task-batch.mjs"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(path.join(root, "decoy-ran"))}, "x"); console.log('{"status":"committed"}');\n`);
    await writeFile(path.join(decoy, "verify-contract.mjs"), 'console.log(\'{"status":"accepted"}\');\n');
    const done = await register(root, "task", taskIntent("entry-decoy"));
    assert.equal(done.body.status, "committed");
    await assert.rejects(readFile(path.join(root, "decoy-ran")), "the unlisted v99 never executed");
    console.log("ok 2  an unlisted higher-numbered folder is never executed");
  }

  // 3. A contract that fails verification stops the registration, with no fallback and no write.
  {
    const root = await makeProject("tamper");
    const head = git(root, "rev-parse", "HEAD");
    await appendFile(path.join(root, "contracts/task-work-bug/v15/registration.mjs"), "\n// tampered\n");
    const file = await put(root, "t.json", taskIntent("entry-tamper"));
    const result = entry(root, "task", file, "--dry-run");
    assert.equal(result.status, 2);
    assert.equal(result.body.code, "authoring_update_required");
    assert.equal(result.body.contract, "v15");
    const write = entry(root, "task", file, "--approved-digest", `sha256:${"0".repeat(64)}`, "--write");
    assert.equal(write.body.code, "authoring_update_required");
    assert.equal(git(root, "rev-parse", "HEAD"), head, "nothing was committed");
    assert.equal(await taskCount(root), 1, "no older contract was used instead");
    console.log("ok 3  a tampered contract stops the entry: no write and no fallback to an older version");
  }

  // 4. A capability that is not advertised, and a table that tries to escape, are refused.
  {
    const root = await makeProject("table");
    const tablePath = path.join(root, "contracts/task-work-bug/capabilities.json");
    const table = JSON.parse(await readFile(tablePath, "utf8"));
    delete table.capabilities["register-incident"];
    await writeFile(tablePath, JSON.stringify(table));
    const inc = await register(root, "ticket", ticketIntent("work", "entry-ok-work")).catch((error) => error);
    assert.equal(inc.body.status, "committed", "Work still registers");
    const file = await put(root, "inc.json", ticketIntent("incident", "entry-no-incident", { incident }));
    const refused = entry(root, "ticket", file, "--dry-run");
    assert.equal(refused.body.code, "authoring_update_required");
    assert.equal(refused.body.reason, "capability_not_advertised");
    table.capabilities["register-ticket"] = { contract: "v15", entry: "../v10/register-ticket.mjs" };
    await writeFile(tablePath, JSON.stringify(table));
    const escaped = entry(root, "ticket", await put(root, "w.json", ticketIntent("work", "entry-escape")), "--dry-run");
    assert.equal(escaped.body.code, "invalid_capability_table");
    console.log("ok 4  an unadvertised capability and a table entry that escapes its folder are refused");
  }

  // 5. A project paired with an authority never registers locally when that route is unavailable.
  {
    for (const how of ["missing", "tampered"]) {
      const root = await makeProject(`paired-${how}`);
      await mkdir(path.join(root, ".decal"), { recursive: true });
      await writeFile(path.join(root, ".decal/its-lan-client.json"), "{}");
      if (how === "missing") await rm(path.join(root, "contracts/task-work-bug/v19"), { recursive: true });
      else await appendFile(path.join(root, "contracts/task-work-bug/v19/lan-client.mjs"), "\n// tampered\n");
      const head = git(root, "rev-parse", "HEAD");
      const file = await put(root, "p.json", taskIntent(`entry-paired-${how}`));
      const plan = entry(root, "task", file, "--dry-run");
      assert.equal(plan.body.status, "planned", "a preview is read-only and still works");
      const write = entry(root, "task", file, "--approved-digest", plan.body.intentDigest, "--write");
      assert.equal(write.status, 2);
      assert.equal(write.body.code, "authority_client_unavailable", write.stdout);
      assert.equal(git(root, "rev-parse", "HEAD"), head, "no local number was issued");
      assert.equal(await taskCount(root), 1);
    }
    console.log("ok 5  a paired project whose authority client is missing or tampered stops instead of issuing a local number");
  }
  console.log("capability entry acceptance passed");
} finally {
  await rm(base, { recursive: true, force: true });
}
