import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

type Command = "list" | "prune";
type Scope = "local" | "remote";
type Classification = "active" | "safe-to-delete" | "manual-review";
type OutputFormat = "table" | "json";

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

interface OpenPullRequestInfo {
  number: number;
  url: string;
  headRefName: string;
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
  openPr: OpenPullRequestInfo | null;
  classification: Classification;
  nextAction: string;
  reasons: string[];
}

interface BuildReportArgs {
  branches: BranchSnapshot[];
  mergedRefs: Set<string>;
  openPrsByBranch: Map<string, OpenPullRequestInfo>;
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

function fail(message: string): never {
  throw new Error(message);
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run ops:codex-branches -- list");
  console.log("  npm run ops:codex-branches -- list --format json");
  console.log("  npm run ops:codex-branches -- prune");
  console.log("  npm run ops:codex-branches -- prune --apply");
  console.log("  npm run ops:codex-branches -- prune --apply --delete-remote");
  console.log("");
  console.log("Notes:");
  console.log(`- Audits local and origin/${BRANCH_PREFIX}* branches in the current repo only.`);
  console.log(`- Safe prune candidates must be merged into ${DEFAULT_BASE_BRANCH}, have no open PR, and be older than ${DEFAULT_MERGED_RETENTION_DAYS} day(s).`);
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

function runCommand(command: string, args: string[], allowFailure = false): string {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
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

function readCurrentBranch(): string {
  return runCommand("git", ["branch", "--show-current"]);
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
    "number,url,headRefName"
  ]);

  const pullRequests = JSON.parse(output || "[]") as OpenPullRequestInfo[];
  return new Map(
    pullRequests
      .filter((pullRequest) => pullRequest.headRefName.startsWith(BRANCH_PREFIX))
      .map((pullRequest) => [pullRequest.headRefName, pullRequest])
  );
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

export function buildBranchAuditReport({
  branches,
  mergedRefs,
  openPrsByBranch,
  base,
  currentBranch,
  nowMs,
  mergedRetentionDays,
  abandonedReviewDays
}: BuildReportArgs): BranchAuditEntry[] {
  return [...branches]
    .sort((left, right) => left.shortName.localeCompare(right.shortName) || left.scope.localeCompare(right.scope))
    .map((branch) => {
      const updatedMs = new Date(branch.updatedAt).getTime();
      const ageDays = Number.isFinite(updatedMs) ? Math.max(0, Math.floor((nowMs - updatedMs) / 86_400_000)) : -1;
      const merged = mergedRefs.has(branch.refName);
      const openPr = openPrsByBranch.get(branch.shortName) ?? null;
      const reasons: string[] = [];
      let classification: Classification = "active";
      let nextAction = "keep";

      if (branch.shortName === currentBranch) {
        classification = "manual-review";
        nextAction = "checked out locally";
        reasons.push("current branch");
      } else if (openPr) {
        classification = "active";
        nextAction = `keep until PR #${openPr.number} closes`;
        reasons.push(`open PR #${openPr.number}`);
      } else if (merged && ageDays >= mergedRetentionDays) {
        classification = "safe-to-delete";
        nextAction = branch.scope === "remote" ? "eligible for remote prune" : "eligible for local prune";
        reasons.push(`merged into ${base}`);
        reasons.push(`older than ${mergedRetentionDays}d retention`);
      } else if (merged) {
        classification = "active";
        nextAction = `keep until ${mergedRetentionDays}d retention expires`;
        reasons.push(`merged recently (${ageDays}d old)`);
      } else if (ageDays >= abandonedReviewDays) {
        classification = "manual-review";
        nextAction = "review before any deletion";
        reasons.push("stale unmerged branch");
        reasons.push(`older than ${abandonedReviewDays}d review threshold`);
      } else {
        classification = "active";
        nextAction = "keep";
        reasons.push("recent unmerged work");
      }

      if (branch.scope === "local" && branch.upstreamTrack === "[gone]") {
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
        openPr,
        classification,
        nextAction,
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
      openPr: entry.openPr ? `#${entry.openPr.number}` : "-",
      classification: entry.classification,
      nextAction: entry.nextAction
    }))
  );
}

function renderJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function buildSummary(entries: BranchAuditEntry[], pruneCandidates: BranchAuditEntry[]): Record<string, number> {
  return {
    audited: entries.length,
    safeToDelete: pruneCandidates.length,
    manualReview: entries.filter((entry) => entry.classification === "manual-review").length,
    active: entries.filter((entry) => entry.classification === "active").length
  };
}

function printSummary(entries: BranchAuditEntry[], pruneCandidates: BranchAuditEntry[]): void {
  const summary = buildSummary(entries, pruneCandidates);
  console.log(
    [
      `Audited ${summary.audited} codex automation branch ref(s).`,
      `Safe prune candidates: ${summary.safeToDelete}.`,
      `Manual review: ${summary.manualReview}.`,
      `Active/retained: ${summary.active}.`
    ].join(" ")
  );
}

function deleteBranch(entry: BranchAuditEntry): void {
  if (entry.scope === "local") {
    runCommand("git", ["branch", "-D", entry.branch]);
    console.log(`Deleted local branch ${entry.branch}`);
    return;
  }

  runCommand("git", ["push", "origin", "--delete", entry.branch]);
  console.log(`Deleted remote branch origin/${entry.branch}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  ensureBaseBranchExists(args.base);

  const entries = buildBranchAuditReport({
    branches: readBranchSnapshots(),
    mergedRefs: readMergedRefs(args.base),
    openPrsByBranch: readOpenPullRequests(),
    base: args.base,
    currentBranch: readCurrentBranch(),
    nowMs: Date.now(),
    mergedRetentionDays: args.mergedRetentionDays,
    abandonedReviewDays: args.abandonedReviewDays
  });
  const pruneCandidates = selectPruneCandidates(entries, args.deleteRemote);

  if (args.format === "json") {
    renderJson({
      entries: args.command === "prune" ? pruneCandidates : entries,
      summary: buildSummary(entries, pruneCandidates)
    });
  } else if (args.command === "prune") {
    renderTable(pruneCandidates);
  } else {
    renderTable(entries);
  }

  if (args.format !== "json") {
    printSummary(entries, pruneCandidates);
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

  for (const entry of pruneCandidates) {
    deleteBranch(entry);
  }

  console.log(`Pruned ${pruneCandidates.length} branch ref(s).`);
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
