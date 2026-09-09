import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
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
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(result.stdout);
}

async function optionalGit(root, args) {
  try {
    return (await git(root, args)).trim();
  } catch (error) {
    if (error?.code === 1) return null;
    throw error;
  }
}

async function refExists(root, reference) {
  return await optionalGit(root, ["show-ref", "--verify", "--quiet", reference]) !== null;
}

async function canonicalDefaultBranch(root) {
  const originHead = await optionalGit(root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (originHead !== null) {
    if (!ALLOWED_DEFAULT_BRANCH_REFS.has(originHead)) fail("main_branch_required", "unsupported_origin_head");
    const canonical = ALLOWED_DEFAULT_BRANCH_REFS.get(originHead);
    if (!await refExists(root, originHead) || !await refExists(root, `refs/heads/${canonical}`)) {
      fail("main_branch_required", "dangling_origin_head");
    }
    return { canonical, source: "origin/HEAD" };
  }
  if (await refExists(root, "refs/remotes/origin/HEAD")) fail("main_branch_required", "non_symbolic_origin_head");
  const candidates = [];
  for (const candidate of ["main", "master"]) {
    if (await refExists(root, `refs/heads/${candidate}`)) candidates.push(candidate);
  }
  if (candidates.length === 0) fail("main_branch_required", "canonical_default_branch_missing");
  if (candidates.length !== 1) fail("main_branch_required", "canonical_default_branch_ambiguous");
  return { canonical: candidates[0], source: "unique-local-candidate" };
}

function parseWorktrees(raw) {
  return raw.split("\0\0").filter(Boolean).map((record) => {
    const fields = record.split("\0").filter(Boolean);
    const worktree = fields.find((field) => field.startsWith("worktree "))?.slice("worktree ".length);
    const branch = fields.find((field) => field.startsWith("branch "))?.slice("branch ".length) ?? null;
    return { worktree, branch };
  }).filter(({ worktree }) => typeof worktree === "string" && worktree.length > 0);
}

async function repositoryIdentity(root) {
  const topLevel = await realpath((await git(root, ["rev-parse", "--show-toplevel"])).trim());
  if (topLevel !== await realpath(root)) fail("invalid_repository_root");
  const common = (await git(root, ["rev-parse", "--git-common-dir"])).trim();
  return { topLevel, commonDirectory: await realpath(path.resolve(root, common)) };
}

export async function resolveMainAuthorityRoot(requestedRoot) {
  const requested = await repositoryIdentity(path.resolve(requestedRoot));
  const { canonical, source } = await canonicalDefaultBranch(requested.topLevel);
  const current = await optionalGit(requested.topLevel, ["symbolic-ref", "--quiet", "HEAD"]);
  if (current === `refs/heads/${canonical}`) {
    return {
      requestedRoot: requested.topLevel,
      authorityRoot: requested.topLevel,
      canonicalBranch: canonical,
      source,
      delegated: false,
    };
  }

  const worktrees = parseWorktrees(await git(requested.topLevel, ["worktree", "list", "--porcelain", "-z"]));
  const candidates = worktrees.filter(({ branch }) => branch === `refs/heads/${canonical}`);
  if (candidates.length === 0) fail("main_worktree_required", canonical);
  if (candidates.length !== 1) fail("main_worktree_ambiguous", canonical);

  const authority = await repositoryIdentity(candidates[0].worktree);
  if (authority.commonDirectory !== requested.commonDirectory) fail("main_worktree_repository_mismatch");
  const authorityHead = await optionalGit(authority.topLevel, ["symbolic-ref", "--quiet", "HEAD"]);
  if (authorityHead !== `refs/heads/${canonical}`) fail("main_worktree_changed", canonical);

  return {
    requestedRoot: requested.topLevel,
    authorityRoot: authority.topLevel,
    canonicalBranch: canonical,
    source,
    delegated: true,
  };
}

export function authorityReceipt(authority) {
  return {
    requestedRoot: authority.requestedRoot,
    authorityRoot: authority.authorityRoot,
    canonicalBranch: authority.canonicalBranch,
    delegated: authority.delegated,
    callerWorktreePreserved: true,
  };
}
