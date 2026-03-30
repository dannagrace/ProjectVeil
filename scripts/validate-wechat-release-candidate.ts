import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type CheckStatus = "passed" | "failed" | "skipped";
type GateStatus = "passed" | "failed";

interface Args {
  artifactsDir?: string;
  archivePath?: string;
  metadataPath?: string;
  reportPath?: string;
  expectedRevision?: string;
  version?: string;
  smokeReportPath?: string;
  uploadReceiptPath?: string;
  requireSmokeReport: boolean;
}

interface WechatMinigameReleasePackageMetadata {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  projectName: string;
  appId: string;
  archiveFileName: string;
  archiveBytes: number;
  archiveSha256: string;
  releaseManifestFile: string;
  exportedBuildDir: string;
  packagedBuildDir: string;
  fileCount: number;
  sourceRevision?: string;
  runtimeRemoteUrl?: string;
  remoteAssetRoot?: string;
}

interface UploadReceipt {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  projectName: string;
  artifactArchiveFileName: string;
  artifactArchiveSha256: string;
  artifactMetadataPath: string;
  sourceRevision?: string;
  uploadVersion: string;
  uploadDescription: string;
  uploadAppId: string;
  artifactAppId: string;
  usedAppIdOverride: boolean;
  uploadRobot: number;
  uploadedAt: string;
}

interface ValidationCheck {
  id: string;
  title: string;
  status: CheckStatus;
  required: boolean;
  summary: string;
  artifactPath?: string;
  command?: string;
  exitCode?: number | null;
  stdoutTail?: string;
  stderrTail?: string;
}

interface ValidationReport {
  schemaVersion: 1;
  generatedAt: string;
  version: string | null;
  commit: string | null;
  artifact: {
    artifactsDir?: string;
    archivePath: string;
    metadataPath: string;
    smokeReportPath?: string;
    uploadReceiptPath?: string;
  };
  summary: {
    status: GateStatus;
    totalChecks: number;
    failedChecks: number;
    failureSummary: string[];
  };
  checks: ValidationCheck[];
}

const OUTPUT_TAIL_BYTES = 4000;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let artifactsDir: string | undefined;
  let archivePath: string | undefined;
  let metadataPath: string | undefined;
  let reportPath: string | undefined;
  let expectedRevision: string | undefined;
  let version: string | undefined;
  let smokeReportPath: string | undefined;
  let uploadReceiptPath: string | undefined;
  let requireSmokeReport = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--artifacts-dir" && next) {
      artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--archive" && next) {
      archivePath = next;
      index += 1;
      continue;
    }
    if (arg === "--metadata" && next) {
      metadataPath = next;
      index += 1;
      continue;
    }
    if (arg === "--report" && next) {
      reportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--expected-revision" && next) {
      expectedRevision = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--version" && next) {
      version = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--smoke-report" && next) {
      smokeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--upload-receipt" && next) {
      uploadReceiptPath = next;
      index += 1;
      continue;
    }
    if (arg === "--require-smoke-report") {
      requireSmokeReport = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(artifactsDir ? { artifactsDir } : {}),
    ...(archivePath ? { archivePath } : {}),
    ...(metadataPath ? { metadataPath } : {}),
    ...(reportPath ? { reportPath } : {}),
    ...(expectedRevision ? { expectedRevision } : {}),
    ...(version ? { version } : {}),
    ...(smokeReportPath ? { smokeReportPath } : {}),
    ...(uploadReceiptPath ? { uploadReceiptPath } : {}),
    requireSmokeReport
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

function resolveArtifactsFromDirectory(artifactsDir: string): { artifactsDir: string; archivePath: string; metadataPath: string } {
  const resolvedArtifactsDir = path.resolve(artifactsDir);
  if (!fs.existsSync(resolvedArtifactsDir)) {
    fail(`Artifacts directory does not exist: ${resolvedArtifactsDir}`);
  }

  const entries = fs.readdirSync(resolvedArtifactsDir);
  const archives = entries.filter((entry) => entry.endsWith(".tar.gz")).sort();
  const sidecars = entries.filter((entry) => entry.endsWith(".package.json")).sort();
  if (archives.length !== 1) {
    fail(`Expected exactly one release archive in ${resolvedArtifactsDir}, found ${archives.length}.`);
  }
  if (sidecars.length !== 1) {
    fail(`Expected exactly one release sidecar in ${resolvedArtifactsDir}, found ${sidecars.length}.`);
  }

  const archiveFileName = archives[0];
  const sidecarFileName = sidecars[0];
  if (!archiveFileName || !sidecarFileName) {
    fail(`Unable to resolve release archive and sidecar in ${resolvedArtifactsDir}.`);
  }

  return {
    artifactsDir: resolvedArtifactsDir,
    archivePath: path.join(resolvedArtifactsDir, archiveFileName),
    metadataPath: path.join(resolvedArtifactsDir, sidecarFileName)
  };
}

function resolveArtifacts(args: Args): { artifactsDir?: string; archivePath: string; metadataPath: string } {
  if (args.artifactsDir) {
    return resolveArtifactsFromDirectory(args.artifactsDir);
  }
  if (!args.archivePath || !args.metadataPath) {
    fail("Pass either --artifacts-dir <dir> or both --archive <tar.gz> and --metadata <package.json>.");
  }

  return {
    archivePath: path.resolve(args.archivePath),
    metadataPath: path.resolve(args.metadataPath)
  };
}

function defaultReportPath(artifactsDir: string | undefined, metadataPath: string): string {
  if (artifactsDir) {
    return path.join(artifactsDir, "codex.wechat.rc-validation-report.json");
  }
  return path.join(path.dirname(metadataPath), "codex.wechat.rc-validation-report.json");
}

function validatePackageMetadataShape(metadata: WechatMinigameReleasePackageMetadata, archivePath: string): void {
  if (metadata.schemaVersion !== 1) {
    fail(`Release sidecar schemaVersion must be 1, received ${JSON.stringify(metadata.schemaVersion)}.`);
  }
  if (metadata.buildTemplatePlatform !== "wechatgame") {
    fail(
      `Release sidecar buildTemplatePlatform must be "wechatgame", received ${JSON.stringify(metadata.buildTemplatePlatform)}.`
    );
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
  if (!metadata.archiveSha256 || !/^[a-f0-9]{64}$/.test(metadata.archiveSha256)) {
    fail("Release sidecar archiveSha256 must be a 64-character lowercase hex string.");
  }
  if (!Number.isFinite(metadata.archiveBytes) || metadata.archiveBytes <= 0) {
    fail(`Release sidecar archiveBytes must be a positive number, received ${JSON.stringify(metadata.archiveBytes)}.`);
  }
  if (!metadata.releaseManifestFile?.trim()) {
    fail("Release sidecar is missing releaseManifestFile.");
  }
  if (!metadata.packagedBuildDir?.trim()) {
    fail("Release sidecar is missing packagedBuildDir.");
  }
  if (!Number.isInteger(metadata.fileCount) || metadata.fileCount <= 0) {
    fail(`Release sidecar fileCount must be a positive integer, received ${JSON.stringify(metadata.fileCount)}.`);
  }
  if (path.basename(archivePath) !== metadata.archiveFileName) {
    fail(`Release sidecar archiveFileName mismatch: ${metadata.archiveFileName} !== ${path.basename(archivePath)}`);
  }
}

function resolveOptionalArtifactPath(explicitPath: string | undefined, fallbackPath: string): string | undefined {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return fs.existsSync(fallbackPath) ? fallbackPath : undefined;
}

function runCommandCheck(
  title: string,
  artifactPath: string | undefined,
  args: string[]
): ValidationCheck {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });

  const stderrTail = tailText(result.stderr);
  const stdoutTail = tailText(result.stdout);
  if (result.error) {
    return {
      id: title,
      title,
      status: "failed",
      required: true,
      summary: result.error.message,
      ...(artifactPath ? { artifactPath } : {}),
      command: [process.execPath, ...args].join(" "),
      exitCode: result.status,
      ...(stdoutTail ? { stdoutTail } : {}),
      ...(stderrTail ? { stderrTail } : {})
    };
  }

  if (result.status !== 0) {
    return {
      id: title,
      title,
      status: "failed",
      required: true,
      summary: stderrTail ?? stdoutTail ?? `Command exited with code ${result.status}.`,
      ...(artifactPath ? { artifactPath } : {}),
      command: [process.execPath, ...args].join(" "),
      exitCode: result.status,
      ...(stdoutTail ? { stdoutTail } : {}),
      ...(stderrTail ? { stderrTail } : {})
    };
  }

  return {
    id: title,
    title,
    status: "passed",
    required: true,
    summary: "ok",
    ...(artifactPath ? { artifactPath } : {}),
    command: [process.execPath, ...args].join(" "),
    exitCode: result.status,
    ...(stdoutTail ? { stdoutTail } : {}),
    ...(stderrTail ? { stderrTail } : {})
  };
}

function validateUploadReceipt(
  uploadReceiptPath: string,
  metadata: WechatMinigameReleasePackageMetadata,
  metadataPath: string,
  expectedVersion?: string,
  expectedRevision?: string
): ValidationCheck {
  const receipt = readJsonFile<UploadReceipt>(uploadReceiptPath);
  if (receipt.schemaVersion !== 1) {
    fail(`Upload receipt schemaVersion must be 1, received ${JSON.stringify(receipt.schemaVersion)}.`);
  }
  if (receipt.buildTemplatePlatform !== "wechatgame") {
    fail(
      `Upload receipt buildTemplatePlatform must be "wechatgame", received ${JSON.stringify(receipt.buildTemplatePlatform)}.`
    );
  }
  if (!receipt.uploadVersion?.trim()) {
    fail("Upload receipt is missing uploadVersion.");
  }
  if (!receipt.uploadedAt?.trim()) {
    fail("Upload receipt is missing uploadedAt.");
  }
  if (receipt.projectName !== metadata.projectName) {
    fail(`Upload receipt projectName mismatch: ${receipt.projectName} !== ${metadata.projectName}`);
  }
  if (receipt.artifactArchiveFileName !== metadata.archiveFileName) {
    fail(
      `Upload receipt artifactArchiveFileName mismatch: ${receipt.artifactArchiveFileName} !== ${metadata.archiveFileName}`
    );
  }
  if (receipt.artifactArchiveSha256 !== metadata.archiveSha256) {
    fail("Upload receipt artifactArchiveSha256 does not match release sidecar.");
  }

  const expectedMetadataRelativePath = path.relative(process.cwd(), metadataPath).replace(/\\/g, "/");
  if (receipt.artifactMetadataPath !== expectedMetadataRelativePath) {
    fail(
      `Upload receipt artifactMetadataPath mismatch: ${receipt.artifactMetadataPath} !== ${expectedMetadataRelativePath}`
    );
  }
  if (expectedVersion && receipt.uploadVersion !== expectedVersion) {
    fail(`Release candidate version mismatch: expected ${expectedVersion}, receipt=${receipt.uploadVersion}`);
  }
  if (metadata.sourceRevision && receipt.sourceRevision && metadata.sourceRevision !== receipt.sourceRevision) {
    fail(
      `Revision mismatch between release sidecar and upload receipt: ${metadata.sourceRevision} !== ${receipt.sourceRevision}`
    );
  }
  if (expectedRevision) {
    if (!receipt.sourceRevision) {
      fail(`Upload receipt is missing sourceRevision; expected ${expectedRevision}.`);
    }
    if (receipt.sourceRevision !== expectedRevision) {
      fail(`Release candidate commit mismatch: expected ${expectedRevision}, receipt=${receipt.sourceRevision}`);
    }
  }

  return {
    id: "upload-receipt",
    title: "Upload receipt validation",
    status: "passed",
    required: Boolean(expectedVersion),
    summary: "ok",
    artifactPath: uploadReceiptPath
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const checks: ValidationCheck[] = [];
  const artifacts = resolveArtifacts(args);
  const metadata = readJsonFile<WechatMinigameReleasePackageMetadata>(artifacts.metadataPath);
  const smokeReportPath = resolveOptionalArtifactPath(
    args.smokeReportPath,
    path.join(artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath), "codex.wechat.smoke-report.json")
  );
  const uploadReceiptPath = resolveOptionalArtifactPath(
    args.uploadReceiptPath,
    path.join(
      artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath),
      `${path.basename(artifacts.metadataPath, ".package.json")}.upload.json`
    )
  );
  const reportPath = path.resolve(args.reportPath ?? defaultReportPath(artifacts.artifactsDir, artifacts.metadataPath));
  const commit = metadata.sourceRevision ?? args.expectedRevision ?? null;
  let version = args.version ?? null;
  let exitCode = 0;

  try {
    validatePackageMetadataShape(metadata, artifacts.archivePath);
    checks.push({
      id: "package-sidecar",
      title: "Release sidecar metadata",
      status: "passed",
      required: true,
      summary: "ok",
      artifactPath: artifacts.metadataPath
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      id: "package-sidecar",
      title: "Release sidecar metadata",
      status: "failed",
      required: true,
      summary: message,
      artifactPath: artifacts.metadataPath
    });
    exitCode = 1;
  }

  const verifyArgs = [
    "--import",
    "tsx",
    "./scripts/verify-wechat-minigame-artifact.ts",
    "--archive",
    artifacts.archivePath,
    "--metadata",
    artifacts.metadataPath
  ];
  if (args.expectedRevision) {
    verifyArgs.push("--expected-revision", args.expectedRevision);
  }
  const verifyCheck = runCommandCheck("artifact-verify", artifacts.archivePath, verifyArgs);
  verifyCheck.id = "artifact-verify";
  verifyCheck.title = "Release archive verification";
  checks.push(verifyCheck);
  if (verifyCheck.status === "failed") {
    exitCode = 1;
  }

  if (smokeReportPath) {
    const smokeArgs = [
      "--import",
      "tsx",
      "./scripts/smoke-wechat-minigame-release.ts",
      "--metadata",
      artifacts.metadataPath,
      "--report",
      smokeReportPath,
      "--check"
    ];
    if (args.expectedRevision) {
      smokeArgs.push("--expected-revision", args.expectedRevision);
    }
    const smokeCheck = runCommandCheck("smoke-report", smokeReportPath, smokeArgs);
    smokeCheck.id = "smoke-report";
    smokeCheck.title = "Smoke report validation";
    smokeCheck.required = args.requireSmokeReport;
    if (smokeCheck.status === "failed" || args.requireSmokeReport) {
      checks.push(smokeCheck);
      if (smokeCheck.status === "failed") {
        exitCode = 1;
      }
    } else {
      checks.push(smokeCheck);
    }
  } else if (args.requireSmokeReport) {
    checks.push({
      id: "smoke-report",
      title: "Smoke report validation",
      status: "failed",
      required: true,
      summary: "Required smoke report is missing.",
      artifactPath: path.join(artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath), "codex.wechat.smoke-report.json")
    });
    exitCode = 1;
  } else {
    checks.push({
      id: "smoke-report",
      title: "Smoke report validation",
      status: "skipped",
      required: false,
      summary: "Smoke report not present.",
      artifactPath: path.join(artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath), "codex.wechat.smoke-report.json")
    });
  }

  if (uploadReceiptPath) {
    try {
      const uploadCheck = validateUploadReceipt(
        uploadReceiptPath,
        metadata,
        artifacts.metadataPath,
        args.version,
        args.expectedRevision
      );
      const receipt = readJsonFile<UploadReceipt>(uploadReceiptPath);
      version = receipt.uploadVersion;
      checks.push(uploadCheck);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        id: "upload-receipt",
        title: "Upload receipt validation",
        status: "failed",
        required: Boolean(args.version),
        summary: message,
        artifactPath: uploadReceiptPath
      });
      exitCode = 1;
    }
  } else if (args.version) {
    checks.push({
      id: "upload-receipt",
      title: "Upload receipt validation",
      status: "failed",
      required: true,
      summary: `Upload receipt is required to validate release candidate version ${args.version}.`,
      artifactPath: path.join(
        artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath),
        `${path.basename(artifacts.metadataPath, ".package.json")}.upload.json`
      )
    });
    exitCode = 1;
  } else {
    checks.push({
      id: "upload-receipt",
      title: "Upload receipt validation",
      status: "skipped",
      required: false,
      summary: "Upload receipt not present.",
      artifactPath: path.join(
        artifacts.artifactsDir ?? path.dirname(artifacts.metadataPath),
        `${path.basename(artifacts.metadataPath, ".package.json")}.upload.json`
      )
    });
  }

  const failedChecks = checks.filter((check) => check.status === "failed");
  const report: ValidationReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version,
    commit,
    artifact: {
      ...(artifacts.artifactsDir ? { artifactsDir: artifacts.artifactsDir } : {}),
      archivePath: artifacts.archivePath,
      metadataPath: artifacts.metadataPath,
      ...(smokeReportPath ? { smokeReportPath } : {}),
      ...(uploadReceiptPath ? { uploadReceiptPath } : {})
    },
    summary: {
      status: failedChecks.length > 0 ? "failed" : "passed",
      totalChecks: checks.length,
      failedChecks: failedChecks.length,
      failureSummary: failedChecks.map((check) => `${check.id}: ${check.summary}`)
    },
    checks
  };

  writeJsonFile(reportPath, report);
  console.log(`Wrote release candidate validation report: ${path.relative(process.cwd(), reportPath).replace(/\\/g, "/")}`);
  console.log(`Artifact: ${path.relative(process.cwd(), artifacts.archivePath).replace(/\\/g, "/")}`);
  console.log(`Commit: ${commit ?? "unknown"}`);
  console.log(`Version: ${version ?? "unknown"}`);
  console.log(`Result: ${report.summary.status}`);

  if (failedChecks.length > 0) {
    console.error("Failures:");
    for (const failure of report.summary.failureSummary) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = exitCode || 1;
    return;
  }
}

main();
