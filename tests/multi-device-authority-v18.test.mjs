// Real-process acceptance for the v18 ITS number authority (Task 786).
// Two checkouts of one project act as two devices: A hosts the authority, B is a client reaching it over HTTP.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { registerLocal, requestSignature, responseSignature, projectIdOf } from "../packs/decal-pack/src/contracts/task-work-bug/v18/authority-common.mjs";

const exec = promisify(execFile);
const source = fileURLToPath(new URL("../", import.meta.url));
const contracts = path.join(source, "packs/decal-pack/src/contracts");
const base = await realpath(await mkdtemp(path.join(tmpdir(), "its-authority-")));
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test",
};
delete env.DECAL_SESSION_ID;
Object.assign(process.env, env);

const client = path.join(contracts, "task-work-bug/v18/authority-client.mjs");
const server = path.join(contracts, "task-work-bug/v18/authority-server.mjs");
const validator = path.join(contracts, "task-work-bug/v4/validate-task-index.mjs");

async function run(file, args, options = {}) {
  try {
    const { stdout } = await exec(file, args, { cwd: options.cwd, env: { ...env, ...options.env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, out: stdout.trim() };
  } catch (error) {
    return { code: error.code, out: String(error.stdout ?? "").trim(), err: String(error.stderr ?? "") };
  }
}
const git = async (cwd, ...args) => { const r = await run("git", args, { cwd }); assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.err}`); return r.out; };
const json = (r) => JSON.parse(r.out.split("\n").at(-1));
const node = (script, args, options) => run(process.execPath, [script, ...args], options);

function intentFor(id, slug) {
  return {
    schema: "decal.task-work-bug.task-registration-batch-intent/v7",
    intentId: id,
    commitMessage: `docs(tasks): register ${id}`,
    tasks: [{
      localRef: "item", category: "product", slug, title: `Authority fixture ${id}`, priority: "P1", areas: ["ITS"],
      summary: "번호 권한자 시험", versionImpact: "none", remoteVersionImpact: "none",
      body: "## Context Budget\n\n- 시험\n\n## 완료 기준\n\n- [ ] 번호가 겹치지 않는다\n",
    }],
  };
}
async function writeIntent(dir, id, slug) {
  const file = path.join(dir, `${id}.json`);
  await writeFile(file, JSON.stringify(intentFor(id, slug)));
  return file;
}

async function freePort() {
  return new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

async function makeProject(name) {
  const dir = path.join(base, name);
  const seed = path.join(dir, "seed");
  const origin = path.join(dir, "origin.git");
  await git(base, "init", "-q", "--bare", "-b", "main", origin);
  await git(base, "init", "-q", "-b", "main", seed);
  await cp(contracts, path.join(seed, "contracts"), { recursive: true });
  await cp(path.join(contracts, "task-work-bug/v4/fixtures/project/docs"), path.join(seed, "docs"), { recursive: true });
  await writeFile(path.join(seed, ".gitignore"), ".decal/\n.decal-slice-completion.lock\n");
  await git(seed, "add", ".");
  await git(seed, "commit", "-q", "-m", "seed");
  await git(seed, "remote", "add", "origin", origin);
  await git(seed, "push", "-q", "origin", "main");
  const a = path.join(dir, "deviceA");
  const b = path.join(dir, "deviceB");
  await git(base, "clone", "-q", origin, a);
  await git(base, "clone", "-q", origin, b);
  return { dir, a, b, origin };
}

async function taskFacts(root) {
  const files = (await readdir(path.join(root, "docs/tasks"))).filter((name) => /^task_\d+_/u.test(name));
  const facts = [];
  for (const name of files) {
    const text = await readFile(path.join(root, "docs/tasks", name), "utf8");
    facts.push({ id: Number(/^task_(\d+)_/u.exec(name)[1]), category: /^Task Category: (.+)$/mu.exec(text)?.[1], index: Number(/^Category Index: (\d+)$/mu.exec(text)?.[1]) });
  }
  return facts.sort((x, y) => x.id - y.id);
}
async function assertSound(root, expectedCount) {
  const check = await node(validator, ["--root", root], { cwd: root });
  assert.equal(json(check).status, "accepted", `registry invalid in ${root}: ${check.out}`);
  const facts = await taskFacts(root);
  assert.equal(facts.length, expectedCount, `task count in ${root}`);
  assert.deepEqual(facts.map((item) => item.id), facts.map((_, i) => i + 1), "global numbers are unique and contiguous");
  const product = facts.filter((item) => item.category === "product").map((item) => item.index);
  assert.deepEqual(product, product.map((_, i) => i + 1), "category sequence is unique and contiguous");
}

async function startAuthority(home, port) {
  const child = spawn(process.execPath, [server, "serve"], { env: { ...env, DECAL_ITS_HOME: home }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("exit", (code) => reject(new Error(`authority exited ${code}`)));
  });
  return child;
}
const stop = (child) => new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGTERM"); });

const children = [];
try {
  assert.equal(JSON.parse((await run(process.execPath, [path.join(contracts, "task-work-bug/v18/verify-contract.mjs")])).out).status, "accepted", "v18 manifest verifies");
  // 1. The problem, reproduced: two devices issuing numbers on their own collide.
  {
    const p = await makeProject("baseline");
    const fa = await writeIntent(p.a, "baseline-from-a", "from_a");
    const fb = await writeIntent(p.b, "baseline-from-b", "from_b");
    const [ra, rb] = await Promise.all([
      registerLocal(p.a, JSON.parse(await readFile(fa, "utf8"))),
      registerLocal(p.b, JSON.parse(await readFile(fb, "utf8"))),
    ]);
    assert.equal(ra.assigned[0].taskId, rb.assigned[0].taskId, "independent devices pick the same global number");
    await git(p.a, "push", "-q", "origin", "main");
    await git(p.b, "pull", "--no-rebase", "--no-edit", "-q").then(() => assert.fail("expected a merge conflict"), () => {});
    const conflicts = await git(p.b, "diff", "--name-only", "--diff-filter=U");
    assert.match(conflicts, /docs\/tasks\/index\.md/u, "the shared index conflicts on merge");
    console.log("ok 1  baseline: two devices collide on the same number and conflict on merge");
  }

  // 2-6. The authority.
  const p = await makeProject("authority");
  const home = path.join(p.dir, "home-a");
  const homeB = path.join(p.dir, "home-b");
  const port = await freePort();
  const initOut = json(await node(server, ["init", "--port", String(port)], { env: { DECAL_ITS_HOME: home } }));
  assert.equal(initOut.status, "initialized");
  assert.match(initOut.key, /^[a-f0-9]{64}$/u);
  assert.equal(json(await node(server, ["add-project", "--root", p.a], { env: { DECAL_ITS_HOME: home } })).status, "added");
  assert.equal(json(await node(client, ["init", "--root", p.b, "--url", `http://127.0.0.1:${port}`, "--key", initOut.key], { env: { DECAL_ITS_HOME: homeB } })).status, "configured");

  let daemon = await startAuthority(home, port);
  children.push(daemon);

  // 2. Concurrent registration from both devices.
  {
    const jobs = [];
    for (let i = 0; i < 4; i += 1) {
      jobs.push(writeIntent(p.b, `remote-${i}`, `remote_${i}`).then((f) => node(client, ["register", "--root", p.b, "--intent", f], { cwd: p.b, env: { DECAL_ITS_HOME: homeB } })));
      jobs.push(writeIntent(p.a, `local-${i}`, `local_${i}`).then((f) => node(client, ["register", "--root", p.a, "--intent", f], { cwd: p.a, env: { DECAL_ITS_HOME: home } })));
    }
    const results = (await Promise.all(jobs)).map(json);
    for (const result of results) assert.equal(result.status, "registered", JSON.stringify(result));
    const ids = results.map((result) => result.assigned?.[0]?.taskId ?? result.result?.assigned?.[0]?.taskId);
    assert.equal(new Set(ids).size, 8, `eight distinct numbers, got ${ids}`);
    await assertSound(p.a, 1 + 8);
    console.log("ok 2  eight concurrent registrations from two devices: numbers and category sequence unique");
  }

  // 3. Device B ends up byte-identical to the authority.
  {
    const f = await writeIntent(p.b, "remote-last", "remote_last");
    const result = json(await node(client, ["register", "--root", p.b, "--intent", f], { cwd: p.b, env: { DECAL_ITS_HOME: homeB } }));
    assert.equal(result.status, "registered");
    assert.equal(await git(p.b, "rev-parse", "HEAD"), await git(p.a, "rev-parse", "HEAD"), "client converges on the authority's HEAD");
    await assertSound(p.b, 1 + 9);
    assert.equal(await git(p.b, "status", "--porcelain", "--untracked-files=no"), "", "client working tree stays clean");
    console.log("ok 3  client converges to the authority's exact commit with a clean tree");
  }

  // 4. Authority offline: queue, then deliver exactly once.
  {
    await stop(daemon);
    const f = await writeIntent(p.b, "offline-1", "offline_one");
    const queued = await node(client, ["register", "--root", p.b, "--intent", f], { cwd: p.b, env: { DECAL_ITS_HOME: homeB } });
    assert.equal(queued.code, 3);
    assert.equal(json(queued).status, "queued");
    const status = json(await node(client, ["status", "--root", p.b], { env: { DECAL_ITS_HOME: homeB } }));
    assert.deepEqual(status.queue.map((item) => item.intentId), ["offline-1"]);
    await assertSound(p.b, 1 + 9);

    daemon = await startAuthority(home, port);
    children.push(daemon);
    const flushed = json(await node(client, ["flush", "--root", p.b], { cwd: p.b, env: { DECAL_ITS_HOME: homeB } }));
    assert.equal(flushed.status, "flushed");
    assert.equal(flushed.results.length, 1);
    await assertSound(p.b, 1 + 10);
    const again = json(await node(client, ["flush", "--root", p.b], { cwd: p.b, env: { DECAL_ITS_HOME: homeB } }));
    assert.equal(again.results.length, 0, "nothing left to deliver");

    // The same intent resent later is a replay, not a second record.
    const replay = json(await node(client, ["register", "--root", p.b, "--intent", f], { cwd: p.b, env: { DECAL_ITS_HOME: homeB } }));
    assert.equal(replay.status, "registered", JSON.stringify(replay).slice(0, 700));
    await assertSound(p.a, 1 + 10);
    console.log("ok 4  offline request queued, delivered once on reconnect, resend is an idempotent replay");
  }

  // 5. A blocked merge on the client never loses the issued number.
  {
    const index = path.join(p.b, "docs/tasks/index.md");
    await writeFile(index, `${await readFile(index, "utf8")}\n<!-- local edit -->\n`);
    const f = await writeIntent(p.b, "blocked-sync", "blocked_sync");
    const blocked = json(await node(client, ["register", "--root", p.b, "--intent", f], { cwd: p.b, env: { DECAL_ITS_HOME: homeB } }));
    assert.equal(blocked.status, "sync_pending");
    assert.equal(blocked.code, "sync_merge_blocked");
    assert.ok(blocked.assigned?.[0]?.taskId, "the number was already issued");
    await git(p.b, "checkout", "--", "docs/tasks/index.md");
    const flushed = json(await node(client, ["flush", "--root", p.b], { cwd: p.b, env: { DECAL_ITS_HOME: homeB } }));
    assert.equal(flushed.status, "flushed");
    await assertSound(p.b, 1 + 11);
    await assertSound(p.a, 1 + 11);
    console.log("ok 5  dirty client: number kept, sync retried after cleanup, no duplicate");
  }

  // 6. Security.
  {
    const url = `http://127.0.0.1:${port}`;
    const projectId = await projectIdOf(p.a);
    const post = async (route, payload, { key = initOut.key, time = String(Date.now()), sign = true } = {}) => {
      const body = typeof payload === "string" ? payload : JSON.stringify(payload);
      const headers = { "content-type": "application/json", "x-decal-its-time": time };
      if (sign) headers["x-decal-its-sig"] = requestSignature(key, "POST", route, time, body);
      const response = await fetch(url + route, { method: "POST", headers, body });
      return { status: response.status, text: await response.text(), sig: response.headers.get("x-decal-its-sig"), time };
    };
    assert.equal((await post("/v1/health", { projectId }, { sign: false })).status, 401, "unsigned request refused");
    assert.equal((await post("/v1/health", { projectId }, { key: "00".repeat(32) })).status, 401, "wrong key refused");
    assert.equal((await post("/v1/health", { projectId }, { time: String(Date.now() - 3600000) })).status, 401, "stale request refused");
    const ok = await post("/v1/health", { projectId });
    assert.equal(ok.status, 200);
    assert.equal(ok.sig, responseSignature(initOut.key, ok.time, ok.status, ok.text), "responses are signed");
    assert.equal((await post("/v1/health", { projectId: "0".repeat(32) })).status, 404, "unknown project refused");
    assert.equal((await post("/v1/register", { projectId, intent: { schema: "x", intentId: "bad-schema" } })).status, 400, "unsupported intent refused");
    assert.equal((await post("/v1/register", "x".repeat(1024 * 1024 + 10))).status, 413, "oversized body refused");
    const wrongKey = path.join(p.dir, "wrong");
    await cp(p.b, wrongKey, { recursive: true });
    await node(client, ["init", "--root", wrongKey, "--url", url, "--key", "11".repeat(32)], { env: { DECAL_ITS_HOME: homeB } });
    const f = await writeIntent(wrongKey, "wrong-key", "wrong_key");
    const denied = json(await node(client, ["register", "--root", wrongKey, "--intent", f], { cwd: wrongKey, env: { DECAL_ITS_HOME: homeB } }));
    assert.equal(denied.code, "authority_rejected_key");
    await assertSound(p.a, 1 + 11);
    console.log("ok 6  unsigned, wrong-key, stale, unknown-project, bad-intent and oversized requests are all refused");
  }
  console.log("ITS authority v18 acceptance passed");
} finally {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  await rm(base, { recursive: true, force: true });
}
