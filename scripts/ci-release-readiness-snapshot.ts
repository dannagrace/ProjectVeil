import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CheckStatus = "passed" | "failed" | "pending" | "not_applicable";
type SnapshotStatus = "passed" | "failed" | "pending" | "partial";

interface Args {
  outputPath?: string;
  validateStatus?: string;
  wechatBuildStatus?: string;
  clientRcSmokeStatus?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

export interface ReleaseReadinessCheck {
  id: string;
  title: string;
  kind: "automated";
  required: boolean;
  status: CheckStatus;
  notes: string;
  evidence: string[];
  source: "ci";
}

export interface CiReleaseReadinessSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  runner: {
    nodeVersion: string;
    platform: string;
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

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let outputPath: string | undefined;
  let validateStatus: string | undefined;
  let wechatBuildStatus: string | undefined;
  let clientRcSmokeStatus: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--validate-status" && next) {
      validateStatus = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-build-status" && next) {
      wechatBuildStatus = next;
      index += 1;
      continue;
    }
    if (arg === "--client-rc-smoke-status" && next) {
      clientRcSmokeStatus = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(outputPath ? { outputPath } : {}),
    ...(validateStatus ? { validateStatus } : {}),
    ...(wechatBuildStatus ? { wechatBuildStatus } : {}),
    ...(clientRcSmokeStatus ? { clientRcSmokeStatus } : {})
  };
}

function readGitValue(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function getRevision(): GitRevision {
  return {
    commit: readGitValue(["rev-parse", "HEAD"]),
    shortCommit: readGitValue(["rev-parse", "--short", "HEAD"]),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--porcelain"]).length > 0
  };
}

export function mapWorkflowResultToCheckStatus(result: string | undefined): CheckStatus {
  switch ((result ?? "").trim()) {
    case "success":
      return "passed";
    case "failure":
    case "cancelled":
    case "timed_out":
    case "action_required":
      return "failed";
    case "skipped":
    case "neutral":
      return "not_applicable";
    case "":
      return "pending";
    default:
      return "pending";
  }
}

function buildCheck(id: string, title: string, result: string | undefined, notes: string, evidence: string[]): ReleaseReadinessCheck {
  return {
    id,
    title,
    kind: "automated",
    required: true,
    status: mapWorkflowResultToCheckStatus(result),
    notes,
    evidence,
    source: "ci"
  };
}

export function buildCiReleaseReadinessSnapshot(args: Args, revision: GitRevision): CiReleaseReadinessSnapshot {
  const checks: ReleaseReadinessCheck[] = [
    buildCheck(
      "validate",
      "Validate job",
      args.validateStatus,
      "Derived from the CI validate job conclusion. This covers the repo typecheck, regression suites, and runtime regression artifact publication bundled in that job.",
      [".github/workflows/ci.yml"]
    ),
    buildCheck(
      "wechat-build-validation",
      "WeChat build validation job",
      args.wechatBuildStatus,
      "Derived from the CI WeChat build validation job conclusion.",
      [".github/workflows/ci.yml"]
    ),
    buildCheck(
      "client-release-candidate-smoke",
      "H5 packaged RC smoke job",
      args.clientRcSmokeStatus,
      "Derived from the CI packaged client release-candidate smoke job conclusion.",
      [".github/workflows/ci.yml"]
    )
  ];

  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const pending = checks.filter((check) => check.status === "pending").length;
  const notApplicable = checks.filter((check) => check.status === "not_applicable").length;
  const requiredFailed = checks.filter((check) => check.required && check.status === "failed").length;
  const requiredPending = checks.filter((check) => check.required && check.status === "pending").length;

  let status: SnapshotStatus = "passed";
  if (requiredFailed > 0) {
    status = "failed";
  } else if (requiredPending > 0) {
    status = passed > 0 ? "partial" : "pending";
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision,
    runner: {
      nodeVersion: process.version,
      platform: process.platform,
      cwd: process.cwd()
    },
    summary: {
      total: checks.length,
      passed,
      failed,
      pending,
      notApplicable,
      requiredFailed,
      requiredPending,
      status
    },
    checks
  };
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function defaultOutputPath(outputPath: string | undefined, shortCommit: string): string {
  if (outputPath) {
    return path.resolve(outputPath);
  }
  return path.resolve("artifacts", "release-readiness", `ci-release-readiness-snapshot-${shortCommit}.json`);
}

function main(): void {
  const args = parseArgs(process.argv);
  const revision = getRevision();
  const snapshot = buildCiReleaseReadinessSnapshot(args, revision);
  const outputPath = defaultOutputPath(args.outputPath, revision.shortCommit);
  writeJsonFile(outputPath, snapshot);
  console.log(`Wrote CI release readiness snapshot: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
