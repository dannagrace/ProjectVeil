import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

type Command = "list";
type OutputFormat = "table" | "json";
type Status = "within-window" | "suspect";

interface Args {
  command: Command;
  format: OutputFormat;
  suspectOnly: boolean;
  failOnSuspect: boolean;
  allRepos: boolean;
}

interface ProcessSnapshot {
  pid: number;
  user: string;
  elapsedSeconds: number;
  command: string;
  cwd: string | null;
}

interface WatchRule {
  id: string;
  label: string;
  expectedWindowMinutes: number;
  patterns: RegExp[];
}

interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  headRefName: string;
}

interface RepoContext {
  repoPath: string;
  commonGitDir: string;
  branch: string | null;
  githubRepo: string | null;
}

export interface RunWatchdogEntry {
  pid: number;
  user: string;
  elapsedSeconds: number;
  elapsed: string;
  expectedWindowMinutes: number;
  expectedWindow: string;
  status: Status;
  job: string;
  command: string;
  cwd: string | null;
  repoPath: string | null;
  branch: string | null;
  probableIssue: number | null;
  probablePr: PullRequestInfo | null;
  probableContext: string;
  nextAction: string;
}

export interface RunWatchdogSummary {
  scannedProcesses: number;
  candidateJobs: number;
  suspects: number;
  withinWindow: number;
}

export interface RunWatchdogReport {
  generatedAt: string;
  scope: {
    repoPath: string | null;
    allRepos: boolean;
  };
  entries: RunWatchdogEntry[];
  summary: RunWatchdogSummary;
}

interface BuildReportArgs {
  processes: ProcessSnapshot[];
  repoContextByPid?: Map<number, RepoContext | null>;
  openPrsByRepo?: Map<string, Map<string, PullRequestInfo>>;
  repoCommonDirScope?: string | null;
  allRepos?: boolean;
}

const WATCH_RULES: WatchRule[] = [
  {
    id: "playwright-e2e",
    label: "Playwright validation",
    expectedWindowMinutes: 30,
    patterns: [
      /\bplaywright test\b/i,
      /\bnpm test -- e2e(?::[a-z0-9:-]+)?\b/i
    ]
  },
  {
    id: "reconnect-soak",
    label: "Reconnect soak validation",
    expectedWindowMinutes: 90,
    patterns: [
      /\bnpm run release -- reconnect-soak\b/i,
      /\bstress:rooms:reconnect-soak\b/i,
      /release-candidate-reconnect-soak/i
    ]
  },
  {
    id: "wechat-release-validation",
    label: "WeChat release validation",
    expectedWindowMinutes: 45,
    patterns: [
      /\bnpm run validate -- wechat-rc\b/i,
      /\bnpm run check:wechat-build\b/i,
      /\bnpm run smoke -- wechat-release\b/i,
      /validate-wechat-release-candidate/i
    ]
  },
  {
    id: "release-evidence",
    label: "Release evidence generation",
    expectedWindowMinutes: 60,
    patterns: [
      /\bnpm run release -- (?:phase1|gate|health|runtime|cocos|candidate|same-candidate|readiness)/i,
      /phase1-candidate-rehearsal/i,
      /release-readiness-dashboard/i
    ]
  },
  {
    id: "validation-script",
    label: "Validation script",
    expectedWindowMinutes: 20,
    patterns: [
      /\bnpm run validate -- [a-z0-9:-]+\b/i,
      /\/scripts\/validate-[^ ]+/i,
      /\bnode\b.*\bscripts\/validate-[^ ]+/i
    ]
  },
  {
    id: "repo-doctor",
    label: "Repo inspection",
    expectedWindowMinutes: 15,
    patterns: [
      /\bnpm run doctor\b/i,
      /repo-doctor\.mjs/i,
      /\bnpm run validate -- quickstart\b/i
    ]
  },
  {
    id: "agent-session",
    label: "Codex/Claude validation session",
    expectedWindowMinutes: 120,
    patterns: [
      /\bcodex\b.*\b(validate|validation|test:e2e|playwright|smoke|release:|npm run)\b/i,
      /\bclaude\b.*\b(validate|validation|test:e2e|playwright|smoke|release:|npm run)\b/i
    ]
  }
];

function fail(message: string): never {
  throw new Error(message);
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run ops:run-watchdog -- list");
  console.log("  npm run ops:run-watchdog -- list --suspect-only");
  console.log("  npm run ops:run-watchdog -- list --format json");
  console.log("");
  console.log("Options:");
  console.log("  --suspect-only     show only suspect jobs");
  console.log("  --fail-on-suspect  exit non-zero when any suspect job is found");
  console.log("  --all-repos        inspect candidate jobs across all detected git repos");
  console.log("  --format json      emit structured JSON instead of a table");
}

function parseArgs(argv: string[]): Args {
  const command = argv[2];
  if (!command || command === "help" || command === "--help") {
    printUsage();
    process.exit(0);
  }
  if (command !== "list") {
    fail(`Unknown command: ${command}`);
  }

  let format: OutputFormat = "table";
  let suspectOnly = false;
  let failOnSuspect = false;
  let allRepos = false;

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--suspect-only") {
      suspectOnly = true;
      continue;
    }
    if (arg === "--fail-on-suspect") {
      failOnSuspect = true;
      continue;
    }
    if (arg === "--all-repos") {
      allRepos = true;
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

    fail(`Unknown argument: ${arg}`);
  }

  return {
    command,
    format,
    suspectOnly,
    failOnSuspect,
    allRepos
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

function readProcessSnapshots(): ProcessSnapshot[] {
  const output = runCommand("ps", ["-eo", "pid=,user=,etimes=,args="], true);
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      const pid = Number.parseInt(match[1], 10);
      const elapsedSeconds = Number.parseInt(match[3], 10);
      if (!Number.isFinite(pid) || !Number.isFinite(elapsedSeconds)) {
        return null;
      }
      return {
        pid,
        user: match[2],
        elapsedSeconds,
        command: match[4],
        cwd: readProcessCwd(pid)
      } satisfies ProcessSnapshot;
    })
    .filter((entry): entry is ProcessSnapshot => entry !== null);
}

function readProcessCwd(pid: number): string | null {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

function detectRule(command: string): WatchRule | null {
  for (const rule of WATCH_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(command))) {
      return rule;
    }
  }
  return null;
}

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function truncateCommand(command: string, limit = 120): string {
  if (command.length <= limit) {
    return command;
  }
  return `${command.slice(0, limit - 3)}...`;
}

function resolveAbsolutePath(rawPath: string, cwd: string): string {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
}

function readGitString(cwd: string, args: string[]): string | null {
  const output = runCommand("git", ["-C", cwd, ...args], true);
  return output ? output : null;
}

function normalizeCommonGitDir(repoPath: string, commonGitDir: string | null): string | null {
  if (!commonGitDir) {
    return null;
  }
  return resolveAbsolutePath(commonGitDir, repoPath);
}

function parseGithubRepo(remoteUrl: string | null): string | null {
  if (!remoteUrl) {
    return null;
  }

  const scpMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i);
  if (scpMatch) {
    return scpMatch[1];
  }

  try {
    const parsed = new URL(remoteUrl);
    if (parsed.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    return parsed.pathname.replace(/^\/+/, "").replace(/\.git$/, "") || null;
  } catch {
    return null;
  }
}

function resolveRepoContext(cwd: string | null): RepoContext | null {
  if (!cwd) {
    return null;
  }

  const repoPath = readGitString(cwd, ["rev-parse", "--show-toplevel"]);
  if (!repoPath) {
    return null;
  }
  const branch = readGitString(cwd, ["branch", "--show-current"]);
  const commonGitDir = normalizeCommonGitDir(repoPath, readGitString(cwd, ["rev-parse", "--git-common-dir"]));
  const remoteUrl = readGitString(cwd, ["remote", "get-url", "origin"]);
  return {
    repoPath,
    commonGitDir: commonGitDir ?? path.join(repoPath, ".git"),
    branch,
    githubRepo: parseGithubRepo(remoteUrl)
  };
}

function inferIssueNumber(branch: string | null, command: string): number | null {
  const branchMatch = branch?.match(/(?:^|\/)issue-(\d+)(?:-|$)/i);
  if (branchMatch) {
    return Number.parseInt(branchMatch[1], 10);
  }

  const commandMatch = command.match(/\bissue[-/](\d+)\b/i);
  if (commandMatch) {
    return Number.parseInt(commandMatch[1], 10);
  }

  return null;
}

function readOpenPullRequests(githubRepo: string | null): Map<string, PullRequestInfo> {
  if (!githubRepo) {
    return new Map();
  }
  const output = runCommand(
    "gh",
    ["pr", "list", "--repo", githubRepo, "--state", "open", "--limit", "500", "--json", "number,url,title,headRefName"],
    true
  );
  if (!output) {
    return new Map();
  }

  try {
    const pullRequests = JSON.parse(output) as PullRequestInfo[];
    return new Map(
      pullRequests
        .filter((pullRequest) => typeof pullRequest.headRefName === "string" && pullRequest.headRefName.length > 0)
        .map((pullRequest) => [pullRequest.headRefName, pullRequest])
    );
  } catch {
    return new Map();
  }
}

function buildProbableContext(branch: string | null, issueNumber: number | null, pr: PullRequestInfo | null): string {
  if (pr && issueNumber) {
    return `issue #${issueNumber}, PR #${pr.number}`;
  }
  if (pr) {
    return `PR #${pr.number}`;
  }
  if (issueNumber) {
    return `issue #${issueNumber}`;
  }
  if (branch) {
    return `branch ${branch}`;
  }
  return "manual review";
}

function buildNextAction(status: Status, probableContext: string, cwd: string | null, pr: PullRequestInfo | null): string {
  if (status === "within-window") {
    return "monitor";
  }

  if (!cwd) {
    return "inspect process output before terminating";
  }
  if (pr) {
    return `review ${probableContext}, capture logs, then SIGTERM if idle`;
  }
  return `review ${probableContext}, confirm no recent output, then SIGTERM`;
}

export function buildRunWatchdogReport({
  processes,
  repoContextByPid = new Map<number, RepoContext | null>(),
  openPrsByRepo = new Map<string, Map<string, PullRequestInfo>>(),
  repoCommonDirScope = null,
  allRepos = false
}: BuildReportArgs): RunWatchdogReport {
  const entries: RunWatchdogEntry[] = [];

  for (const processEntry of processes) {
    const rule = detectRule(processEntry.command);
    if (!rule) {
      continue;
    }

    const repoContext = repoContextByPid.get(processEntry.pid) ?? null;
    if (!allRepos && repoCommonDirScope && repoContext?.commonGitDir !== repoCommonDirScope) {
      continue;
    }

    const probableIssue = inferIssueNumber(repoContext?.branch ?? null, processEntry.command);
    const probablePr = repoContext?.githubRepo
      ? (openPrsByRepo.get(repoContext.githubRepo)?.get(repoContext.branch ?? "") ?? null)
      : null;
    const status: Status = processEntry.elapsedSeconds > rule.expectedWindowMinutes * 60 ? "suspect" : "within-window";
    const probableContext = buildProbableContext(repoContext?.branch ?? null, probableIssue, probablePr);

    entries.push({
      pid: processEntry.pid,
      user: processEntry.user,
      elapsedSeconds: processEntry.elapsedSeconds,
      elapsed: formatElapsed(processEntry.elapsedSeconds),
      expectedWindowMinutes: rule.expectedWindowMinutes,
      expectedWindow: `${rule.expectedWindowMinutes}m`,
      status,
      job: rule.label,
      command: truncateCommand(processEntry.command),
      cwd: processEntry.cwd,
      repoPath: repoContext?.repoPath ?? null,
      branch: repoContext?.branch ?? null,
      probableIssue,
      probablePr,
      probableContext,
      nextAction: buildNextAction(status, probableContext, processEntry.cwd, probablePr)
    });
  }

  entries.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "suspect" ? -1 : 1;
    }
    return right.elapsedSeconds - left.elapsedSeconds;
  });

  const summary: RunWatchdogSummary = {
    scannedProcesses: processes.length,
    candidateJobs: entries.length,
    suspects: entries.filter((entry) => entry.status === "suspect").length,
    withinWindow: entries.filter((entry) => entry.status === "within-window").length
  };

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      repoPath: entries[0]?.repoPath ?? null,
      allRepos
    },
    entries,
    summary
  };
}

function renderTable(entries: RunWatchdogEntry[]): void {
  console.table(
    entries.map((entry) => ({
      pid: entry.pid,
      user: entry.user,
      elapsed: entry.elapsed,
      expected: entry.expectedWindow,
      status: entry.status,
      job: entry.job,
      repo: entry.repoPath ?? "-",
      branch: entry.branch ?? "-",
      context: entry.probableContext,
      command: entry.command,
      cwd: entry.cwd ?? "-",
      nextAction: entry.nextAction
    }))
  );
}

function renderJson(report: RunWatchdogReport): void {
  console.log(JSON.stringify(report, null, 2));
}

function printSummary(summary: RunWatchdogSummary): void {
  console.log(
    [
      `Scanned ${summary.scannedProcesses} process(es).`,
      `Candidate validation jobs: ${summary.candidateJobs}.`,
      `Suspect: ${summary.suspects}.`,
      `Within window: ${summary.withinWindow}.`
    ].join(" ")
  );
}

function currentRepoCommonDir(): string | null {
  const repoPath = readGitString(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (!repoPath) {
    return null;
  }
  return normalizeCommonGitDir(repoPath, readGitString(process.cwd(), ["rev-parse", "--git-common-dir"]));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const processes = readProcessSnapshots();
  const repoContextByPid = new Map<number, RepoContext | null>();
  const openPrsByRepo = new Map<string, Map<string, PullRequestInfo>>();

  for (const processEntry of processes) {
    const repoContext = resolveRepoContext(processEntry.cwd);
    repoContextByPid.set(processEntry.pid, repoContext);
    if (repoContext?.githubRepo && !openPrsByRepo.has(repoContext.githubRepo)) {
      openPrsByRepo.set(repoContext.githubRepo, readOpenPullRequests(repoContext.githubRepo));
    }
  }

  const report = buildRunWatchdogReport({
    processes,
    repoContextByPid,
    openPrsByRepo,
    repoCommonDirScope: args.allRepos ? null : currentRepoCommonDir(),
    allRepos: args.allRepos
  });

  const entries = args.suspectOnly ? report.entries.filter((entry) => entry.status === "suspect") : report.entries;
  const filteredReport: RunWatchdogReport = {
    ...report,
    entries,
    scope: {
      repoPath: readGitString(process.cwd(), ["rev-parse", "--show-toplevel"]),
      allRepos: args.allRepos
    },
    summary: {
      ...report.summary,
      candidateJobs: entries.length,
      suspects: entries.filter((entry) => entry.status === "suspect").length,
      withinWindow: entries.filter((entry) => entry.status === "within-window").length
    }
  };

  if (args.format === "json") {
    renderJson(filteredReport);
  } else {
    renderTable(filteredReport.entries);
    printSummary(filteredReport.summary);
  }

  if (args.failOnSuspect && filteredReport.summary.suspects > 0) {
    process.exitCode = 2;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export function detectWatchRule(command: string): {
  id: string;
  label: string;
  expectedWindowMinutes: number;
} | null {
  const rule = detectRule(command);
  if (!rule) {
    return null;
  }
  return {
    id: rule.id,
    label: rule.label,
    expectedWindowMinutes: rule.expectedWindowMinutes
  };
}

export function inferProcessIssueNumber(branch: string | null, command: string): number | null {
  return inferIssueNumber(branch, command);
}
