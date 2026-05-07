import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

type CaseStatus = "passed" | "failed" | "skipped";
type ExecutionStatus = "passed" | "failed";

interface Args {
  outputPath?: string;
  clientArtifactDir?: string;
}

interface PlaywrightJsonReport {
  stats?: {
    expected?: number;
    skipped?: number;
    unexpected?: number;
    flaky?: number;
    duration?: number;
  };
  suites?: PlaywrightSuite[];
}

interface PlaywrightSuite {
  title?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightSpec {
  title?: string;
  ok?: boolean;
  tests?: PlaywrightTest[];
}

interface PlaywrightTest {
  projectName?: string;
  results?: Array<{
    status?: string;
    duration?: number;
  }>;
}

interface CollectedTestCase {
  id: string;
  title: string;
  projectName: string;
  status: CaseStatus;
  durationMs: number;
}

interface ReleaseCandidateClientArtifactSmokeReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: {
    commit: string;
    shortCommit: string;
    branch: string;
    dirty: boolean;
  };
  artifact: {
    kind: "apps/client/dist";
    path: string;
    buildCommand: string;
    smokeCommand: string;
  };
  execution: {
    status: ExecutionStatus;
    exitCode: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    stdoutTail?: string;
    stderrTail?: string;
    rawPlaywrightReportPath: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
  };
  cases: CollectedTestCase[];
}

const BUILD_COMMAND = "npm run build:client:h5";
const FIXTURE_COMMAND = "npm run validate -- e2e:fixtures";
const PLAYWRIGHT_COMMAND = "npx playwright test --project=release-candidate-artifact-smoke --reporter=json";
const OUTPUT_TAIL_BYTES = 4000;
const DEFAULT_SERVER_HOST = "127.0.0.1";
const DEFAULT_CLIENT_HOST = "127.0.0.1";
const DEFAULT_SERVER_PORT = 2567;
const DEFAULT_CLIENT_PORT = 4173;
const REQUIRED_CASE_TITLES = [
  "rc-artifact: guest login reaches lobby and room boot",
  "rc-artifact: cached session restore reaches room boot"
] as const;
const BUILD_RUNTIME_ENV_KEYS = ["VITE_VEIL_SERVER_HTTP_URL", "VITE_VEIL_SERVER_WS_URL"] as const;
const SMOKE_RUNTIME_ENV_KEYS = [
  "VEIL_PLAYWRIGHT_CLIENT_MODE",
  "VEIL_PLAYWRIGHT_SERVER_PORT",
  "VEIL_PLAYWRIGHT_CLIENT_PORT",
  "VEIL_PLAYWRIGHT_SERVER_ORIGIN",
  "VEIL_PLAYWRIGHT_SERVER_WS_URL"
] as const;

type EnvOverrides = Record<string, string>;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let outputPath: string | undefined;
  let clientArtifactDir: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--client-artifact-dir" && next) {
      clientArtifactDir = next;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(outputPath ? { outputPath } : {}),
    ...(clientArtifactDir ? { clientArtifactDir } : {})
  };
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

function readPort(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function derivePort(base: number, span = 300): number {
  const seed =
    process.env.VEIL_PLAYWRIGHT_WORKSPACE_SEED?.trim() ||
    `${process.cwd()}:${process.pid}:release-candidate-client-artifact-smoke`;
  const hash = createHash("sha1").update(seed).digest();
  const offset = ((hash[0] << 8) | hash[1]) % span;
  return base + offset;
}

function normalizeOrigin(value: string | undefined, fallbackHost: string, fallbackPort: number, protocol: "http" | "ws"): string {
  return value?.trim() || `${protocol}://${fallbackHost}:${fallbackPort}`;
}

function resolvePlaywrightRuntimeEnv(): EnvOverrides {
  const serverPort = readPort("VEIL_PLAYWRIGHT_SERVER_PORT", derivePort(DEFAULT_SERVER_PORT));
  const clientPort = readPort("VEIL_PLAYWRIGHT_CLIENT_PORT", derivePort(DEFAULT_CLIENT_PORT));
  const serverOrigin = normalizeOrigin(process.env.VEIL_PLAYWRIGHT_SERVER_ORIGIN, DEFAULT_SERVER_HOST, serverPort, "http");
  const serverWsOrigin = normalizeOrigin(process.env.VEIL_PLAYWRIGHT_SERVER_WS_URL, DEFAULT_SERVER_HOST, serverPort, "ws");
  const clientOrigin = normalizeOrigin(process.env.VEIL_PLAYWRIGHT_CLIENT_ORIGIN, DEFAULT_CLIENT_HOST, clientPort, "http");

  return {
    VEIL_PLAYWRIGHT_CLIENT_MODE: "preview",
    VEIL_PLAYWRIGHT_SERVER_PORT: String(serverPort),
    VEIL_PLAYWRIGHT_CLIENT_PORT: String(clientPort),
    VEIL_PLAYWRIGHT_SERVER_ORIGIN: serverOrigin,
    VEIL_PLAYWRIGHT_SERVER_WS_URL: serverWsOrigin,
    VEIL_PLAYWRIGHT_CLIENT_ORIGIN: clientOrigin,
    VEIL_DEV_SERVER_HTTP_URL: serverOrigin,
    VITE_VEIL_SERVER_HTTP_URL: serverOrigin,
    VITE_VEIL_SERVER_WS_URL: serverWsOrigin
  };
}

function formatCommandWithEnv(command: string, env: EnvOverrides, keys: readonly string[]): string {
  const prefix = keys.map((key) => `${key}=${env[key]}`).join(" ");
  return prefix ? `${prefix} ${command}` : command;
}

function runCommand(command: string, envOverrides: EnvOverrides = {}): void {
  const result = spawnSync(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...envOverrides
    },
    shell: true,
    stdio: "inherit",
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status ?? -1}.`);
  }
}

function aggregateResultStatus(test: PlaywrightTest | undefined, specOk: boolean | undefined): CaseStatus {
  const resultStatuses = test?.results?.map((entry) => entry.status).filter((entry): entry is string => Boolean(entry)) ?? [];
  if (resultStatuses.some((status) => status === "failed" || status === "timedOut" || status === "interrupted")) {
    return "failed";
  }
  if (resultStatuses.some((status) => status === "passed")) {
    return "passed";
  }
  if (specOk === false) {
    return "failed";
  }
  return "skipped";
}

function collectCasesFromSuite(suite: PlaywrightSuite | undefined, cases: CollectedTestCase[]): void {
  if (!suite) {
    return;
  }

  for (const spec of suite.specs ?? []) {
    const test = spec.tests?.[0];
    cases.push({
      id: (spec.title ?? "unnamed-spec").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      title: spec.title ?? "Unnamed Playwright spec",
      projectName: test?.projectName ?? "default",
      status: aggregateResultStatus(test, spec.ok),
      durationMs: test?.results?.reduce((sum, entry) => sum + (entry.duration ?? 0), 0) ?? 0
    });
  }

  for (const child of suite.suites ?? []) {
    collectCasesFromSuite(child, cases);
  }
}

function collectCases(report: PlaywrightJsonReport): CollectedTestCase[] {
  const cases: CollectedTestCase[] = [];
  for (const suite of report.suites ?? []) {
    collectCasesFromSuite(suite, cases);
  }
  return cases;
}

function ensureRequiredCases(cases: CollectedTestCase[]): void {
  for (const title of REQUIRED_CASE_TITLES) {
    if (!cases.some((entry) => entry.title === title)) {
      fail(`Playwright report is missing required packaged RC smoke case: ${title}`);
    }
  }
}

function resolveOutputPath(requestedPath: string | undefined, shortCommit: string): string {
  if (requestedPath) {
    return path.resolve(requestedPath);
  }
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  return path.resolve("artifacts", "release-readiness", `client-release-candidate-smoke-${shortCommit}-${timestamp}.json`);
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main(): void {
  const args = parseArgs(process.argv);
  const commit = readGitValue(["rev-parse", "HEAD"]);
  const shortCommit = readGitValue(["rev-parse", "--short", "HEAD"]);
  const branch = readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = readGitValue(["status", "--porcelain"]).length > 0;
  const artifactDir = path.resolve(args.clientArtifactDir ?? "apps/client/dist");
  const outputPath = resolveOutputPath(args.outputPath, shortCommit);
  const rawPlaywrightReportPath = outputPath.replace(/\.json$/, ".playwright.json");
  const runtimeEnv = resolvePlaywrightRuntimeEnv();
  const startedAtValue = Date.now();
  const startedAt = new Date(startedAtValue).toISOString();

  runCommand(FIXTURE_COMMAND);
  runCommand(BUILD_COMMAND, runtimeEnv);

  if (!fs.existsSync(artifactDir)) {
    fail(`Built client artifact directory does not exist: ${artifactDir}`);
  }

  const result = spawnSync(PLAYWRIGHT_COMMAND, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...runtimeEnv
    },
    shell: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  const finishedAtValue = Date.now();
  const finishedAt = new Date(finishedAtValue).toISOString();

  if (!result.stdout.trim()) {
    fail("Packaged client RC smoke did not emit a Playwright JSON report.");
  }

  let playwrightReport: PlaywrightJsonReport;
  try {
    playwrightReport = JSON.parse(result.stdout) as PlaywrightJsonReport;
  } catch (error) {
    writeJsonFile(rawPlaywrightReportPath, {
      parseError: error instanceof Error ? error.message : String(error),
      stdout: result.stdout
    });
    throw error;
  }

  writeJsonFile(rawPlaywrightReportPath, playwrightReport);

  const cases = collectCases(playwrightReport);
  ensureRequiredCases(cases);

  const failed = cases.filter((entry) => entry.status === "failed").length;
  const skipped = cases.filter((entry) => entry.status === "skipped").length;
  const passed = cases.filter((entry) => entry.status === "passed").length;
  const summary = {
    total: cases.length,
    passed,
    failed,
    skipped,
    flaky: playwrightReport.stats?.flaky ?? 0
  };

  const report: ReleaseCandidateClientArtifactSmokeReport = {
    schemaVersion: 1,
    generatedAt: finishedAt,
    revision: {
      commit,
      shortCommit,
      branch,
      dirty
    },
    artifact: {
      kind: "apps/client/dist",
      path: path.relative(process.cwd(), artifactDir).replace(/\\/g, "/"),
      buildCommand: formatCommandWithEnv(BUILD_COMMAND, runtimeEnv, BUILD_RUNTIME_ENV_KEYS),
      smokeCommand: formatCommandWithEnv(PLAYWRIGHT_COMMAND, runtimeEnv, SMOKE_RUNTIME_ENV_KEYS)
    },
    execution: {
      status: result.status === 0 ? "passed" : "failed",
      exitCode: result.status ?? 1,
      startedAt,
      finishedAt,
      durationMs: finishedAtValue - startedAtValue,
      ...(tailText(result.stdout) !== undefined ? { stdoutTail: tailText(result.stdout) } : {}),
      ...(tailText(result.stderr) !== undefined ? { stderrTail: tailText(result.stderr) } : {}),
      rawPlaywrightReportPath: path.relative(process.cwd(), rawPlaywrightReportPath).replace(/\\/g, "/")
    },
    summary,
    cases
  };

  writeJsonFile(outputPath, report);

  console.log(`Wrote packaged client RC smoke report: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
  console.log(`Revision: ${shortCommit}`);
  console.log(`Status: ${report.execution.status}`);

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

main();
