import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, chmod, symlink, rm, realpath, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { sourceRevision } from "../packs/decal-pack/src/contracts/zuz-its/v3/incident.mjs";
import { parseStrictIncident } from "../packs/decal-pack/src/contracts/zuz-its/v5/incident.mjs";
import { verifyContract } from "../packs/decal-pack/src/contracts/zuz-its/v5/verify-contract.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "packs/decal-pack/src/contracts/zuz-its/v5/transition-incident.mjs");
const source = `---
schema: zuz.its.incident-ticket
schemaVersion: 1
id: INC-1
title: "Synthetic Incident"
issueKind: incident
status: new
priority: P1
taskRefs: []
nextAction: "Synthetic only"
impact: degraded
affectedServices:
  - "Synthetic service"
classifications: []
occurredAt: "2026-10-06T00:00:00.000Z"
detectedAt: "2026-10-06T00:01:00.000Z"
mitigatedAt: null
recoveredAt: null
resolutionEvidence: []
versionImpact: none
remoteVersionImpact: none
releaseMode: standalone
releaseTaskRef: null
versionApplied: not-required
remoteVersionApplied: not-required
createdAt: "2026-10-06T00:02:00.000Z"
updatedAt: "2026-10-06T00:02:00.000Z"
blocked: null
completion: null
closure: null
x-custom: "preserve me"
---

## Synthetic body

status: in_progress
impact: critical
Synthetic memo

`;
async function fixture(t, text = source, filename = "INC-1.md") {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "bug325-v5-")));
  // Preserve owned synthetic fixtures as evidence; children close before run resolves.
  const directory = path.join(root, "docs/work-items/incidents");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  await writeFile(target, text);
  return { root, directory, target };
}
function run(f, flags = [], options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.DECAL_SESSION_ID; delete env.NODE_OPTIONS;
    Object.assign(env, options.env ?? {});
    const child = spawn(process.execPath, [...(options.preload ? ["--require", options.preload] : []), cli,
      "--root", f.root, "--id", options.id ?? "INC-1", "--status", options.status ?? "confirmed",
      "--expected-source-revision", options.revision ?? sourceRevision(options.source ?? source), ...flags], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject); child.once("close", (code) => resolve({ code, stdout, stderr, result: JSON.parse(stdout) }));
  });
}
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("v5 package verifies pinned source dependencies", async () => {
  assert.equal((await verifyContract()).status, "accepted");
});
test("forward transition preserves schema, identity, createdAt, unknown fields, body, mode and CRLF", async (t) => {
  const text = source.replaceAll("\n", "\r\n"); const f = await fixture(t, text); await chmod(f.target, 0o640);
  const result = await run(f, [], { source: text }); assert.equal(result.code, 0);
  const final = await readFile(f.target, "utf8"); const record = parseStrictIncident(final, "INC-1.md");
  assert.equal(record.status, "confirmed");
  for (const line of ["schema: zuz.its.incident-ticket", "schemaVersion: 1", "id: INC-1", 'createdAt: "2026-10-06T00:02:00.000Z"', 'x-custom: "preserve me"']) assert.ok(final.includes(line + "\r\n"));
  assert.equal(final.split("\r\n---\r\n")[1], text.split("\r\n---\r\n")[1]);
  assert.equal(final.includes("\n") && !/(?<!\r)\n/u.test(final), true); assert.equal((await stat(f.target)).mode & 0o777, 0o640);
});
test("normal lifecycle, blocked resume, recovery/completion and resolved closure", async (t) => {
  const f = await fixture(t); const created = 'createdAt: "2026-10-06T00:02:00.000Z"';
  for (const [status, flags] of [["confirmed", []], ["in_progress", []], ["blocked", ["--blocked-reason", "Synthetic hold", "--blocked-exit-criteria", "Synthetic resume"]], ["in_progress", []], ["development_complete", ["--summary", "Synthetic recovery", "--evidence", "Synthetic evidence", "--recovered-at", "2026-10-06T00:03:00.000Z", "--resolution-evidence", "Synthetic resolution"]], ["release_ready", []], ["closed", ["--reason", "resolved"]]]) {
    const current = await readFile(f.target, "utf8"); const result = await run(f, flags, { status, source: current }); assert.equal(result.code, 0, result.stdout);
    const final = await readFile(f.target, "utf8"); assert.equal(parseStrictIncident(final, "INC-1.md").status, status); assert.ok(final.includes(created)); assert.equal(final.split("\n---\n")[1], source.split("\n---\n")[1]);
  }
});
test("padded alias keeps existing physical identity/path and ambiguous aliases reject", async (t) => {
  const text = source.replace("id: INC-1", "id: INC-007"); const f = await fixture(t, text, "INC-007.md");
  assert.equal((await run(f, [], { source: text, id: "INC-7" })).code, 0);
  const current = await readFile(f.target, "utf8"); assert.ok(current.includes("id: INC-007\n"));
  await writeFile(path.join(f.directory, "INC-7.md"), current.replace("id: INC-007", "id: INC-7"));
  const result = await run(f, [], { source: current, id: "INC-7", status: "in_progress" }); assert.equal(result.result.code, "duplicate_record_identity"); assert.equal(await readFile(f.target, "utf8"), current);
});
test("missing impact/status cannot fall back to body and duplicate header fields reject without writes", async (t) => {
  for (const key of ["impact", "status"]) {
    const text = source.replace(new RegExp(`^${key}: [^\\n]+\\n`, "mu"), ""); const f = await fixture(t, text);
    const result = await run(f, [], { source: text }); assert.equal(result.result.code, "missing_frontmatter_field"); assert.equal(await readFile(f.target, "utf8"), text);
  }
  const text = source.replace("impact: degraded", "impact: degraded\nimpact: critical"); const f = await fixture(t, text);
  const result = await run(f, [], { source: text }); assert.equal(result.result.code, "ambiguous_frontmatter"); assert.equal(await readFile(f.target, "utf8"), text);
});
test("stale revision rejects and preserves current bytes", async (t) => {
  const f = await fixture(t); const edit = source.replace("Synthetic memo", "External memo"); await writeFile(f.target, edit);
  assert.equal((await run(f)).result.code, "stale_source_revision"); assert.equal(await readFile(f.target, "utf8"), edit);
});
test("valid concurrent edit during temporary sync is detected before rename and preserved", async (t) => {
  const f = await fixture(t); const preload = path.join(f.root, "instrumentation.cjs"); const log = path.join(f.root, "probe.json");
  await writeFile(preload, `const fs=require('node:fs');const {syncBuiltinESMExports}=require('node:module');const original=fs.promises.open;fs.promises.open=async function(p,...args){const handle=await original.call(this,p,...args);if(String(p).startsWith(process.env.SYNTHETIC_TARGET+'.decal-')){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();const current=fs.readFileSync(process.env.SYNTHETIC_TARGET,'utf8');const external=current.replace('status: new','status: in_progress').replace('Synthetic memo','External writer memo');fs.writeFileSync(process.env.SYNTHETIC_TARGET,external);fs.writeFileSync(process.env.SYNTHETIC_LOG,JSON.stringify({external,sha256:require('node:crypto').createHash('sha256').update(external).digest('hex')}));};}return handle;};syncBuiltinESMExports();`);
  const result = await run(f, [], { preload, env: { SYNTHETIC_TARGET: f.target, SYNTHETIC_LOG: log } });
  assert.equal(result.result.code, "stale_source_revision"); const expected = JSON.parse(await readFile(log, "utf8"));
  const final = await readFile(f.target, "utf8"); assert.equal(final, expected.external); assert.equal(digest(final), expected.sha256); assert.equal(parseStrictIncident(final, "INC-1.md").status, "in_progress");
  assert.equal((await readdir(f.directory)).some((name) => name.endsWith(".tmp")), false); assert.equal((await readdir(f.root)).includes(".decal-slice-completion.lock"), false);
});
test("cooperative simultaneous writers serialize and stale loser preserves winner", async (t) => {
  const f = await fixture(t); const results = await Promise.all([run(f), run(f)]);
  assert.deepEqual(results.map((r) => r.code).sort(), [0, 2]); assert.ok(results.some((r) => r.result.code === "stale_source_revision"));
  assert.equal(parseStrictIncident(await readFile(f.target, "utf8"), "INC-1.md").status, "confirmed");
});
test("Native presence, including empty value, fails before creating lock", async (t) => {
  const f = await fixture(t); const result = await run(f, [], { env: { DECAL_SESSION_ID: "" } }); assert.equal(result.result.code, "native_authority_required");
  assert.equal(await readFile(f.target, "utf8"), source); assert.equal((await readdir(f.root)).includes(".decal-slice-completion.lock"), false);
});
test("symlink target rejects without changing outside bytes", async (t) => {
  const f = await fixture(t); const outside = path.join(f.root, "outside.md"); await writeFile(outside, source); await rm(f.target); await symlink(outside, f.target);
  const result = await run(f); assert.equal(result.code, 2); assert.equal(await readFile(outside, "utf8"), source);
});
test("dead-owner lock is preserved and bounded timeout never reclaims it", async (t) => {
  const f = await fixture(t); const lock = path.join(f.root, ".decal-slice-completion.lock"); const bytes = JSON.stringify({ schema: "decal.repository-lock/v1", pid: 2147483647, token: "synthetic-dead-owner" }); await writeFile(lock, bytes);
  const result = await run(f); assert.equal(result.result.code, "repository_lock_timeout"); assert.equal(await readFile(lock, "utf8"), bytes); assert.equal(await readFile(f.target, "utf8"), source);
});
test("duplicate closure alias cannot point to self; missing completion evidence preserves source", async (t) => {
  const incomplete = source.replace("status: new", "status: in_progress"); const f = await fixture(t, incomplete);
  const result = await run(f, [], { source: incomplete, status: "development_complete" }); assert.equal(result.result.code, "completion_evidence_required"); assert.equal(await readFile(f.target, "utf8"), incomplete);
  const ready = source.replace("status: new", "status: release_ready").replace("recoveredAt: null", 'recoveredAt: "2026-10-06T00:03:00.000Z"').replace("resolutionEvidence: []", 'resolutionEvidence:\n  - "Synthetic resolution"').replace("completion: null", 'completion:\n  summary: "Synthetic recovery"\n  evidence:\n    - "Synthetic evidence"'); await writeFile(f.target, ready);
  assert.equal((await run(f, ["--reason", "duplicate", "--duplicate-of", "INC-001"], { source: ready, status: "closed" })).result.code, "duplicate_reference_required"); assert.equal(await readFile(f.target, "utf8"), ready);
  assert.equal((await run(f, ["--reason", "duplicate", "--duplicate-of", "INC-2"], { source: ready, status: "closed" })).code, 0);
});
test("noncanonical root alias fails without creating a lock or changing record", async (t) => {
  const f = await fixture(t); const alias = path.join(f.root, "root-alias"); await symlink(f.root, alias);
  const result = await run({ ...f, root: alias }); assert.equal(result.result.code, "noncanonical_root");
  assert.equal(await readFile(f.target, "utf8"), source); assert.equal((await readdir(f.root)).includes(".decal-slice-completion.lock"), false);
});
test("verifier detects own file drift and pinned dependency drift in a private copy", async (t) => {
  const f = await fixture(t); const contractRoot = path.join(repository, "packs/decal-pack/src/contracts");
  const directory = path.join(f.root, "contracts/zuz-its/v5"); await mkdir(directory, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(contractRoot, "zuz-its/v5/manifest.json"), "utf8"));
  for (const name of [...Object.keys(manifest.files).map((name) => `zuz-its/v5/${name}`), "zuz-its/v5/manifest.json", ...Object.keys(manifest.dependencies)]) {
    const target = path.join(f.root, "contracts", name); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(contractRoot, name), target);
  }
  assert.equal((await verifyContract(directory)).status, "accepted");
  const own = path.join(directory, "incident.mjs"); const ownBytes = await readFile(own); await writeFile(own, Buffer.concat([ownBytes, Buffer.from("\n// synthetic drift\n")]));
  await assert.rejects(verifyContract(directory), { code: "contract_digest_mismatch" }); await writeFile(own, ownBytes);
  await writeFile(path.join(f.root, "contracts/zuz-its/v3/incident.mjs"), "synthetic dependency drift\n");
  await assert.rejects(verifyContract(directory), { code: "contract_dependency_mismatch" });
});
test("mixed CRLF header and LF body preserves raw body bytes and trailing blanks", async (t) => {
  const marker = source.indexOf("\n---\n") + "\n---".length;
  const text = source.slice(0, marker).replaceAll("\n", "\r\n") + source.slice(marker);
  const f = await fixture(t, text); const result = await run(f, [], { source: text }); assert.equal(result.code, 0);
  const final = await readFile(f.target, "utf8"); const finalMarker = final.indexOf("\r\n---") + "\r\n---".length;
  assert.equal(final.slice(finalMarker), text.slice(text.indexOf("\r\n---") + "\r\n---".length));
  for (const line of ["id: INC-1", 'createdAt: "2026-10-06T00:02:00.000Z"', 'x-custom: "preserve me"']) assert.ok(final.includes(line + "\r\n"));
});
test("isolated child umask cannot narrow original 0664 or 0666 permission mode", async (t) => {
  for (const mode of [0o664, 0o666]) {
    const f = await fixture(t); await chmod(f.target, mode); const preload = path.join(f.root, "umask-preload.cjs");
    await writeFile(preload, "process.umask(0o022);\n");
    const result = await run(f, [], { preload }); assert.equal(result.code, 0);
    assert.equal((await stat(f.target)).mode & 0o777, mode); assert.equal(parseStrictIncident(await readFile(f.target, "utf8"), "INC-1.md").status, "confirmed");
  }
});

const moment = "2026-10-06T00:01:00";
function timeline(overrides) {
  let text = source;
  for (const [key, value] of Object.entries(overrides)) text = text.replace(new RegExp(`^${key}:[^\\n]*$`, "mu"), `${key}: ${JSON.stringify(value)}`);
  return text;
}
test("mixed precision reverse rejects and forward accepts in exact raw read", () => {
  const reverse = timeline({mitigatedAt: moment + ".500Z", recoveredAt: moment + "Z"});
  assert.throws(() => parseStrictIncident(reverse, "INC-1.md"), {code: "incident_timestamp_order_invalid"});
  const forward = timeline({mitigatedAt: moment + "Z", recoveredAt: moment + ".5001Z"});
  const record = parseStrictIncident(forward, "INC-1.md");
  assert.equal(record.recoveredAt, moment + ".5001Z"); assert.equal(record.revision, sourceRevision(forward));
});
test("arbitrary precision equal and tiny increasing instants retain original spellings", () => {
  const fraction = "0".repeat(1500) + "1";
  const text = timeline({mitigatedAt: moment + "Z", recoveredAt: moment + "." + fraction + "Z"});
  assert.equal(parseStrictIncident(text).recoveredAt, moment + "." + fraction + "Z");
  const equal = timeline({mitigatedAt: moment + ".5Z", recoveredAt: moment + ".500000Z"});
  assert.equal(parseStrictIncident(equal).mitigatedAt, moment + ".5Z");
  const reverse = timeline({mitigatedAt: moment + "." + fraction + "Z", recoveredAt: moment + "Z"});
  assert.throws(() => parseStrictIncident(reverse), {code: "incident_timestamp_order_invalid"});
});
test("all timeline boundaries use exact instants and valid UTC calendar", () => {
  for (const overrides of [
    {occurredAt: moment + ".1Z", detectedAt: moment + "Z"},
    {detectedAt: moment + ".1Z", mitigatedAt: moment + "Z"},
    {detectedAt: moment + ".1Z", recoveredAt: moment + "Z"},
  ]) assert.throws(() => parseStrictIncident(timeline(overrides)), {code: "incident_timestamp_order_invalid"});
  for (const bad of ["2026-02-30T00:00:00Z", "2026-10-06T24:00:00Z", "2026-10-06T00:00:00+00:00", "2026-10-06T00:00:00.Z"]) {
    assert.throws(() => parseStrictIncident(timeline({occurredAt: bad})), {code: "incident_timestamp_invalid"});
  }
  assert.equal(parseStrictIncident(timeline({occurredAt:"2024-02-29T00:00:00Z"})).occurredAt,"2024-02-29T00:00:00Z");
});
test("created and updated timestamp order is exact without raw source migration", () => {
  assert.throws(() => parseStrictIncident(timeline({createdAt:moment+".1Z",updatedAt:moment+"Z"})), {code:"timestamp_invalid"});
  const text=timeline({createdAt:moment+"Z",updatedAt:moment+".0000001Z"});
  assert.equal(parseStrictIncident(text).revision,sourceRevision(text));
  assert.throws(() => parseStrictIncident(timeline({createdAt:"2026-02-30T00:00:00Z"})), {code:"timestamp_invalid"});
});
for (const [name, mitigation, recovery, accepted] of [
  ["reverse", moment+".500Z", moment+"Z", false],
  ["forward", moment+"Z", moment+".5001Z", true],
]) test(`official v5 transition ${name} physical runtime preserves raw body and fractional precision`, async t => {
  const text=source.replace("status: new","status: in_progress");const f=await fixture(t,text);await chmod(f.target,0o664);
  const result=await run(f,["--mitigated-at",mitigation,"--recovered-at",recovery,"--resolution-evidence","Synthetic evidence","--summary","Synthetic recovery","--evidence","Synthetic evidence"],{status:"development_complete",source:text});
  const after=await readFile(f.target,"utf8");
  if (!accepted) {assert.equal(result.result.code,"incident_timestamp_order_invalid");assert.equal(after,text);}
  else {assert.equal(result.code,0,result.stdout);const record=parseStrictIncident(after);assert.equal(record.mitigatedAt,mitigation);assert.equal(record.recoveredAt,recovery);assert.equal(record.status,"development_complete");assert.equal(after.split("\n---\n")[1],text.split("\n---\n")[1]);}
  assert.equal((await stat(f.target)).mode&0o777,0o664);
});
