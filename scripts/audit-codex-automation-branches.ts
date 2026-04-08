import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

type Command = "list" | "prune";
type Scope = "local" | "remote";
type Classification = "active" | "safe-to-delete" | "manual-review";
type OutputFormat = "table" | "json";
type PullRequestState = "none" | "open-pr" | "draft-pr";
type HygieneState = "merged" | "open-pr" | "draft-pr" | "orphaned" | "stale" | "active";
type WorktreeState = "merged" | "open-pr" | "draft-pr" | "orphaned" | "dirty" | "active";

interface Args {
  command: Command;
  apply: boolean;
  base: string;
  deleteRemote: boolean;
  format: OutputFormat;
  mergedRetentionDays: number;
  abandonedReviewDays: number;
}

interface BranchSnapshot {
  scope: Scope;
  refName: string;
  shortName: string;
  sha: string;
  updatedAt: string;
  upstream: string | null;
  upstreamTrack: string | null;
}

interface WorktreeSnapshot {
  path: string;
  head: string | null;
  branchRef: string | null;
  lockedReason: string | null;
  prunableReason: string | null;
  isCurrent: boolean;
  dirty: boolean;
}

export interface OpenPullRequestInfo {
  number: number;
  url: string;
  headRefName: string;
  isDraft: boolean;
}

interface BranchWorktreeInfo {
  path: string;
  dirty: boolean;
  isCurrent: boolean;
  locked: boolean;
  lockedReason: string | null;
  prunable: boolean;
  prunableReason: string | null;
}

export interface BranchAuditEntry {
  scope: Scope;
  branch: string;
  refName: string;
  sha: string;
  updatedAt: string;
  ageDays: number;
  upstream: string | null;
  upstreamStatus: string;
  merged: boolean;
  pullRequestState: PullRequestState;
  openPr: OpenPullRequestInfo | null;
  hygieneState: HygieneState;
  classification: Classification;
  nextAction: string;
  reasons: string[];
  worktrees: BranchWorktreeInfo[];
  hasDirtyWorktree: boolean;
}

export interface WorktreeAuditEntry {
  path: string;
  branch: string | null;
  refName: string | null;
  head: string | null;
  isCurrent: boolean;
  dirty: boolean;
  locked: boolean;
  prunable: boolean;
  state: WorktreeState;
  cleanupEligible: boolean;
  reasons: string[];
}

interface BuildReportArgs {
  branches: BranchSnapshot[];
  mergedRefs: Set<string>;
  openPrsByBranch: Map<string, OpenPullRequestInfo>;
  worktrees: WorktreeSnapshot[];
  base: string;
  currentBranch: string;
  nowMs: number;
  mergedRetentionDays: number;
  abandonedReviewDays: number;
}

const BRANCH_PREFIX = "codex/issue-";
const DEFAULT_BASE_BRANCH = "main";
const DEFAULT_MERGED_RETENTION_DAYS = 7;
const DEFAULT_ABANDONED_REVIEW_DAYS = 30;
const WORKTREE_LOCK_DIRNAME = "codex-automation-run.lock";
const WORKTREE_LOCK_METADATA_FILE = "owner.json";
const DEFAULT_LOCK_TIMEOUT_MS = 300_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 100;

function fail(message: string): never {
  throw new Error(message);
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run ops:branch-hygiene -- list");
  console.log("  npm run ops:branch-hygiene -- list --format json");
  console.log("  npm run ops:branch-hygiene -- prune");
  console.log("  npm run ops:branch-hygiene -- prune --apply");
  console.log("  npm run ops:branch-hygiene -- prune --apply --delete-remote");
  console.log("");
  console.log("Notes:");
  console.log(`- Audits local and origin/${BRANCH_PREFIX}* branches plus attached worktrees in the current repo only.`);
  console.log(`- Cleanup candidates must be merged into ${DEFAULT_BASE_BRANCH}, have no open or draft PR, and be older than ${DEFAULT_MERGED_RETENTION_DAYS} day(s).`);
  console.log("- Cleanup refuses to remove local branches when the attached worktree is dirty.");
}

function parsePositiveInteger(rawValue: string, flag: string): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`Invalid ${flag}: ${rawValue}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Args {
  const command = argv[2];
  if (!command || command === "help" || command === "--help") {
    printUsage();
    process.exit(0);
  }
  if (command !== "list" && command !== "prune") {
    fail(`Unknown command: ${command}`);
  }

  let apply = false;
  let base = DEFAULT_BASE_BRANCH;
  let deleteRemote = false;
  let format: OutputFormat = "table";
  let mergedRetentionDays = DEFAULT_MERGED_RETENTION_DAYS;
  let abandonedReviewDays = DEFAULT_ABANDONED_REVIEW_DAYS;

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--delete-remote") {
      deleteRemote = true;
      continue;
    }
    if (arg === "--base" && next) {
      base = next;
      index += 1;
      continue;
    }
    if (arg === "--format" && next) {
      if (next !== "table" && next !== "json") {
        fail(`Unsupported --format value: ${next}`);
      }
      format = next;
      index += 1;
      continue;
    }
    if (arg === "--merged-retention-days" && next) {
      mergedRetentionDays = parsePositiveInteger(next, "--merged-retention-days");
      index += 1;
      continue;
    }
    if (arg === "--abandoned-review-days" && next) {
      abandonedReviewDays = parsePositiveInteger(next, "--abandoned-review-days");
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    command,
    apply,
    base,
    deleteRemote,
    format,
    mergedRetentionDays,
    abandonedReviewDays
  };
}

function runCommand(command: string, args: string[], allowFailure = false, cwd = process.cwd()): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8"
  });

  if (typeof result.status === "number" && result.status === 0) {
    return result.stdout.trim();
  }

  if (!allowFailure) {
    const stderr = result.stderr.trim();
    fail(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : "."}`);
  }

  return result.stdout.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readCurrentBranch(): string {
  return runCommand("git", ["branch", "--show-current"]);
}

function readCurrentWorktreeGitDir(): string {
  return runCommand("git", ["rev-parse", "--absolute-git-dir"]);
}

function ensureBaseBranchExists(base: string): void {
  runCommand("git", ["rev-parse", "--verify", base]);
}

function readBranchSnapshots(): BranchSnapshot[] {
  const format = [
    "%(refname)",
    "%(refname:short)",
    "%(objectname)",
    "%(committerdate:iso-strict)",
    "%(upstream:short)",
    "%(upstream:track)"
  ].join("%09");
  const output = runCommand("git", [
    "for-each-ref",
    `--format=${format}`,
    `refs/heads/${BRANCH_PREFIX}*`,
    `refs/remotes/origin/${BRANCH_PREFIX}*`
  ]);

  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [refName, shortName, sha, updatedAt, upstreamRaw, upstreamTrackRaw] = line.split("\t");
      if (!refName || !shortName || !sha || !updatedAt) {
        fail(`Unexpected git for-each-ref output row: ${line}`);
      }
      const scope: Scope = refName.startsWith("refs/heads/") ? "local" : "remote";
      const branch = scope === "remote" ? shortName.replace(/^origin\//, "") : shortName;
      return {
        scope,
        refName,
        shortName: branch,
        sha,
        updatedAt,
        upstream: upstreamRaw ? upstreamRaw : null,
        upstreamTrack: upstreamTrackRaw ? upstreamTrackRaw : null
      };
    });
}

function readMergedRefs(base: string): Set<string> {
  const output = runCommand("git", [
    "for-each-ref",
    `--merged=${base}`,
    "--format=%(refname)",
    `refs/heads/${BRANCH_PREFIX}*`,
    `refs/remotes/origin/${BRANCH_PREFIX}*`
  ]);
  return new Set(output ? output.split("\n").filter(Boolean) : []);
}

function readOpenPullRequests(): Map<string, OpenPullRequestInfo> {
  const output = runCommand("gh", [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "500",
    "--json",
    "number,url,headRefName,isDraft"
  ]);

  const pullRequests = JSON.parse(output || "[]") as OpenPullRequestInfo[];
  return new Map(
    pullRequests
      .filter((pullRequest) => pullRequest.headRefName.startsWith(BRANCH_PREFIX))
      .map((pullRequest) => [pullRequest.headRefName, pullRequest])
  );
}

function parseWorktreeBlock(block: string): Omit<WorktreeSnapshot, "dirty" | "isCurrent"> {
  let worktreePath: string | null = null;
  let head: string | null = null;
  let branchRef: string | null = null;
  let lockedReason: string | null = null;
  let prunableReason: string | null = null;

  for (const rawLine of block.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice("worktree ".length);
      continue;
    }
    if (line.startsWith("HEAD ")) {
      head = line.slice("HEAD ".length);
      continue;
    }
    if (line.startsWith("branch ")) {
      branchRef = line.slice("branch ".length);
      continue;
    }
    if (line.startsWith("locked")) {
      const reason = line.slice("locked".length).trim();
      lockedReason = reason || "locked";
      continue;
    }
    if (line.startsWith("prunable")) {
      const reason = line.slice("prunable".length).trim();
      prunableReason = reason || "prunable";
    }
  }

  if (!worktreePath) {
    fail(`Unexpected git worktree list --porcelain block:\n${block}`);
  }

  return {
    path: worktreePath,
    head,
    branchRef,
    lockedReason,
    prunableReason
  };
}

function readWorktreeSnapshots(): WorktreeSnapshot[] {
  const output = runCommand("git", ["worktree", "list", "--porcelain"], true);
  if (!output) {
    return [];
  }

  const currentCwd = fs.realpathSync.native(process.cwd());

  return output
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const parsed = parseWorktreeBlock(block);
      const isCurrent = fs.existsSync(parsed.path) && fs.realpathSync.native(parsed.path) === currentCwd;
      let dirty = false;

      if (!parsed.prunableReason && parsed.branchRef?.startsWith(`refs/heads/${BRANCH_PREFIX}`) && fs.existsSync(parsed.path)) {
        dirty = runCommand("git", ["status", "--porcelain"], false, parsed.path).length > 0;
      }

      return {
        ...parsed,
        isCurrent,
        dirty
      };
    })
    .filter((worktree) => worktree.branchRef?.startsWith(`refs/heads/${BRANCH_PREFIX}`) ?? false);
}

function formatUpstreamStatus(branch: BranchSnapshot): string {
  if (branch.scope === "remote") {
    return "n/a";
  }
  if (!branch.upstream) {
    return "untracked";
  }
  return branch.upstreamTrack?.replace(/^\[(.*)\]$/, "$1") ?? "up-to-date";
}

function pullRequestStateFor(openPr: OpenPullRequestInfo | null): PullRequestState {
  if (!openPr) {
    return "none";
  }
  return openPr.isDraft ? "draft-pr" : "open-pr";
}

function isOrphanedBranch(branch: BranchSnapshot, merged: boolean): boolean {
  return branch.scope === "local" && branch.upstreamTrack === "[gone]" && !merged;
}

function describeLocalCleanupTarget(worktrees: BranchWorktreeInfo[]): string {
  if (worktrees.length === 0) {
    return "eligible for local prune";
  }
  return "eligible for worktree + local prune";
}

export function buildBranchAuditReport({
  branches,
  mergedRefs,
  openPrsByBranch,
  worktrees,
  base,
  currentBranch,
  nowMs,
  mergedRetentionDays,
  abandonedReviewDays
}: BuildReportArgs): BranchAuditEntry[] {
  const worktreesByBranch = new Map<string, BranchWorktreeInfo[]>();
  for (const worktree of worktrees) {
    if (!worktree.branchRef) {
      continue;
    }
    const branch = worktree.branchRef.replace(/^refs\/heads\//, "");
    const existing = worktreesByBranch.get(branch) ?? [];
    existing.push({
      path: worktree.path,
      dirty: worktree.dirty,
      isCurrent: worktree.isCurrent,
      locked: Boolean(worktree.lockedReason),
      lockedReason: worktree.lockedReason,
      prunable: Boolean(worktree.prunableReason),
      prunableReason: worktree.prunableReason
    });
    worktreesByBranch.set(branch, existing);
  }

  return [...branches]
    .sort((left, right) => left.shortName.localeCompare(right.shortName) || left.scope.localeCompare(right.scope))
    .map((branch) => {
      const updatedMs = new Date(branch.updatedAt).getTime();
      const ageDays = Number.isFinite(updatedMs) ? Math.max(0, Math.floor((nowMs - updatedMs) / 86_400_000)) : -1;
      const merged = mergedRefs.has(branch.refName);
      const openPr = openPrsByBranch.get(branch.shortName) ?? null;
      const pullRequestState = pullRequestStateFor(openPr);
      const branchWorktrees = branch.scope === "local" ? (worktreesByBranch.get(branch.shortName) ?? []) : [];
      const hasDirtyWorktree = branchWorktrees.some((worktree) => worktree.dirty);
      const hasCurrentWorktree = branchWorktrees.some((worktree) => worktree.isCurrent);
      const reasons: string[] = [];
      let hygieneState: HygieneState = "active";
      let classification: Classification = "active";
      let nextAction = "keep";

      if (pullRequestState === "draft-pr") {
        hygieneState = "draft-pr";
        classification = "active";
        nextAction = `keep until draft PR #${openPr?.number} closes`;
        reasons.push(`draft PR #${openPr?.number}`);
      } else if (pullRequestState === "open-pr") {
        hygieneState = "open-pr";
        classification = "active";
        nextAction = `keep until PR #${openPr?.number} closes`;
        reasons.push(`open PR #${openPr?.number}`);
      } else if (isOrphanedBranch(branch, merged)) {
        hygieneState = "orphaned";
        classification = "manual-review";
        nextAction = "review orphaned branch before any deletion";
        reasons.push("tracked remote branch is gone");
      } else if (merged) {
        hygieneState = "merged";
        reasons.push(`merged into ${base}`);
        if (branch.shortName === currentBranch || hasCurrentWorktree) {
          classification = "manual-review";
          nextAction = "checked out locally";
          reasons.push("current branch");
        } else if (hasDirtyWorktree) {
          classification = "manual-review";
          nextAction = "refuse cleanup until attached worktree is clean";
          reasons.push("attached worktree has uncommitted changes");
        } else if (ageDays >= mergedRetentionDays) {
          classification = "safe-to-delete";
          nextAction = branch.scope === "remote" ? "eligible for remote prune" : describeLocalCleanupTarget(branchWorktrees);
          reasons.push(`older than ${mergedRetentionDays}d retention`);
        } else {
          classification = "active";
          nextAction = `keep until ${mergedRetentionDays}d retention expires`;
          reasons.push(`merged recently (${ageDays}d old)`);
        }
      } else if (ageDays >= abandonedReviewDays) {
        hygieneState = "stale";
        classification = "manual-review";
        nextAction = "review before any deletion";
        reasons.push("stale unmerged branch");
        reasons.push(`older than ${abandonedReviewDays}d review threshold`);
      } else {
        hygieneState = "active";
        classification = "active";
        nextAction = "keep";
        reasons.push("recent unmerged work");
      }

      if (branch.scope === "local" && branch.upstreamTrack === "[gone]" && !reasons.includes("tracked remote branch is gone")) {
        reasons.push("tracked remote branch is gone");
      }

      return {
        scope: branch.scope,
        branch: branch.shortName,
        refName: branch.refName,
        sha: branch.sha,
        updatedAt: branch.updatedAt,
        ageDays,
        upstream: branch.upstream,
        upstreamStatus: formatUpstreamStatus(branch),
        merged,
        pullRequestState,
        openPr,
        hygieneState,
        classification,
        nextAction,
        reasons,
        worktrees: branchWorktrees,
        hasDirtyWorktree
      };
    });
}

export function buildWorktreeAuditReport(worktrees: WorktreeSnapshot[], entries: BranchAuditEntry[]): WorktreeAuditEntry[] {
  const branchesByRef = new Map(entries.map((entry) => [`refs/heads/${entry.branch}`, entry]));

  return [...worktrees]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((worktree) => {
      const branchEntry = worktree.branchRef ? branchesByRef.get(worktree.branchRef) ?? null : null;
      const reasons: string[] = [];
      let state: WorktreeState = "active";
      let cleanupEligible = false;

      if (worktree.prunableReason) {
        state = "orphaned";
        reasons.push(worktree.prunableReason);
      } else if (worktree.dirty) {
        state = "dirty";
        reasons.push("worktree has uncommitted changes");
      } else if (branchEntry?.pullRequestState === "draft-pr") {
        state = "draft-pr";
        reasons.push(`branch has draft PR #${branchEntry.openPr?.number}`);
      } else if (branchEntry?.pullRequestState === "open-pr") {
        state = "open-pr";
        reasons.push(`branch has open PR #${branchEntry.openPr?.number}`);
      } else if (branchEntry?.merged) {
        state = "merged";
        cleanupEligible = branchEntry.classification === "safe-to-delete";
        reasons.push(`branch ${branchEntry.branch} merged`);
      } else {
        state = "active";
        reasons.push("attached to active branch");
      }

      if (worktree.isCurrent) {
        reasons.push("current worktree");
      }
      if (worktree.lockedReason) {
        reasons.push(worktree.lockedReason);
      }

      return {
        path: worktree.path,
        branch: worktree.branchRef ? worktree.branchRef.replace(/^refs\/heads\//, "") : null,
        refName: worktree.branchRef,
        head: worktree.head,
        isCurrent: worktree.isCurrent,
        dirty: worktree.dirty,
        locked: Boolean(worktree.lockedReason),
        prunable: Boolean(worktree.prunableReason),
        state,
        cleanupEligible,
        reasons
      };
    });
}

export function selectPruneCandidates(entries: BranchAuditEntry[], deleteRemote: boolean): BranchAuditEntry[] {
  return entries.filter((entry) => {
    if (entry.classification !== "safe-to-delete") {
      return false;
    }
    if (entry.scope === "remote" && !deleteRemote) {
      return false;
    }
    if (entry.pullRequestState !== "none") {
      return false;
    }
    if (entry.hasDirtyWorktree) {
      return false;
    }
    return true;
  });
}

function renderTable(entries: BranchAuditEntry[]): void {
  console.table(
    entries.map((entry) => ({
      scope: entry.scope,
      branch: entry.branch,
      ageDays: entry.ageDays,
      updatedAt: entry.updatedAt,
      upstream: entry.upstream ?? "-",
      upstreamStatus: entry.upstreamStatus,
      merged: entry.merged ? "yes" : "no",
      pr: entry.openPr ? `${entry.pullRequestState === "draft-pr" ? "draft" : "open"} #${entry.openPr.number}` : "-",
      hygieneState: entry.hygieneState,
      classification: entry.classification,
      worktrees: entry.worktrees.length,
      dirtyWorktree: entry.hasDirtyWorktree ? "yes" : "no",
      nextAction: entry.nextAction
    }))
  );
}

function renderJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function buildSummary(entries: BranchAuditEntry[], pruneCandidates: BranchAuditEntry[], worktrees: WorktreeAuditEntry[]): Record<string, number> {
  return {
    auditedBranches: entries.length,
    auditedWorktrees: worktrees.length,
    cleanupCandidates: pruneCandidates.length,
    merged: entries.filter((entry) => entry.hygieneState === "merged").length,
    openPr: entries.filter((entry) => entry.hygieneState === "open-pr").length,
    draftPr: entries.filter((entry) => entry.hygieneState === "draft-pr").length,
    orphaned: entries.filter((entry) => entry.hygieneState === "orphaned").length,
    manualReview: entries.filter((entry) => entry.classification === "manual-review").length,
    active: entries.filter((entry) => entry.classification === "active").length,
    dirtyWorktrees: worktrees.filter((worktree) => worktree.dirty).length
  };
}

function printSummary(entries: BranchAuditEntry[], pruneCandidates: BranchAuditEntry[], worktrees: WorktreeAuditEntry[]): void {
  const summary = buildSummary(entries, pruneCandidates, worktrees);
  console.log(
    [
      `Audited ${summary.auditedBranches} codex automation branch ref(s) and ${summary.auditedWorktrees} worktree(s).`,
      `Cleanup candidates: ${summary.cleanupCandidates}.`,
      `Merged: ${summary.merged}.`,
      `Open PR: ${summary.openPr}.`,
      `Draft PR: ${summary.draftPr}.`,
      `Orphaned: ${summary.orphaned}.`,
      `Dirty worktrees: ${summary.dirtyWorktrees}.`,
      `Manual review: ${summary.manualReview}.`,
      `Active/retained: ${summary.active}.`
    ].join(" ")
  );
}

function ensureDeletionIsSafe(entry: BranchAuditEntry): void {
  if (entry.pullRequestState !== "none") {
    fail(`Refusing to remove ${entry.branch}: branch still has ${entry.pullRequestState}.`);
  }
  if (entry.hasDirtyWorktree) {
    fail(`Refusing to remove ${entry.branch}: attached worktree has uncommitted changes.`);
  }
}

function deleteBranch(entry: BranchAuditEntry): void {
  ensureDeletionIsSafe(entry);

  if (entry.scope === "local") {
    for (const worktree of entry.worktrees) {
      if (worktree.prunable) {
        continue;
      }
      runCommand("git", ["worktree", "remove", worktree.path]);
      console.log(`Removed worktree ${worktree.path}`);
    }
    runCommand("git", ["branch", "-D", entry.branch]);
    console.log(`Deleted local branch ${entry.branch}`);
    return;
  }

  runCommand("git", ["push", "origin", "--delete", entry.branch]);
  console.log(`Deleted remote branch origin/${entry.branch}`);
}

function buildLockMetadata(lockPath: string): Record<string, unknown> {
  return {
    pid: process.pid,
    cwd: process.cwd(),
    acquiredAt: new Date().toISOString(),
    lockPath,
    argv: process.argv.slice(2)
  };
}

function readLockOwner(lockPath: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(lockPath, WORKTREE_LOCK_METADATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as {
      pid?: number;
      acquiredAt?: string;
      cwd?: string;
      argv?: string[];
    };
    const details = [
      typeof parsed.pid === "number" ? `pid ${parsed.pid}` : null,
      parsed.acquiredAt ? `acquired ${parsed.acquiredAt}` : null,
      parsed.cwd ? `cwd ${parsed.cwd}` : null,
      Array.isArray(parsed.argv) && parsed.argv.length > 0 ? `args ${parsed.argv.join(" ")}` : null
    ].filter(Boolean);
    return details.length > 0 ? details.join(", ") : "metadata unavailable";
  } catch {
    return null;
  }
}

export async function withSerializedWorktreeExecution<T>(
  gitDir: string,
  action: () => Promise<T> | T,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_LOCK_POLL_INTERVAL_MS;
  const lockPath = path.join(gitDir, WORKTREE_LOCK_DIRNAME);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(
        path.join(lockPath, WORKTREE_LOCK_METADATA_FILE),
        `${JSON.stringify(buildLockMetadata(lockPath), null, 2)}\n`,
        "utf8"
      );
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }

      if (Date.now() >= deadline) {
        const owner = readLockOwner(lockPath);
        fail(
          owner
            ? `Another codex automation run is still active for this repository worktree (${owner}).`
            : "Another codex automation run is still active for this repository worktree."
        );
      }

      await sleep(pollIntervalMs);
    }
  }

  try {
    return await action();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  ensureBaseBranchExists(args.base);
  await withSerializedWorktreeExecution(readCurrentWorktreeGitDir(), async () => {
    const branchEntries = buildBranchAuditReport({
      branches: readBranchSnapshots(),
      mergedRefs: readMergedRefs(args.base),
      openPrsByBranch: readOpenPullRequests(),
      worktrees: readWorktreeSnapshots(),
      base: args.base,
      currentBranch: readCurrentBranch(),
      nowMs: Date.now(),
      mergedRetentionDays: args.mergedRetentionDays,
      abandonedReviewDays: args.abandonedReviewDays
    });
    const worktreeEntries = buildWorktreeAuditReport(readWorktreeSnapshots(), branchEntries);
    const pruneCandidates = selectPruneCandidates(branchEntries, args.deleteRemote);

    if (args.format === "json") {
      renderJson({
        generatedAt: new Date().toISOString(),
        repositoryRoot: process.cwd(),
        baseBranch: args.base,
        mode: args.command,
        entries: args.command === "prune" ? pruneCandidates : branchEntries,
        worktrees: worktreeEntries,
        summary: buildSummary(branchEntries, pruneCandidates, worktreeEntries)
      });
    } else if (args.command === "prune") {
      renderTable(pruneCandidates);
    } else {
      renderTable(branchEntries);
    }

    if (args.format !== "json") {
      printSummary(branchEntries, pruneCandidates, worktreeEntries);
    }

    if (args.command !== "prune") {
      return;
    }

    if (!args.apply) {
      console.log("Dry run only. Re-run with --apply to delete the listed safe candidates.");
      if (!args.deleteRemote) {
        console.log("Remote branches are audit-only unless --delete-remote is also set.");
      }
      return;
    }

    runCommand("git", ["worktree", "prune"], true);

    for (const entry of pruneCandidates) {
      deleteBranch(entry);
    }

    console.log(`Pruned ${pruneCandidates.length} branch ref(s).`);
  });
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
