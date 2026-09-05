import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ALLOWED_DEFAULT_BRANCH_REFS = new Map([
  ["refs/remotes/origin/main", "main"],
  ["refs/remotes/origin/master", "master"],
]);

function fail(code, detail = null) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  error.detail = detail;
  throw error;
}

async function git(root, args) {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return String(result.stdout).trim();
}

async function optionalGit(root, args) {
  try {
    return await git(root, args);
  } catch (error) {
    if (error?.code === 1) return null;
    throw error;
  }
}

async function refExists(root, reference) {
  return await optionalGit(root, ["show-ref", "--verify", "--quiet", reference]) !== null;
}

export async function resolveCanonicalDefaultBranch(root) {
  const headReference = await optionalGit(root, ["symbolic-ref", "--quiet", "HEAD"]);
  if (!headReference?.startsWith("refs/heads/")) fail("main_branch_required", "detached");
  const current = headReference.slice("refs/heads/".length);

  const originHead = await optionalGit(root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  let canonical = null;
  let source = null;
  if (originHead !== null) {
    if (!ALLOWED_DEFAULT_BRANCH_REFS.has(originHead)) fail("main_branch_required", "unsupported_origin_head");
    canonical = ALLOWED_DEFAULT_BRANCH_REFS.get(originHead);
    source = "origin/HEAD";
    if (!await refExists(root, originHead) || !await refExists(root, `refs/heads/${canonical}`)) {
      fail("main_branch_required", "dangling_origin_head");
    }
  } else {
    if (await refExists(root, "refs/remotes/origin/HEAD")) fail("main_branch_required", "non_symbolic_origin_head");
    const localCandidates = [];
    for (const candidate of ["main", "master"]) {
      if (await refExists(root, `refs/heads/${candidate}`)) localCandidates.push(candidate);
    }
    if (localCandidates.length === 0) fail("main_branch_required", "canonical_default_branch_missing");
    if (localCandidates.length !== 1) fail("main_branch_required", "canonical_default_branch_ambiguous");
    [canonical] = localCandidates;
    source = "unique-local-candidate";
  }

  if (current !== canonical) {
    fail("main_branch_required", `${current}->${canonical}:${source}`);
  }
  return { current, canonical, source };
}
