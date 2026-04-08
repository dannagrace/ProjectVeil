import fs from "node:fs";
import path from "node:path";

type VerificationStatus = "passed" | "failed";

interface Args {
  artifactsDir?: string;
  metadataPath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  candidate?: string;
  candidateRevision?: string;
  environment?: string;
  operator?: string;
  recordedAt?: string;
  status?: VerificationStatus;
  installStatus?: VerificationStatus;
  launchStatus?: VerificationStatus;
  summary?: string;
  installSummary?: string;
  launchSummary?: string;
  evidence: string[];
}

interface WechatMinigameReleasePackageMetadata {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  projectName: string;
  appId: string;
  archiveFileName: string;
  archiveSha256: string;
  sourceRevision?: string;
}

interface WechatPackageInstallLaunchEvidence {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
  };
  artifact: {
    artifactsDir?: string;
    metadataPath: string;
    archiveFileName: string;
    archiveSha256: string;
    projectName: string;
    appId: string;
  };
  verification: {
    environment: string;
    operator: string;
    recordedAt: string;
    status: VerificationStatus;
    summary: string;
    packageInstall: {
      status: VerificationStatus;
      summary: string;
    };
    firstLaunch: {
      status: VerificationStatus;
      summary: string;
    };
    evidence: string[];
  };
}

function fail(message: string): never {
  throw new Error(message);
}

function parseStatus(value: string | undefined, flag: string): VerificationStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "passed" || value === "failed") {
    return value;
  }
  fail(`Unsupported ${flag} value: ${value}`);
}

function parseArgs(argv: string[]): Args {
  let artifactsDir: string | undefined;
  let metadataPath: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let environment: string | undefined;
  let operator: string | undefined;
  let recordedAt: string | undefined;
  let status: VerificationStatus | undefined;
  let installStatus: VerificationStatus | undefined;
  let launchStatus: VerificationStatus | undefined;
  let summary: string | undefined;
  let installSummary: string | undefined;
  let launchSummary: string | undefined;
  const evidence: string[] = [];

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--artifacts-dir" && next) {
      artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--metadata" && next) {
      metadataPath = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--candidate" && next) {
      candidate = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--candidate-revision" && next) {
      candidateRevision = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--environment" && next) {
      environment = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--operator" && next) {
      operator = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--recorded-at" && next) {
      recordedAt = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--status" && next) {
      status = parseStatus(next.trim(), "--status");
      index += 1;
      continue;
    }
    if (arg === "--install-status" && next) {
      installStatus = parseStatus(next.trim(), "--install-status");
      index += 1;
      continue;
    }
    if (arg === "--launch-status" && next) {
      launchStatus = parseStatus(next.trim(), "--launch-status");
      index += 1;
      continue;
    }
    if (arg === "--summary" && next) {
      summary = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--install-summary" && next) {
      installSummary = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--launch-summary" && next) {
      launchSummary = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--evidence" && next) {
      const value = next.trim();
      if (value) {
        evidence.push(value);
      }
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(artifactsDir ? { artifactsDir } : {}),
    ...(metadataPath ? { metadataPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    ...(environment ? { environment } : {}),
    ...(operator ? { operator } : {}),
    ...(recordedAt ? { recordedAt } : {}),
    ...(status ? { status } : {}),
    ...(installStatus ? { installStatus } : {}),
    ...(launchStatus ? { launchStatus } : {}),
    ...(summary ? { summary } : {}),
    ...(installSummary ? { installSummary } : {}),
    ...(launchSummary ? { launchSummary } : {}),
    evidence
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

function resolveMetadataPath(args: Args): string {
  if (args.metadataPath) {
    return path.resolve(args.metadataPath);
  }
  if (!args.artifactsDir) {
    fail("Pass either --artifacts-dir <dir> or --metadata <package.json>.");
  }

  const resolvedArtifactsDir = path.resolve(args.artifactsDir);
  if (!fs.existsSync(resolvedArtifactsDir)) {
    fail(`Artifacts directory does not exist: ${resolvedArtifactsDir}`);
  }

  const sidecars = fs
    .readdirSync(resolvedArtifactsDir)
    .filter((entry) => entry.endsWith(".package.json"))
    .sort();
  if (sidecars.length !== 1) {
    fail(`Expected exactly one release sidecar in ${resolvedArtifactsDir}, found ${sidecars.length}.`);
  }

  return path.join(resolvedArtifactsDir, sidecars[0]!);
}

function defaultOutputPath(metadataPath: string): string {
  return path.join(path.dirname(metadataPath), "codex.wechat.install-launch-evidence.json");
}

function defaultMarkdownOutputPath(metadataPath: string): string {
  return path.join(path.dirname(metadataPath), "codex.wechat.install-launch-evidence.md");
}

function validateMetadata(metadata: WechatMinigameReleasePackageMetadata): void {
  if (metadata.schemaVersion !== 1) {
    fail(`Release sidecar schemaVersion must be 1, received ${JSON.stringify(metadata.schemaVersion)}.`);
  }
  if (metadata.buildTemplatePlatform !== "wechatgame") {
    fail(`Release sidecar buildTemplatePlatform must be "wechatgame", received ${JSON.stringify(metadata.buildTemplatePlatform)}.`);
  }
  if (!metadata.projectName?.trim()) {
    fail("Release sidecar is missing projectName.");
  }
  if (!metadata.appId?.trim()) {
    fail("Release sidecar is missing appId.");
  }
  if (!metadata.archiveFileName?.trim()) {
    fail("Release sidecar is missing archiveFileName.");
  }
  if (!metadata.archiveSha256?.trim()) {
    fail("Release sidecar is missing archiveSha256.");
  }
}

function renderMarkdown(report: WechatPackageInstallLaunchEvidence): string {
  const lines: string[] = [];
  lines.push("# WeChat Package Install/Launch Verification", "");
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Revision: \`${report.candidate.revision}\``);
  lines.push(`- Environment: \`${report.verification.environment}\``);
  lines.push(`- Operator: \`${report.verification.operator}\``);
  lines.push(`- Recorded at: \`${report.verification.recordedAt}\``);
  lines.push(`- Status: \`${report.verification.status}\``, "");
  lines.push("## Steps", "");
  lines.push(`- Package install/import: \`${report.verification.packageInstall.status}\` - ${report.verification.packageInstall.summary}`);
  lines.push(`- First launch: \`${report.verification.firstLaunch.status}\` - ${report.verification.firstLaunch.summary}`, "");
  lines.push("## Artifact", "");
  lines.push(`- Project: \`${report.artifact.projectName}\``);
  lines.push(`- App ID: \`${report.artifact.appId}\``);
  lines.push(`- Archive: \`${report.artifact.archiveFileName}\``);
  lines.push(`- Metadata: \`${path.relative(process.cwd(), report.artifact.metadataPath).replace(/\\/g, "/")}\``, "");
  lines.push("## Evidence", "");
  if (report.verification.evidence.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const entry of report.verification.evidence) {
      lines.push(`- ${entry}`);
    }
  }
  lines.push("", "## Summary", "", report.verification.summary);
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const args = parseArgs(process.argv);
  const metadataPath = resolveMetadataPath(args);
  const metadata = readJsonFile<WechatMinigameReleasePackageMetadata>(metadataPath);
  validateMetadata(metadata);

  const candidate = args.candidate?.trim();
  if (!candidate) {
    fail("Pass --candidate <candidate-name>.");
  }
  const revision = args.candidateRevision?.trim() || metadata.sourceRevision?.trim();
  if (!revision) {
    fail("Pass --candidate-revision <git-sha> or package with --source-revision <git-sha> first.");
  }
  const environment = args.environment?.trim();
  if (!environment) {
    fail("Pass --environment <environment-name>.");
  }
  const operator = args.operator?.trim();
  if (!operator) {
    fail("Pass --operator <name>.");
  }

  const recordedAt = args.recordedAt?.trim() || new Date().toISOString();
  if (Number.isNaN(Date.parse(recordedAt))) {
    fail(`Invalid --recorded-at timestamp: ${recordedAt}`);
  }

  const overallStatus = args.status ?? (args.installStatus === "failed" || args.launchStatus === "failed" ? "failed" : undefined);
  if (!overallStatus) {
    fail("Pass --status <passed|failed> or explicitly set --install-status/--launch-status.");
  }
  const packageInstallStatus = args.installStatus ?? overallStatus;
  const firstLaunchStatus = args.launchStatus ?? overallStatus;
  const summary =
    args.summary?.trim() ||
    (overallStatus === "passed"
      ? "Candidate-scoped WeChat package install/import and first-launch verification passed."
      : "Candidate-scoped WeChat package install/import or first-launch verification failed.");

  const report: WechatPackageInstallLaunchEvidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: candidate,
      revision,
      shortRevision: revision.slice(0, 12)
    },
    artifact: {
      ...(args.artifactsDir ? { artifactsDir: path.resolve(args.artifactsDir) } : {}),
      metadataPath,
      archiveFileName: metadata.archiveFileName,
      archiveSha256: metadata.archiveSha256,
      projectName: metadata.projectName,
      appId: metadata.appId
    },
    verification: {
      environment,
      operator,
      recordedAt,
      status: packageInstallStatus === "failed" || firstLaunchStatus === "failed" ? "failed" : overallStatus,
      summary,
      packageInstall: {
        status: packageInstallStatus,
        summary:
          args.installSummary?.trim() ||
          (packageInstallStatus === "passed"
            ? "Imported the packaged WeChat candidate into the verification environment."
            : "Package install/import failed in the verification environment.")
      },
      firstLaunch: {
        status: firstLaunchStatus,
        summary:
          args.launchSummary?.trim() ||
          (firstLaunchStatus === "passed"
            ? "Launched the imported package and observed the expected first-launch behavior."
            : "First launch failed or regressed for the imported package.")
      },
      evidence: args.evidence
    }
  };

  const outputPath = path.resolve(args.outputPath ?? defaultOutputPath(metadataPath));
  const markdownOutputPath = path.resolve(args.markdownOutputPath ?? defaultMarkdownOutputPath(metadataPath));

  writeJsonFile(outputPath, report);
  writeFile(markdownOutputPath, renderMarkdown(report));

  console.log(`Wrote WeChat install/launch evidence: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
  console.log(`Wrote WeChat install/launch evidence markdown: ${path.relative(process.cwd(), markdownOutputPath).replace(/\\/g, "/")}`);
  console.log(`Candidate: ${report.candidate.name}`);
  console.log(`Revision: ${report.candidate.revision}`);
  console.log(`Status: ${report.verification.status}`);
}

main();
