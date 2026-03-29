import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type CheckStatus = "passed" | "failed" | "pending" | "not_applicable";
type SnapshotStatus = "passed" | "failed" | "pending" | "partial";
type CheckKind = "automated" | "manual";

interface Args {
  outputPath?: string;
  manualChecksPath?: string;
  manualChecks: string[];
  noRun: boolean;
}

interface ReleaseReadinessCheck {
  id: string;
  title: string;
  kind: CheckKind;
  required: boolean;
  status: CheckStatus;
  command?: string;
  exitCode?: number | null;
  durationMs?: number;
  notes: string;
  evidence: string[];
  source: "default" | "file" | "cli";
  startedAt?: string;
  finishedAt?: string;
  stdoutTail?: string;
  stderrTail?: string;
}

interface ManualCheckInput {
  id: string;
  title: string;
  status?: CheckStatus;
  required?: boolean;
  notes?: string;
  evidence?: string[];
}

interface ReleaseReadinessSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  revision: {
    commit: string;
    shortCommit: string;
    branch: string;
    dirty: boolean;
  };
  runner: {
    nodeVersion: string;
    platform: string;
    hostname: string;
    cwd: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    notApplicable: number;
    requiredFailed: number;
    requiredPending: number;
    status: SnapshotStatus;
  };
  checks: ReleaseReadinessCheck[];
}

const DEFAULT_OUTPUT_DIR = path.join("artifacts", "release-readiness");
const OUTPUT_TAIL_BYTES = 4000;

const AUTOMATED_CHECKS: Array<Pick<ReleaseReadinessCheck, "id" | "title" | "command" | "required">> = [
  {
    id: "npm-test",
    title: "Unit and integration regression",
    command: "npm test",
    required: true
  },
  {
    id: "typecheck-ci",
    title: "TypeScript CI typecheck",
    command: "npm run typecheck:ci",
    required: true
  },
  {
    id: "e2e-smoke",
    title: "H5 smoke suite",
    command: "npm run test:e2e:smoke",
    required: true
  },
  {
    id: "e2e-multiplayer-smoke",
    title: "Multiplayer smoke suite",
    command: "npm run test:e2e:multiplayer:smoke",
    required: true
  },
  {
    id: "sync-governance-matrix",
    title: "Deterministic sync-governance matrix",
    command: "npm run test:sync-governance:matrix -- --output artifacts/release-readiness/sync-governance-matrix.json",
    required: true
  },
  {
    id: "wechat-build-check",
    title: "Cocos asset and WeChat build readiness",
    command: "npm run check:cocos-release-readiness",
    required: true
  }
];

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let outputPath: string | undefined;
  let manualChecksPath: string | undefined;
  const manualChecks: string[] = [];
  let noRun = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--manual-checks" && next) {
      manualChecksPath = next;
      index += 1;
      continue;
    }
    if (arg === "--manual-check" && next) {
      manualChecks.push(next);
      index += 1;
      continue;
    }
    if (arg === "--no-run") {
      noRun = true;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(outputPath ? { outputPath } : {}),
    ...(manualChecksPath ? { manualChecksPath } : {}),
    manualChecks,
    noRun
  };
}

function sanitizeStatus(value: unknown, context: string): CheckStatus {
  if (value === undefined) {
    return "pending";
  }
  if (value === "passed" || value === "failed" || value === "pending" || value === "not_applicable") {
    return value;
  }
  fail(`Unsupported check status for ${context}: ${String(value)}`);
}

function normalizeManualCheck(entry: ManualCheckInput, source: "file" | "cli"): ReleaseReadinessCheck {
  const id = entry.id?.trim();
  const title = entry.title?.trim();
  if (!id) {
    fail(`Manual check from ${source} is missing id.`);
  }
  if (!title) {
    fail(`Manual check ${id} from ${source} is missing title.`);
  }

  return {
    id,
    title,
    kind: "manual",
    required: entry.required ?? true,
    status: sanitizeStatus(entry.status, id),
    notes: entry.notes?.trim() ?? "",
    evidence: Array.isArray(entry.evidence)
      ? entry.evidence.map((value) => String(value).trim()).filter((value) => value.length > 0)
      : [],
    source
  };
}

function parseManualCheckArg(value: string): ReleaseReadinessCheck {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    fail(`Manual check must use "<id>:<title>" format, received: ${value}`);
  }

  return normalizeManualCheck(
    {
      id: value.slice(0, separatorIndex),
      title: value.slice(separatorIndex + 1)
    },
    "cli"
  );
}

function parseManualChecksFile(filePath: string): ReleaseReadinessCheck[] {
  const resolvedPath = path.resolve(filePath);
  const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as ManualCheckInput[] | { checks?: ManualCheckInput[] };
  const entries = Array.isArray(raw) ? raw : raw.checks;
  if (!Array.isArray(entries)) {
    fail(`Manual check file must be an array or an object with a "checks" array: ${resolvedPath}`);
  }
  return entries.map((entry) => normalizeManualCheck(entry, "file"));
}

function ensureUniqueIds(checks: ReleaseReadinessCheck[]): void {
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.id)) {
      fail(`Duplicate check id detected: ${check.id}`);
    }
    seen.add(check.id);
  }
}

function getOutputPath(outputPath?: string): string {
  if (outputPath) {
    return path.resolve(outputPath);
  }
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  return path.resolve(DEFAULT_OUTPUT_DIR, `release-readiness-${timestamp}.json`);
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runCommand(command: string): SpawnSyncReturns<string> {
  return spawnSync(command, {
    shell: true,
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
}

function tailText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > OUTPUT_TAIL_BYTES ? normalized.slice(-OUTPUT_TAIL_BYTES) : normalized;
}

function buildAutomatedCheckStatus(definition: Pick<ReleaseReadinessCheck, "id" | "title" | "command" | "required">, noRun: boolean): ReleaseReadinessCheck {
  if (noRun) {
    return {
      id: definition.id,
      title: definition.title,
      kind: "automated",
      required: definition.required,
      status: "pending",
      command: definition.command,
      notes: "Skipped command execution via --no-run.",
      evidence: [],
      source: "default"
    };
  }

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const startedMs = Date.now();
  const result = runCommand(definition.command ?? "");
  const finishedAtIso = new Date().toISOString();
  const durationMs = Date.now() - startedMs;

  if (result.error) {
    return {
      id: definition.id,
      title: definition.title,
      kind: "automated",
      required: definition.required,
      status: "failed",
      command: definition.command,
      exitCode: result.status,
      durationMs,
      notes: result.error.message,
      evidence: [],
      source: "default",
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      ...(tailText(result.stdout) ? { stdoutTail: tailText(result.stdout) } : {}),
      ...(tailText(result.stderr) ? { stderrTail: tailText(result.stderr) } : {})
    };
  }

  return {
    id: definition.id,
    title: definition.title,
    kind: "automated",
    required: definition.required,
    status: result.status === 0 ? "passed" : "failed",
    command: definition.command,
    exitCode: result.status,
    durationMs,
    notes: result.status === 0 ? "" : `Command exited with code ${result.status}.`,
    evidence: [],
    source: "default",
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    ...(tailText(result.stdout) ? { stdoutTail: tailText(result.stdout) } : {}),
    ...(tailText(result.stderr) ? { stderrTail: tailText(result.stderr) } : {})
  };
}

function getGitValue(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function isGitDirty(): boolean {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`git status --porcelain failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim().length > 0;
}

function computeSnapshotStatus(checks: ReleaseReadinessCheck[]): SnapshotStatus {
  const requiredFailed = checks.some((check) => check.required && check.status === "failed");
  if (requiredFailed) {
    return "failed";
  }

  const requiredPending = checks.some((check) => check.required && check.status === "pending");
  if (requiredPending) {
    return "pending";
  }

  const hasAnyFailed = checks.some((check) => check.status === "failed");
  const hasAnyPending = checks.some((check) => check.status === "pending");
  if (hasAnyFailed || hasAnyPending) {
    return "partial";
  }

  return "passed";
}

function buildSummary(checks: ReleaseReadinessCheck[]): ReleaseReadinessSnapshot["summary"] {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
    pending: checks.filter((check) => check.status === "pending").length,
    notApplicable: checks.filter((check) => check.status === "not_applicable").length,
    requiredFailed: checks.filter((check) => check.required && check.status === "failed").length,
    requiredPending: checks.filter((check) => check.required && check.status === "pending").length,
    status: computeSnapshotStatus(checks)
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const outputPath = getOutputPath(args.outputPath);
  const manualChecksFromFile = args.manualChecksPath ? parseManualChecksFile(args.manualChecksPath) : [];
  const manualChecksFromCli = args.manualChecks.map((value) => parseManualCheckArg(value));
  const automatedChecks = AUTOMATED_CHECKS.map((definition) => buildAutomatedCheckStatus(definition, args.noRun));
  const checks = [...automatedChecks, ...manualChecksFromFile, ...manualChecksFromCli];
  ensureUniqueIds(checks);

  const snapshot: ReleaseReadinessSnapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision: {
      commit: getGitValue(["rev-parse", "HEAD"]),
      shortCommit: getGitValue(["rev-parse", "--short", "HEAD"]),
      branch: getGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
      dirty: isGitDirty()
    },
    runner: {
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.release()} (${os.arch()})`,
      hostname: os.hostname(),
      cwd: process.cwd()
    },
    summary: buildSummary(checks),
    checks
  };

  writeJsonFile(outputPath, snapshot);

  console.log(`Wrote release-readiness snapshot: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
  console.log(`  Commit: ${snapshot.revision.shortCommit} (${snapshot.revision.branch})`);
  console.log(`  Overall status: ${snapshot.summary.status}`);
  console.log(
    `  Checks: ${snapshot.summary.passed} passed / ${snapshot.summary.failed} failed / ${snapshot.summary.pending} pending / ${snapshot.summary.notApplicable} n/a`
  );
}

main();
