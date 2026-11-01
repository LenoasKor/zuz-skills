#!/usr/bin/env node
// Stable entry for zuz ITS registration. Skills and agents call this file, never a numbered contract.
//   node contracts/task-work-bug/its-register.mjs --kind task|ticket --root . --intent FILE --dry-run
//   node contracts/task-work-bug/its-register.mjs --kind task|ticket --root . --intent FILE --approved-digest DIGEST --write
// The entry looks up the capability in capabilities.json, verifies that contract's own manifest, and only then runs it.
// A project paired with a number authority on the local network is always routed to the authority; if that route is
// unavailable the entry stops instead of registering locally, because a local number could collide with another device.
// A project that is not paired but whose authority answers on the local network from another device is stopped too
// (`pairing_required`): the device must pair first, otherwise it would silently issue a colliding number.
// An approved pairing that waits for local confirmation is not a pairing: it is stopped the same way and is never used.
// A project that declares which version impacts its build can read has a Task outside them refused (`unreadable_task_version_impact`).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RESULT_SCHEMA = "decal.task-work-bug.its-register/v1";
const TABLE_SCHEMA = "decal.task-work-bug.capabilities/v1";
const here = realpathSync(path.dirname(fileURLToPath(import.meta.url)));

function stop(code, extra = {}) {
  process.stdout.write(`${JSON.stringify({ schema: RESULT_SCHEMA, status: "rejected", code, ...extra })}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || parsed.has(key)) stop("usage_error");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) parsed.set(key, true);
    else { parsed.set(key, value); index += 1; }
  }
  return parsed;
}

function plainFile(file, limit) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) stop("unsafe_contract_path");
  return readFileSync(file, "utf8");
}

function loadTable() {
  let table;
  try { table = JSON.parse(plainFile(path.join(here, "capabilities.json"), 65536)); } catch { return stop("capability_table_unavailable"); }
  if (table?.schema !== TABLE_SCHEMA || !table.capabilities || typeof table.capabilities !== "object") stop("invalid_capability_table");
  for (const [name, item] of Object.entries(table.capabilities)) {
    if (!/^[a-z][a-z0-9-]*$/u.test(name) || !/^v[0-9]{1,3}$/u.test(item?.contract ?? "") || !/^[a-z0-9][a-z0-9-]*\.mjs$/u.test(item?.entry ?? "")) {
      stop("invalid_capability_table", { capability: name });
    }
  }
  for (const item of Object.values(table.capabilities)) {
    if (item.platformContracts !== undefined) {
      if (!item.platformContracts || typeof item.platformContracts !== "object" || Array.isArray(item.platformContracts)
          || Object.entries(item.platformContracts).some(([platform, contract]) => !["win32", "darwin", "linux"].includes(platform) || !/^v[0-9]{1,3}$/u.test(contract))) stop("invalid_capability_table");
      item.contract = item.platformContracts[process.platform] ?? item.contract;
    }
  }
  return table.capabilities;
}

/** Returns the script of a listed capability after its contract verified; never anything that is not listed. */
function resolve(table, capability, code = "authoring_update_required") {
  const item = Object.hasOwn(table, capability) ? table[capability] : null;
  if (!item) return stop(code, { capability, reason: "capability_not_advertised" });
  const directory = path.join(here, item.contract);
  const verifier = path.join(directory, "verify-contract.mjs");
  const script = path.join(directory, item.entry);
  let real;
  try { real = realpathSync(script); realpathSync(verifier); } catch { return stop(code, { capability, contract: item.contract, reason: "contract_not_installed" }); }
  if (!real.startsWith(`${here}${path.sep}`)) stop(code, { capability, contract: item.contract, reason: "unsafe_contract_path" });
  const check = spawnSync(process.execPath, [verifier], { encoding: "utf8" });
  let verdict = null;
  try { verdict = JSON.parse(String(check.stdout).trim().split("\n").pop()); } catch { /* reported below */ }
  if (verdict?.status !== "accepted") {
    return stop(code, { capability, contract: item.contract, reason: verdict?.code ?? "contract_verification_failed" });
  }
  return real;
}

const args = parseArgs(process.argv.slice(2));
const kind = args.get("--kind");
const intentFile = args.get("--intent");
const dryRun = args.has("--dry-run");
const write = args.has("--write");
if (!["task", "ticket"].includes(kind) || typeof intentFile !== "string" || dryRun === write) stop("usage_error");
const root = path.resolve(String(args.get("--root") || "."));

let intent;
try { intent = JSON.parse(readFileSync(path.resolve(intentFile), "utf8")); } catch { stop("invalid_intent"); }

// Hosts that ship the reading-context contract get its body check; others simply skip it.
const contextModule = path.join(here, "..", "its-reading-context", "v1", "context.mjs");
if (existsSync(contextModule)) {
  try {
    const { requireContext } = await import(pathToFileURL(contextModule).href);
    for (const item of kind === "task" ? intent.tasks ?? [] : [intent]) requireContext(item.body);
  } catch (error) { stop(error?.message || "invalid_context"); }
}

const capability = kind === "task" ? "register-task-batch" : intent.kind === "incident" ? "register-incident" : "register-ticket";
const table = loadTable();
const broker = resolve(table, capability);
// Before any route is chosen, so a paired project's Task is checked too. Only Tasks carry these values, and an older table does not know the check.
if (kind === "task" && Object.hasOwn(table, "check-task-version-policy")) {
  const { checkTaskVersionPolicy } = await import(pathToFileURL(resolve(table, "check-task-version-policy")).href);
  const outcome = await checkTaskVersionPolicy(root, intent);
  if (outcome.status !== "accepted") {
    const { status: _status, code, ...detail } = outcome;
    stop(code, detail);
  }
}
// lstat, not exists: a link to nothing still counts as paired here, so the client refuses it instead of a local number being issued.
const paired = lstatSync(path.join(root, ".decal", "its-lan-client.json"), { throwIfNoEntry: false }) !== undefined;

/** A pairing the authority approved but this device has not confirmed yet. It proves an authority was just seen, and nothing else. */
function pendingPairing(projectRoot) {
  try {
    const file = path.join(projectRoot, ".decal", "its-lan-client.pending.json");
    const value = JSON.parse(plainFile(file, 65536));
    return Date.parse(value.expiresAt) > Date.now() ? value : null;
  } catch { return null; }
}
const clientPath = Object.hasOwn(table, "register-via-authority") ? `contracts/task-work-bug/${table["register-via-authority"].contract}/lan-client.mjs` : "lan-client.mjs";

if (write && paired) {
  const digest = args.get("--approved-digest");
  if (typeof digest !== "string") stop("usage_error", { reason: "approved_digest_required" });
  // resolve() ends the process on failure, so a client that is missing or fails verification never falls back to a local number.
  const client = resolve(table, "register-via-authority", "authority_client_unavailable");
  const delegated = spawnSync(process.execPath, [client, "register", "--root", root, "--intent", path.resolve(intentFile), "--approved-digest", digest], { encoding: "utf8" });
  const line = String(delegated.stdout ?? "").trim().split("\n").pop();
  let outcome = null;
  try { outcome = JSON.parse(line); } catch { /* reported below */ }
  if (outcome?.status === "registered" && outcome.receipt) {
    process.stdout.write(`${JSON.stringify({ ...outcome.receipt, delegatedTo: "its-authority", sync: outcome.sync, ...(outcome.migrated ? { migrated: true, migrationNote: outcome.migrationNote } : {}) })}\n`);
  } else {
    process.stdout.write(`${line || JSON.stringify({ schema: RESULT_SCHEMA, status: "rejected", code: "authority_delegation_failed" })}\n`);
  }
  process.exit(delegated.status ?? 1);
}

/** True when another device on the local network is the number authority for this project and this device is not paired with it. */
async function authorityElsewhere(projectRoot) {
  if (!Object.hasOwn(table, "detect-authority")) return null; // an older capability table does not know the guard
  const detector = resolve(table, "detect-authority");
  const roots = spawnSync("git", ["-C", projectRoot, "rev-list", "--max-parents=0", "HEAD"], { encoding: "utf8" });
  const commits = String(roots.stdout ?? "").split("\n").filter(Boolean).sort();
  if (roots.status !== 0 || commits.length === 0) return null;
  const projectId = createHash("sha256").update(commits.join(",")).digest("hex").slice(0, 32);
  const { discoverAuthority } = await import(pathToFileURL(detector).href);
  // This device's own addresses; DECAL_ITS_OWN_ADDRESSES (comma separated) replaces them for VPNs, containers and tests.
  const override = String(process.env.DECAL_ITS_OWN_ADDRESSES ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const own = new Set(override.length > 0 ? override : ["127.0.0.1", "::1"]);
  if (override.length === 0) for (const addresses of Object.values(os.networkInterfaces())) for (const item of addresses ?? []) own.add(item.address);
  const answers = await discoverAuthority(projectId, { timeoutMs: 700 });
  return answers.find((answer) => !own.has(answer.address)) ?? null;
}

if (write && !paired) {
  const waiting = pendingPairing(root);
  if (waiting) {
    stop("pairing_required", {
      reason: "pairing_awaiting_local_confirmation",
      authority: { label: waiting.authorityLabel, address: waiting.host },
      next: `Ask the user whether the main device showed an approval card with the check code, then run ${clientPath} pair-confirm --sas CODE with the code the user reports, or pair-cancel if no card appeared or the code differs. Nothing was registered.`,
    });
  }
  const other = await authorityElsewhere(root);
  if (other) {
    stop("pairing_required", {
      reason: "an_authority_for_this_project_is_on_the_local_network",
      authority: { label: other.label, address: other.address },
      next: `Pair this device first (${clientPath} pair), approve it on the main device, then run pair-confirm --sas CODE with the code the user saw on the main device's approval card. Nothing was registered.`,
    });
  }
}

const forwarded = [];
for (const [key, value] of args) {
  if (key === "--kind") continue;
  forwarded.push(key);
  if (value !== true) forwarded.push(String(value));
}
const result = spawnSync(process.execPath, [broker, ...forwarded], { stdio: "inherit" });
process.exit(result.status ?? 1);
