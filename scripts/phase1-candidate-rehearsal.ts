import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type StageStatus = "passed" | "failed" | "skipped";
type TargetSurface = "h5" | "wechat";

interface Args {
  candidate: string;
  outputDir: string;
  h5SmokePath?: string;
  reconnectSoakPath?: string;
  runtimeReportPath?: string;
  wechatArtifactsDir?: string;
  validateStatus?: string;
  wechatBuildStatus?: string;
  clientRcSmokeStatus?: string;
  targetSurface: TargetSurface;
  runUrl?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface StageDefinition {
  id: string;
  title: string;
  command?: string[];
  run: () => StageResult;
}

interface StageResult {
  id: string;
  title: string;
  status: StageStatus;
  summary: string;
  command?: string;
  exitCode?: number | null;
  outputs?: string[];
}

interface RehearsalArtifacts {
  stableH5SmokePath?: string;
  stableReconnectSoakPath?: string;
  stableRuntimeReportPath?: string;
  stableWechatArtifactsDir?: string;
  releaseReadinessSnapshotPath?: string;
  wechatCandidateSummaryPath?: string;
  wechatCandidateMarkdownPath?: string;
  persistencePath?: string;
  cocosBundlePath?: string;
  cocosBundleMarkdownPath?: string;
  releaseGateSummaryPath?: string;
  releaseGateMarkdownPath?: string;
  ciTrendSummaryPath?: string;
  ciTrendMarkdownPath?: string;
  releaseHealthSummaryPath?: string;
  releaseHealthMarkdownPath?: string;
  phase1CandidateDossierPath?: string;
  phase1CandidateDossierMarkdownPath?: string;
  summaryPath?: string;
  markdownPath?: string;
}

interface RehearsalReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    branch: string;
    dirty: boolean;
    targetSurface: TargetSurface;
  };
  summary: {
    status: "passed" | "failed";
    stageFailures: string[];
    missingArtifacts: string[];
    releaseGateStatus: string;
    releaseHealthStatus: string;
    phase1CandidateStatus: string;
  };
  runUrl?: string;
  artifactBundleDir: string;
  artifacts: RehearsalArtifacts;
  stages: StageResult[];
}

const OUTPUT_LIMIT = 4000;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate = "phase1-mainline";
  let outputDir = path.join("artifacts", "release-readiness", "phase1-candidate-rehearsal");
  let h5SmokePath: string | undefined;
  let reconnectSoakPath: string | undefined;
  let runtimeReportPath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let validateStatus: string | undefined;
  let wechatBuildStatus: string | undefined;
  let clientRcSmokeStatus: string | undefined;
  let targetSurface: TargetSurface = "h5";
  let runUrl: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--candidate" && next) {
      candidate = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--h5-smoke" && next) {
      h5SmokePath = next;
      index += 1;
      continue;
    }
    if (arg === "--reconnect-soak" && next) {
      reconnectSoakPath = next;
      index += 1;
      continue;
    }
    if (arg === "--runtime-report" && next) {
      runtimeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-artifacts-dir" && next) {
      wechatArtifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--validate-status" && next) {
      validateStatus = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-build-status" && next) {
      wechatBuildStatus = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--client-rc-smoke-status" && next) {
      clientRcSmokeStatus = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--target-surface" && next) {
      if (next !== "h5" && next !== "wechat") {
        fail(`Unsupported --target-surface value: ${next}`);
      }
      targetSurface = next;
      index += 1;
      continue;
    }
    if (arg === "--run-url" && next) {
      runUrl = next.trim();
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    candidate,
    outputDir,
    ...(h5SmokePath ? { h5SmokePath } : {}),
    ...(reconnectSoakPath ? { reconnectSoakPath } : {}),
    ...(runtimeReportPath ? { runtimeReportPath } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(validateStatus ? { validateStatus } : {}),
    ...(wechatBuildStatus ? { wechatBuildStatus } : {}),
    ...(clientRcSmokeStatus ? { clientRcSmokeStatus } : {}),
    targetSurface,
    ...(runUrl ? { runUrl } : {})
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

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "candidate";
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonFile(filePath: string, payload: unknown): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeFile(filePath: string, content: string): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function toRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function formatCommand(args: string[]): string {
  return args
    .map((part) => (/[^A-Za-z0-9_./:-]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function tailText(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length <= OUTPUT_LIMIT ? normalized : normalized.slice(-OUTPUT_LIMIT);
}

function runCommandStage(id: string, title: string, command: string[], outputs: string[]): StageResult {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  const stdout = tailText(result.stdout);
  const stderr = tailText(result.stderr);
  if (result.error) {
    return {
      id,
      title,
      status: "failed",
      summary: result.error.message,
      command: formatCommand(command),
      exitCode: result.status ?? 1,
      outputs: outputs.map(toRelative)
    };
  }
  if (result.status !== 0) {
    const summary = stderr ?? stdout ?? `Command exited with code ${result.status}.`;
    return {
      id,
      title,
      status: "failed",
      summary,
      command: formatCommand(command),
      exitCode: result.status,
      outputs: outputs.map(toRelative)
    };
  }
  return {
    id,
    title,
    status: "passed",
    summary: stdout?.split(/\r?\n/)[0] ?? "ok",
    command: formatCommand(command),
    exitCode: result.status,
    outputs: outputs.map(toRelative)
  };
}

function copyFileIfPresent(sourcePath: string | undefined, destinationPath: string): boolean {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }
  ensureDir(destinationPath);
  fs.copyFileSync(sourcePath, destinationPath);
  return true;
}

function copyDirectory(sourceDir: string, destinationDir: string): void {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
      continue;
    }
    ensureDir(destinationPath);
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function readOptionalJson(filePath: string | undefined): any {
  if (!filePath || !fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findFirstMatching(outputDir: string, prefix: string, suffix: string): string | undefined {
  if (!fs.existsSync(outputDir)) {
    return undefined;
  }
  return fs
    .readdirSync(outputDir)
    .sort()
    .map((entry) => path.join(outputDir, entry))
    .find((entry) => path.basename(entry).startsWith(prefix) && entry.endsWith(suffix));
}

function renderMarkdown(report: RehearsalReport): string {
  const lines: string[] = [];
  lines.push("# Phase 1 Candidate Rehearsal", "");
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Revision: \`${report.candidate.shortRevision}\``);
  lines.push(`- Branch: \`${report.candidate.branch}\``);
  lines.push(`- Target surface: \`${report.candidate.targetSurface}\``);
  lines.push(`- Rehearsal status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Release gate summary: \`${report.summary.releaseGateStatus}\``);
  lines.push(`- Release health summary: \`${report.summary.releaseHealthStatus}\``);
  lines.push(`- Phase 1 dossier summary: \`${report.summary.phase1CandidateStatus}\``);
  lines.push(`- Artifact bundle: \`${report.artifactBundleDir}\``);
  if (report.runUrl) {
    lines.push(`- Workflow run: ${report.runUrl}`);
  }
  lines.push("");

  if (report.summary.stageFailures.length > 0) {
    lines.push("## Stage Failures", "");
    for (const failure of report.summary.stageFailures) {
      lines.push(`- ${failure}`);
    }
    lines.push("");
  }

  if (report.summary.missingArtifacts.length > 0) {
    lines.push("## Missing Artifacts", "");
    for (const artifact of report.summary.missingArtifacts) {
      lines.push(`- ${artifact}`);
    }
    lines.push("");
  }

  lines.push("## Generated Outputs", "");
  const artifactEntries = Object.entries(report.artifacts)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of artifactEntries) {
    lines.push(`- ${key}: \`${value}\``);
  }
  lines.push("");

  lines.push("## Stage Results", "");
  lines.push("| Stage | Status | Notes |");
  lines.push("| --- | --- | --- |");
  for (const stage of report.stages) {
    lines.push(`| ${stage.title} | ${stage.status.toUpperCase()} | ${stage.summary.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");

  lines.push("## Notes", "");
  lines.push("- This rehearsal validates artifact generation and candidate-scoped evidence packaging on `main`.");
  lines.push("- The dossier can remain `pending` when live runtime sampling or WeChat manual-review evidence is intentionally absent from automation.");
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const args = parseArgs(process.argv);
  const revision = getRevision();
  const candidateSlug = slugify(args.candidate);
  const outputDir = path.resolve(args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const artifacts: RehearsalArtifacts = {};
  const stageResults: StageResult[] = [];
  const nodeExec = process.execPath;

  const stableH5SmokePath = path.join(outputDir, `client-release-candidate-smoke-${candidateSlug}-${revision.shortCommit}.json`);
  const stableReconnectSoakPath = path.join(outputDir, `colyseus-reconnect-soak-summary-${candidateSlug}-${revision.shortCommit}.json`);
  const stableRuntimeReportPath = path.join(outputDir, `runtime-regression-report-${candidateSlug}-${revision.shortCommit}.json`);
  const stableWechatArtifactsDir = path.join(outputDir, `wechat-release-${candidateSlug}-${revision.shortCommit}`);
  const releaseReadinessSnapshotPath = path.join(outputDir, `release-readiness-${candidateSlug}-${revision.shortCommit}.json`);
  const persistencePath = path.join(outputDir, `phase1-release-persistence-regression-${candidateSlug}-${revision.shortCommit}.json`);
  const releaseGateSummaryPath = path.join(outputDir, `release-gate-summary-${candidateSlug}-${revision.shortCommit}.json`);
  const releaseGateMarkdownPath = path.join(outputDir, `release-gate-summary-${candidateSlug}-${revision.shortCommit}.md`);
  const ciTrendSummaryPath = path.join(outputDir, `ci-trend-summary-${candidateSlug}-${revision.shortCommit}.json`);
  const ciTrendMarkdownPath = path.join(outputDir, `ci-trend-summary-${candidateSlug}-${revision.shortCommit}.md`);
  const releaseHealthSummaryPath = path.join(outputDir, `release-health-summary-${candidateSlug}-${revision.shortCommit}.json`);
  const releaseHealthMarkdownPath = path.join(outputDir, `release-health-summary-${candidateSlug}-${revision.shortCommit}.md`);
  const phase1CandidateDossierPath = path.join(outputDir, `phase1-candidate-dossier-${candidateSlug}-${revision.shortCommit}.json`);
  const phase1CandidateDossierMarkdownPath = path.join(outputDir, `phase1-candidate-dossier-${candidateSlug}-${revision.shortCommit}.md`);
  const summaryPath = path.join(outputDir, `phase1-candidate-rehearsal-${candidateSlug}-${revision.shortCommit}.json`);
  const markdownPath = path.join(outputDir, "SUMMARY.md");

  artifacts.releaseReadinessSnapshotPath = toRelative(releaseReadinessSnapshotPath);
  artifacts.persistencePath = toRelative(persistencePath);
  artifacts.releaseGateSummaryPath = toRelative(releaseGateSummaryPath);
  artifacts.releaseGateMarkdownPath = toRelative(releaseGateMarkdownPath);
  artifacts.ciTrendSummaryPath = toRelative(ciTrendSummaryPath);
  artifacts.ciTrendMarkdownPath = toRelative(ciTrendMarkdownPath);
  artifacts.releaseHealthSummaryPath = toRelative(releaseHealthSummaryPath);
  artifacts.releaseHealthMarkdownPath = toRelative(releaseHealthMarkdownPath);
  artifacts.phase1CandidateDossierPath = toRelative(phase1CandidateDossierPath);
  artifacts.phase1CandidateDossierMarkdownPath = toRelative(phase1CandidateDossierMarkdownPath);
  artifacts.summaryPath = toRelative(summaryPath);
  artifacts.markdownPath = toRelative(markdownPath);

  const stageDefinitions: StageDefinition[] = [
    {
      id: "stabilize-inputs",
      title: "Assemble stable rehearsal inputs",
      run: () => {
        const copied: string[] = [];
        if (copyFileIfPresent(args.h5SmokePath, stableH5SmokePath)) {
          artifacts.stableH5SmokePath = toRelative(stableH5SmokePath);
          copied.push(toRelative(stableH5SmokePath));
        }
        if (copyFileIfPresent(args.reconnectSoakPath, stableReconnectSoakPath)) {
          artifacts.stableReconnectSoakPath = toRelative(stableReconnectSoakPath);
          copied.push(toRelative(stableReconnectSoakPath));
        }
        if (copyFileIfPresent(args.runtimeReportPath, stableRuntimeReportPath)) {
          artifacts.stableRuntimeReportPath = toRelative(stableRuntimeReportPath);
          copied.push(toRelative(stableRuntimeReportPath));
        }
        if (args.wechatArtifactsDir && fs.existsSync(args.wechatArtifactsDir)) {
          copyDirectory(args.wechatArtifactsDir, stableWechatArtifactsDir);
          artifacts.stableWechatArtifactsDir = toRelative(stableWechatArtifactsDir);
          copied.push(toRelative(stableWechatArtifactsDir));
        }

        return {
          id: "stabilize-inputs",
          title: "Assemble stable rehearsal inputs",
          status: copied.length > 0 ? "passed" : "skipped",
          summary: copied.length > 0 ? `Prepared ${copied.length} stable input path(s).` : "No external rehearsal inputs were provided.",
          outputs: copied
        };
      }
    },
    {
      id: "release-readiness-snapshot",
      title: "Build release readiness snapshot",
      command: [
        nodeExec,
        "--import",
        "tsx",
        "./scripts/ci-release-readiness-snapshot.ts",
        "--validate-status",
        args.validateStatus ?? "pending",
        "--wechat-build-status",
        args.wechatBuildStatus ?? "pending",
        "--client-rc-smoke-status",
        args.clientRcSmokeStatus ?? "pending",
        "--output",
        releaseReadinessSnapshotPath
      ],
      run: () =>
        runCommandStage("release-readiness-snapshot", "Build release readiness snapshot", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/ci-release-readiness-snapshot.ts",
          "--validate-status",
          args.validateStatus ?? "pending",
          "--wechat-build-status",
          args.wechatBuildStatus ?? "pending",
          "--client-rc-smoke-status",
          args.clientRcSmokeStatus ?? "pending",
          "--output",
          releaseReadinessSnapshotPath
        ], [releaseReadinessSnapshotPath])
    },
    {
      id: "wechat-candidate-summary",
      title: "Refresh WeChat candidate summary",
      run: () => {
        if (!artifacts.stableWechatArtifactsDir) {
          return {
            id: "wechat-candidate-summary",
            title: "Refresh WeChat candidate summary",
            status: "skipped",
            summary: "No WeChat artifacts directory was provided."
          };
        }
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/validate-wechat-release-candidate.ts",
          "--artifacts-dir",
          stableWechatArtifactsDir,
          "--expected-revision",
          revision.commit
        ];
        const result = runCommandStage("wechat-candidate-summary", "Refresh WeChat candidate summary", command, [
          path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.json"),
          path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.md")
        ]);
        artifacts.wechatCandidateSummaryPath = toRelative(path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.json"));
        artifacts.wechatCandidateMarkdownPath = toRelative(path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.md"));
        return result;
      }
    },
    {
      id: "phase1-persistence",
      title: "Run Phase 1 persistence regression",
      run: () =>
        runCommandStage("phase1-persistence", "Run Phase 1 persistence regression", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/phase1-release-persistence-regression.ts",
          "--output",
          persistencePath
        ], [persistencePath])
    },
    {
      id: "cocos-rc-bundle",
      title: "Build Cocos RC evidence bundle",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/cocos-rc-evidence-bundle.ts",
          "--candidate",
          args.candidate,
          "--build-surface",
          "wechat_preview",
          "--output-dir",
          outputDir,
          "--release-readiness-snapshot",
          releaseReadinessSnapshotPath,
          "--force"
        ];
        return runCommandStage("cocos-rc-bundle", "Build Cocos RC evidence bundle", command, [outputDir]);
      }
    },
    {
      id: "release-gate-summary",
      title: "Build release gate summary",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/release-gate-summary.ts",
          "--target-surface",
          args.targetSurface,
          "--snapshot",
          releaseReadinessSnapshotPath,
          "--output",
          releaseGateSummaryPath,
          "--markdown-output",
          releaseGateMarkdownPath
        ];
        if (artifacts.stableH5SmokePath) {
          command.push("--h5-smoke", stableH5SmokePath);
        }
        if (artifacts.stableReconnectSoakPath) {
          command.push("--reconnect-soak", stableReconnectSoakPath);
        }
        if (artifacts.stableWechatArtifactsDir) {
          command.push("--wechat-artifacts-dir", stableWechatArtifactsDir);
        }
        return runCommandStage("release-gate-summary", "Build release gate summary", command, [
          releaseGateSummaryPath,
          releaseGateMarkdownPath
        ]);
      }
    },
    {
      id: "ci-trend-summary",
      title: "Build CI trend summary",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/publish-ci-trend-summary.ts",
          "--output",
          ciTrendSummaryPath,
          "--markdown-output",
          ciTrendMarkdownPath,
          "--release-gate-report",
          releaseGateSummaryPath
        ];
        if (artifacts.stableRuntimeReportPath) {
          command.push("--runtime-report", stableRuntimeReportPath);
        }
        return runCommandStage("ci-trend-summary", "Build CI trend summary", command, [
          ciTrendSummaryPath,
          ciTrendMarkdownPath
        ]);
      }
    },
    {
      id: "release-health-summary",
      title: "Build release health summary",
      run: () =>
        runCommandStage("release-health-summary", "Build release health summary", [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/release-health-summary.ts",
          "--release-readiness",
          releaseReadinessSnapshotPath,
          "--release-gate-summary",
          releaseGateSummaryPath,
          "--ci-trend-summary",
          ciTrendSummaryPath,
          "--output",
          releaseHealthSummaryPath,
          "--markdown-output",
          releaseHealthMarkdownPath
        ], [releaseHealthSummaryPath, releaseHealthMarkdownPath])
    },
    {
      id: "phase1-candidate-dossier",
      title: "Build Phase 1 candidate dossier",
      run: () => {
        const command = [
          nodeExec,
          "--import",
          "tsx",
          "./scripts/phase1-candidate-dossier.ts",
          "--candidate",
          args.candidate,
          "--candidate-revision",
          revision.commit,
          "--target-surface",
          args.targetSurface,
          "--snapshot",
          releaseReadinessSnapshotPath,
          "--cocos-bundle",
          findFirstMatching(outputDir, "cocos-rc-evidence-bundle-", ".json") ?? path.join(outputDir, "missing-cocos-bundle.json"),
          "--phase1-persistence",
          persistencePath,
          "--reconnect-soak",
          artifacts.stableReconnectSoakPath ? stableReconnectSoakPath : path.join(outputDir, "missing-reconnect-soak.json"),
          "--ci-trend-summary",
          ciTrendSummaryPath,
          "--output",
          phase1CandidateDossierPath,
          "--markdown-output",
          phase1CandidateDossierMarkdownPath
        ];
        if (artifacts.stableH5SmokePath) {
          command.push("--h5-smoke", stableH5SmokePath);
        }
        if (artifacts.stableWechatArtifactsDir) {
          command.push("--wechat-artifacts-dir", stableWechatArtifactsDir);
        }
        return runCommandStage("phase1-candidate-dossier", "Build Phase 1 candidate dossier", command, [
          phase1CandidateDossierPath,
          phase1CandidateDossierMarkdownPath
        ]);
      }
    }
  ];

  for (const stage of stageDefinitions) {
    const result = stage.run();
    stageResults.push(result);
  }

  const cocosBundlePath = findFirstMatching(outputDir, "cocos-rc-evidence-bundle-", ".json");
  const cocosBundleMarkdownPath = findFirstMatching(outputDir, "cocos-rc-evidence-bundle-", ".md");
  if (cocosBundlePath) {
    artifacts.cocosBundlePath = toRelative(cocosBundlePath);
  }
  if (cocosBundleMarkdownPath) {
    artifacts.cocosBundleMarkdownPath = toRelative(cocosBundleMarkdownPath);
  }

  const releaseGate = readOptionalJson(releaseGateSummaryPath);
  const releaseHealth = readOptionalJson(releaseHealthSummaryPath);
  const dossier = readOptionalJson(phase1CandidateDossierPath);
  const requiredArtifacts = [
    releaseReadinessSnapshotPath,
    persistencePath,
    releaseGateSummaryPath,
    releaseGateMarkdownPath,
    ciTrendSummaryPath,
    ciTrendMarkdownPath,
    releaseHealthSummaryPath,
    releaseHealthMarkdownPath,
    phase1CandidateDossierPath,
    phase1CandidateDossierMarkdownPath
  ];
  if (artifacts.stableH5SmokePath) {
    requiredArtifacts.push(stableH5SmokePath);
  }
  if (artifacts.stableReconnectSoakPath) {
    requiredArtifacts.push(stableReconnectSoakPath);
  }
  if (artifacts.stableWechatArtifactsDir) {
    requiredArtifacts.push(path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.json"));
    requiredArtifacts.push(path.join(stableWechatArtifactsDir, "codex.wechat.release-candidate-summary.md"));
  }
  if (cocosBundlePath) {
    requiredArtifacts.push(cocosBundlePath);
  }
  if (cocosBundleMarkdownPath) {
    requiredArtifacts.push(cocosBundleMarkdownPath);
  }

  const missingArtifacts = requiredArtifacts.filter((filePath) => !fs.existsSync(filePath)).map(toRelative);
  const stageFailures = stageResults
    .filter((stage) => stage.status === "failed")
    .map((stage) => `${stage.title}: ${stage.summary}`);
  const status = stageFailures.length === 0 && missingArtifacts.length === 0 ? "passed" : "failed";

  const report: RehearsalReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: args.candidate,
      revision: revision.commit,
      shortRevision: revision.shortCommit,
      branch: revision.branch,
      dirty: revision.dirty,
      targetSurface: args.targetSurface
    },
    summary: {
      status,
      stageFailures,
      missingArtifacts,
      releaseGateStatus: String(releaseGate?.summary?.status ?? "unknown"),
      releaseHealthStatus: String(releaseHealth?.summary?.status ?? "unknown"),
      phase1CandidateStatus: String(dossier?.summary?.status ?? "unknown")
    },
    ...(args.runUrl ? { runUrl: args.runUrl } : {}),
    artifactBundleDir: toRelative(outputDir),
    artifacts,
    stages: stageResults
  };

  writeJsonFile(summaryPath, report);
  writeFile(markdownPath, renderMarkdown(report));

  console.log(`Phase 1 candidate rehearsal ${status.toUpperCase()}`);
  console.log(`Candidate: ${args.candidate}`);
  console.log(`Revision: ${revision.shortCommit}`);
  console.log(`Structured summary: ${toRelative(summaryPath)}`);
  console.log(`Markdown summary: ${toRelative(markdownPath)}`);
  console.log(`Release gate status: ${report.summary.releaseGateStatus}`);
  console.log(`Release health status: ${report.summary.releaseHealthStatus}`);
  console.log(`Phase 1 dossier status: ${report.summary.phase1CandidateStatus}`);

  if (status === "failed") {
    if (stageFailures.length > 0) {
      console.error("Stage failures:");
      for (const failure of stageFailures) {
        console.error(`  - ${failure}`);
      }
    }
    if (missingArtifacts.length > 0) {
      console.error("Missing artifacts:");
      for (const artifact of missingArtifacts) {
        console.error(`  - ${artifact}`);
      }
    }
    process.exitCode = 1;
  }
}

main();
