import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface Args {
  candidate: string;
  candidateRevision: string;
  outputPath?: string;
  markdownOutputPath?: string;
  passthroughArgs: string[];
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface RuntimeHealthAfterCleanup {
  activeRoomCount?: number;
  connectionCount?: number;
  activeBattleCount?: number;
  heroCount?: number;
}

interface ReconnectSoakSummary {
  reconnectCycles: number;
  reconnectAttempts: number;
  invariantChecks: number;
  worldReconnectCycles: number;
  battleReconnectCycles: number;
  finalBattleRooms: number;
  finalDayRange: {
    min: number;
    max: number;
  };
}

interface ScenarioResult {
  scenario: string;
  rooms: number;
  successfulRooms: number;
  failedRooms: number;
  completedActions: number;
  durationMs: number;
  runtimeHealthAfterCleanup?: RuntimeHealthAfterCleanup;
  soakSummary?: ReconnectSoakSummary;
  errorMessage?: string;
}

interface ReconnectSoakArtifact {
  schemaVersion: number;
  artifactType: string;
  generatedAt?: string;
  command?: string;
  revision: {
    commit?: string;
    shortCommit?: string;
    branch?: string;
    dirty?: boolean;
  };
  status?: "passed" | "failed";
  options?: {
    rooms?: number;
    reconnectCycles?: number;
    scenarios?: string[];
  };
  summary?: {
    totalScenarios?: number;
    failedScenarios?: number;
    scenarioNames?: string[];
  };
  soakSummary?: ReconnectSoakSummary | null;
  results?: ScenarioResult[];
}

interface CandidateReconnectSoakFailure {
  scenario: string;
  summary: string;
  failedRooms: number;
  errorMessage?: string;
}

interface CandidateReconnectSoakScenario {
  scenario: string;
  rooms: number;
  successfulRooms: number;
  failedRooms: number;
  durationMinutes: number;
  reconnectAttempts: number;
  invariantChecks: number;
  cleanupHealthy: boolean;
  cleanup?: RuntimeHealthAfterCleanup;
  errorMessage?: string;
}

interface CandidateReconnectSoakReport extends ReconnectSoakArtifact {
  schemaVersion: 2;
  artifactType: "release-candidate-reconnect-soak";
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
  };
  artifacts: {
    jsonPath: string;
    markdownPath: string;
  };
  verdict: {
    status: "passed" | "failed";
    summary: string;
  };
  reviewSignals: {
    durationMinutes: number;
    reconnectAttempts: number;
    invariantChecks: number;
    worldReconnectCycles: number;
    battleReconnectCycles: number;
    finalBattleRooms: number;
    finalDayRange?: {
      min: number;
      max: number;
    };
    cleanupHealthy: boolean;
    cleanup?: RuntimeHealthAfterCleanup;
  };
  scenarioMatrix: CandidateReconnectSoakScenario[];
  failures: CandidateReconnectSoakFailure[];
  rerunTriggers: string[];
  operatorGuidance: {
    minimumProfile: string;
    flakySignalPolicy: string;
    blockerPolicy: string;
  };
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_RERUN_TRIGGERS = [
  "Candidate revision changes.",
  "Reconnect, room recovery, battle recovery, world progression, or snapshot persistence code changes.",
  "Reconnect soak defaults, scenario matrix, or artifact contract changes.",
  "A prior soak artifact is stale, partial, or failed."
];

function fail(message: string): never {
  throw new Error(message);
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "candidate"
  );
}

function normalizeCommit(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-f0-9]+$/.test(normalized) ? normalized : undefined;
}

function commitsMatch(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeCommit(left);
  const normalizedRight = normalizeCommit(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function parseArgs(argv: string[]): Args {
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  const passthroughArgs: string[] = [];

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg.startsWith("--candidate=")) {
      candidate = arg.slice("--candidate=".length).trim();
      continue;
    }
    if (arg === "--candidate" && next) {
      candidate = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--candidate-revision=")) {
      candidateRevision = arg.slice("--candidate-revision=".length).trim();
      continue;
    }
    if (arg === "--candidate-revision" && next) {
      candidateRevision = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length).trim();
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--markdown-output=")) {
      markdownOutputPath = arg.slice("--markdown-output=".length).trim();
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--artifact-path" || arg.startsWith("--artifact-path=")) {
      fail("Use --output instead of --artifact-path so the candidate wrapper can pin the reconnect soak artifact.");
    }
    if (arg === "--scenarios" || arg.startsWith("--scenarios=")) {
      fail("release:reconnect-soak always runs the reconnect_soak scenario; do not override --scenarios here.");
    }

    passthroughArgs.push(arg);
    if (next && !next.startsWith("--")) {
      passthroughArgs.push(next);
      index += 1;
    }
  }

  if (!candidate) {
    fail("Missing required --candidate.");
  }
  if (!candidateRevision) {
    fail("Missing required --candidate-revision.");
  }

  return {
    candidate,
    candidateRevision,
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    passthroughArgs
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

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function relativeArtifactPath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function cleanupHealthy(cleanup: RuntimeHealthAfterCleanup | undefined): boolean {
  return (
    (cleanup?.activeRoomCount ?? 0) === 0 &&
    (cleanup?.connectionCount ?? 0) === 0 &&
    (cleanup?.activeBattleCount ?? 0) === 0 &&
    (cleanup?.heroCount ?? 0) === 0
  );
}

function computeOutputBaseName(candidate: string, revision: string): string {
  const shortRevision = (normalizeCommit(revision) ?? revision).slice(0, 7);
  return `colyseus-reconnect-soak-summary-${slugify(candidate)}-${shortRevision}`;
}

export function buildCandidateReconnectSoakReport(
  artifact: ReconnectSoakArtifact,
  options: {
    candidate: string;
    candidateRevision: string;
    outputPath: string;
    markdownOutputPath: string;
  }
): CandidateReconnectSoakReport {
  const scenarioMatrix = (artifact.results ?? []).map((result) => ({
    scenario: result.scenario,
    rooms: result.rooms,
    successfulRooms: result.successfulRooms,
    failedRooms: result.failedRooms,
    durationMinutes: Number((result.durationMs / (1000 * 60)).toFixed(2)),
    reconnectAttempts: result.soakSummary?.reconnectAttempts ?? 0,
    invariantChecks: result.soakSummary?.invariantChecks ?? 0,
    cleanupHealthy: cleanupHealthy(result.runtimeHealthAfterCleanup),
    ...(result.runtimeHealthAfterCleanup ? { cleanup: result.runtimeHealthAfterCleanup } : {}),
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {})
  }));
  const failures = scenarioMatrix
    .filter((entry) => entry.failedRooms > 0 || entry.cleanupHealthy === false || entry.errorMessage)
    .map((entry) => ({
      scenario: entry.scenario,
      summary:
        entry.failedRooms > 0
          ? `${entry.failedRooms} room(s) failed reconnect soak invariants.`
          : entry.cleanupHealthy === false
            ? "Cleanup counters did not return to zero after the soak."
            : entry.errorMessage ?? "Reconnect soak failed.",
      failedRooms: entry.failedRooms,
      ...(entry.errorMessage ? { errorMessage: entry.errorMessage } : {})
    }));
  const reconnectSoakResult = artifact.results?.find((entry) => entry.scenario === "reconnect_soak");
  const cleanup = reconnectSoakResult?.runtimeHealthAfterCleanup;
  const revision = artifact.revision.commit ?? artifact.revision.shortCommit ?? options.candidateRevision;
  const passing =
    artifact.status === "passed" &&
    (artifact.summary?.failedScenarios ?? 0) === 0 &&
    failures.length === 0 &&
    (artifact.soakSummary?.reconnectAttempts ?? 0) > 0 &&
    (artifact.soakSummary?.invariantChecks ?? 0) > 0 &&
    cleanupHealthy(cleanup) &&
    commitsMatch(revision, options.candidateRevision);

  return {
    ...artifact,
    schemaVersion: 2,
    artifactType: "release-candidate-reconnect-soak",
    candidate: {
      name: options.candidate,
      revision: options.candidateRevision,
      shortRevision: (normalizeCommit(options.candidateRevision) ?? options.candidateRevision).slice(0, 7)
    },
    artifacts: {
      jsonPath: options.outputPath,
      markdownPath: options.markdownOutputPath
    },
    verdict: {
      status: passing ? "passed" : "failed",
      summary: passing
        ? "Reconnect soak evidence is present and passing for this candidate revision."
        : !commitsMatch(revision, options.candidateRevision)
          ? `Reconnect soak evidence targets ${revision} instead of candidate ${options.candidateRevision}.`
          : failures[0]?.summary ?? "Reconnect soak evidence is failing for this candidate revision."
    },
    reviewSignals: {
      durationMinutes: Number(((reconnectSoakResult?.durationMs ?? 0) / (1000 * 60)).toFixed(2)),
      reconnectAttempts: artifact.soakSummary?.reconnectAttempts ?? 0,
      invariantChecks: artifact.soakSummary?.invariantChecks ?? 0,
      worldReconnectCycles: artifact.soakSummary?.worldReconnectCycles ?? 0,
      battleReconnectCycles: artifact.soakSummary?.battleReconnectCycles ?? 0,
      finalBattleRooms: artifact.soakSummary?.finalBattleRooms ?? 0,
      ...(artifact.soakSummary?.finalDayRange ? { finalDayRange: artifact.soakSummary.finalDayRange } : {}),
      cleanupHealthy: cleanupHealthy(cleanup),
      ...(cleanup ? { cleanup } : {})
    },
    scenarioMatrix,
    failures,
    rerunTriggers: [...DEFAULT_RERUN_TRIGGERS],
    operatorGuidance: {
      minimumProfile:
        "Use the canonical reconnect soak defaults: 48 rooms, 8 reconnect cycles per room, 12 connect concurrency, 12 action concurrency, 150ms reconnect pause.",
      flakySignalPolicy:
        "Treat a one-off infra or port-binding interruption as a rerun candidate only when reconnect invariants and cleanup counters never regressed; otherwise treat the artifact as stale and rerun on the pinned revision.",
      blockerPolicy:
        "Any invariant failure, cleanup leak, revision mismatch, or zero reconnect/invariant counts is a release blocker until a fresh candidate-scoped soak passes."
    }
  };
}

export function renderMarkdown(report: CandidateReconnectSoakReport): string {
  const lines = [
    "# Candidate Reconnect Soak",
    "",
    `- Candidate: \`${report.candidate.name}\``,
    `- Revision: \`${report.candidate.shortRevision}\``,
    `- Generated at: \`${report.generatedAt ?? "unknown"}\``,
    `- Verdict: **${report.verdict.status.toUpperCase()}**`,
    `- Summary: ${report.verdict.summary}`,
    `- Duration: \`${report.reviewSignals.durationMinutes.toFixed(2)} min\``,
    `- Reconnect attempts: \`${report.reviewSignals.reconnectAttempts}\``,
    `- Invariant checks: \`${report.reviewSignals.invariantChecks}\``,
    `- World reconnect cycles: \`${report.reviewSignals.worldReconnectCycles}\``,
    `- Battle reconnect cycles: \`${report.reviewSignals.battleReconnectCycles}\``,
    `- Final battle rooms: \`${report.reviewSignals.finalBattleRooms}\``,
    `- Cleanup healthy: \`${report.reviewSignals.cleanupHealthy ? "yes" : "no"}\``,
    ""
  ];

  lines.push("## Scenario Matrix");
  lines.push("");
  lines.push("| Scenario | Rooms | Passed | Failed | Duration (min) | Reconnects | Invariants | Cleanup |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const entry of report.scenarioMatrix) {
    lines.push(
      `| ${entry.scenario} | ${entry.rooms} | ${entry.successfulRooms} | ${entry.failedRooms} | ${entry.durationMinutes.toFixed(2)} | ${entry.reconnectAttempts} | ${entry.invariantChecks} | ${entry.cleanupHealthy ? "clean" : "leaked"} |`
    );
  }
  lines.push("");

  lines.push("## Failures");
  lines.push("");
  if (report.failures.length === 0) {
    lines.push("- None.");
  } else {
    for (const failure of report.failures) {
      lines.push(`- \`${failure.scenario}\`: ${failure.summary}`);
      if (failure.errorMessage) {
        lines.push(`  Raw error: ${failure.errorMessage}`);
      }
    }
  }
  lines.push("");

  lines.push("## Operator Guidance");
  lines.push("");
  lines.push(`- Minimum profile: ${report.operatorGuidance.minimumProfile}`);
  lines.push(`- Flakes vs rerun: ${report.operatorGuidance.flakySignalPolicy}`);
  lines.push(`- Blocking policy: ${report.operatorGuidance.blockerPolicy}`);
  lines.push("");

  lines.push("## Rerun Triggers");
  lines.push("");
  for (const trigger of report.rerunTriggers) {
    lines.push(`- ${trigger}`);
  }
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
}

function main(): void {
  const args = parseArgs(process.argv);
  const revision = getRevision();
  if (!commitsMatch(args.candidateRevision, revision.commit)) {
    fail(
      `Candidate revision ${args.candidateRevision} does not match the checked-out revision ${revision.commit}. Run the soak from the pinned candidate checkout.`
    );
  }

  const outputBaseName = computeOutputBaseName(args.candidate, args.candidateRevision);
  const outputPath = path.resolve(args.outputPath ?? path.join(DEFAULT_RELEASE_READINESS_DIR, `${outputBaseName}.json`));
  const markdownOutputPath = path.resolve(args.markdownOutputPath ?? path.join(DEFAULT_RELEASE_READINESS_DIR, `${outputBaseName}.md`));

  const runnerArgs = [
    "--import",
    "tsx",
    "./scripts/stress-concurrent-rooms.ts",
    "--scenarios=reconnect_soak",
    `--artifact-path=${outputPath}`,
    ...args.passthroughArgs
  ];
  const run = spawnSync("node", runnerArgs, {
    cwd: process.cwd(),
    stdio: "inherit"
  });

  if (!fs.existsSync(outputPath)) {
    fail(`Reconnect soak runner did not produce an artifact at ${outputPath}.`);
  }

  const baseArtifact = readJsonFile<ReconnectSoakArtifact>(outputPath);
  const report = buildCandidateReconnectSoakReport(baseArtifact, {
    candidate: args.candidate,
    candidateRevision: revision.commit,
    outputPath,
    markdownOutputPath
  });

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote reconnect soak JSON: ${relativeArtifactPath(outputPath)}`);
  console.log(`Wrote reconnect soak Markdown: ${relativeArtifactPath(markdownOutputPath)}`);
  console.log(`Reconnect soak verdict: ${report.verdict.status}`);

  if ((run.status ?? 1) !== 0 || report.verdict.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
