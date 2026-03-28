import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface Args {
  artifactsDir?: string;
  archivePath?: string;
  metadataPath?: string;
  version?: string;
  desc?: string;
  appId?: string;
  privateKeyPath?: string;
  robot?: number;
  summaryPath?: string;
  receiptPath?: string;
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
  strUint64Version?: string;
  subPackageInfo?: Array<{ name: string; size: number }>;
  pluginInfo?: Array<{ pluginProviderAppid: string; version: string; size: number }>;
  github?: {
    repository?: string;
    runId?: string;
    runAttempt?: string;
    workflow?: string;
    ref?: string;
    sha?: string;
  };
}

function parseArgs(argv: string[]): Args {
  let artifactsDir: string | undefined;
  let archivePath: string | undefined;
  let metadataPath: string | undefined;
  let version: string | undefined;
  let desc: string | undefined;
  let appId: string | undefined;
  let privateKeyPath: string | undefined;
  let robot: number | undefined;
  let summaryPath: string | undefined;
  let receiptPath: string | undefined;

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
    if (arg === "--version" && next) {
      version = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--desc" && next) {
      desc = next;
      index += 1;
      continue;
    }
    if (arg === "--appid" && next) {
      appId = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--private-key-path" && next) {
      privateKeyPath = next;
      index += 1;
      continue;
    }
    if (arg === "--robot" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed)) {
        robot = parsed;
      }
      index += 1;
      continue;
    }
    if (arg === "--github-summary" && next) {
      summaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--receipt-path" && next) {
      receiptPath = next;
      index += 1;
      continue;
    }
  }

  const parsedArgs: Args = {};
  if (artifactsDir) {
    parsedArgs.artifactsDir = artifactsDir;
  }
  if (archivePath) {
    parsedArgs.archivePath = archivePath;
  }
  if (metadataPath) {
    parsedArgs.metadataPath = metadataPath;
  }
  if (version) {
    parsedArgs.version = version;
  }
  if (desc) {
    parsedArgs.desc = desc;
  }
  if (appId) {
    parsedArgs.appId = appId;
  }
  if (privateKeyPath) {
    parsedArgs.privateKeyPath = privateKeyPath;
  }
  if (typeof robot === "number") {
    parsedArgs.robot = robot;
  }
  if (summaryPath) {
    parsedArgs.summaryPath = summaryPath;
  }
  if (receiptPath) {
    parsedArgs.receiptPath = receiptPath;
  }
  return parsedArgs;
}

function fail(message: string): never {
  throw new Error(message);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveArtifactsFromDirectory(artifactsDir: string): { archivePath: string; metadataPath: string } {
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
    archivePath: path.join(resolvedArtifactsDir, archiveFileName),
    metadataPath: path.join(resolvedArtifactsDir, sidecarFileName)
  };
}

function resolveArtifacts(args: Args): { archivePath: string; metadataPath: string } {
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

function resolveReceiptPath(args: Args, metadataPath: string): string {
  if (args.receiptPath) {
    return path.resolve(args.receiptPath);
  }

  const metadataBaseName = path.basename(metadataPath, ".package.json");
  return path.join(path.dirname(metadataPath), `${metadataBaseName}.upload.json`);
}

function runVerifyScript(artifacts: { archivePath: string; metadataPath: string }): void {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "./scripts/verify-wechat-minigame-artifact.ts", "--archive", artifacts.archivePath, "--metadata", artifacts.metadataPath],
    {
      cwd: process.cwd(),
      stdio: "inherit"
    }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    fail("WeChat release artifact verification failed before upload.");
  }
}

function extractArchive(archivePath: string, targetDir: string): void {
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", targetDir], {
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    fail(result.stderr.trim() || `tar failed while extracting ${archivePath}`);
  }
}

function listDirectories(rootDir: string): string[] {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function resolveBuildDir(extractedRoot: string, packagedBuildDir: string): string {
  const packageDirs = listDirectories(extractedRoot);
  if (packageDirs.length !== 1) {
    fail(`Expected exactly one extracted package root in ${extractedRoot}, found ${packageDirs.length}.`);
  }

  const packageRoot = packageDirs[0];
  if (!packageRoot) {
    fail(`Unable to resolve extracted package root in ${extractedRoot}.`);
  }
  const buildDir = path.join(packageRoot, packagedBuildDir);
  if (!fs.existsSync(buildDir)) {
    fail(`Packaged build directory is missing from extracted archive: ${buildDir}`);
  }
  return buildDir;
}

function writeTempPrivateKey(rawPrivateKey: string): { privateKeyPath: string; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-private-key-"));
  const privateKeyPath = path.join(tempDir, "private.key");
  fs.writeFileSync(privateKeyPath, rawPrivateKey, { encoding: "utf8", mode: 0o600 });
  return {
    privateKeyPath,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true })
  };
}

function resolveCredentials(args: Args): {
  appId: string;
  robot: number;
  desc?: string;
  privateKeyPath: string;
  cleanup: () => void;
} {
  const appId = args.appId ?? process.env.WECHAT_MINIPROGRAM_APPID?.trim();
  if (!appId) {
    fail("Missing WeChat appid. Pass --appid or set WECHAT_MINIPROGRAM_APPID.");
  }

  const robotValue = args.robot ?? Number.parseInt(process.env.WECHAT_MINIPROGRAM_ROBOT ?? "1", 10);
  const robot = Number.isFinite(robotValue) ? robotValue : 1;
  const desc = args.desc ?? process.env.WECHAT_MINIPROGRAM_DESC;
  const privateKeyPathFromArg = args.privateKeyPath ?? process.env.WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH;
  if (privateKeyPathFromArg) {
    const resolvedPath = path.resolve(privateKeyPathFromArg);
    if (!fs.existsSync(resolvedPath)) {
      fail(`WeChat private key file does not exist: ${resolvedPath}`);
    }
    return {
      appId,
      robot,
      ...(desc ? { desc } : {}),
      privateKeyPath: resolvedPath,
      cleanup: () => {}
    };
  }

  const rawPrivateKey = process.env.WECHAT_MINIPROGRAM_PRIVATE_KEY;
  if (rawPrivateKey && rawPrivateKey.trim().length > 0) {
    const tempKey = writeTempPrivateKey(rawPrivateKey);
    return {
      appId,
      robot,
      ...(desc ? { desc } : {}),
      privateKeyPath: tempKey.privateKeyPath,
      cleanup: tempKey.cleanup
    };
  }

  const base64PrivateKey = process.env.WECHAT_MINIPROGRAM_PRIVATE_KEY_BASE64;
  if (base64PrivateKey && base64PrivateKey.trim().length > 0) {
    const decodedPrivateKey = Buffer.from(base64PrivateKey, "base64").toString("utf8");
    const tempKey = writeTempPrivateKey(decodedPrivateKey);
    return {
      appId,
      robot,
      ...(desc ? { desc } : {}),
      privateKeyPath: tempKey.privateKeyPath,
      cleanup: tempKey.cleanup
    };
  }

  fail(
    "Missing WeChat private key. Pass --private-key-path or set WECHAT_MINIPROGRAM_PRIVATE_KEY / WECHAT_MINIPROGRAM_PRIVATE_KEY_BASE64."
  );
}

function resolveVersion(args: Args, metadata: WechatMinigameReleasePackageMetadata): string {
  const version = args.version ?? process.env.WECHAT_MINIPROGRAM_VERSION?.trim();
  if (!version) {
    const revisionSuffix = metadata.sourceRevision?.slice(0, 8);
    fail(
      `Missing WeChat upload version. Pass --version or set WECHAT_MINIPROGRAM_VERSION${revisionSuffix ? ` for revision ${revisionSuffix}` : ""}.`
    );
  }
  return version;
}

function buildDefaultDescription(
  metadata: WechatMinigameReleasePackageMetadata,
  version: string,
  robot: number,
  customDesc?: string
): string {
  if (customDesc && customDesc.trim()) {
    return customDesc.trim();
  }

  const revision = metadata.sourceRevision ? ` commit ${metadata.sourceRevision}` : "";
  return `robot ${robot} upload ${metadata.projectName} ${version}${revision}`;
}

function appendGitHubSummary(summaryPath: string, receipt: UploadReceipt): void {
  const lines = [
    "## WeChat Mini Game Upload",
    "",
    `- Version: \`${receipt.uploadVersion}\``,
    `- Commit: \`${receipt.sourceRevision ?? receipt.github?.sha ?? "unknown"}\``,
    `- Uploaded At: \`${receipt.uploadedAt}\``,
    `- AppID: \`${receipt.uploadAppId}\``,
    `- Robot: \`${receipt.uploadRobot}\``,
    `- Artifact: \`${receipt.artifactArchiveFileName}\``,
    `- Receipt: \`${path.basename(receipt.artifactMetadataPath, ".package.json")}.upload.json\``
  ];
  if (receipt.usedAppIdOverride) {
    lines.push(`- Note: upload used appid override over packaged artifact appid \`${receipt.artifactAppId}\``);
  }
  if (receipt.strUint64Version) {
    lines.push(`- WeChat Backend Version: \`${receipt.strUint64Version}\``);
  }
  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const artifacts = resolveArtifacts(args);
  const metadata = readJsonFile<WechatMinigameReleasePackageMetadata>(artifacts.metadataPath);
  const version = resolveVersion(args, metadata);
  const receiptPath = resolveReceiptPath(args, artifacts.metadataPath);
  const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-upload-"));
  const ciModule = await import("miniprogram-ci");
  const ci = ciModule as typeof import("miniprogram-ci");
  let credentials: ReturnType<typeof resolveCredentials> | null = null;

  try {
    runVerifyScript(artifacts);
    credentials = resolveCredentials(args);
    extractArchive(artifacts.archivePath, extractedRoot);
    const buildDir = resolveBuildDir(extractedRoot, metadata.packagedBuildDir);
    const uploadDescription = buildDefaultDescription(metadata, version, credentials.robot, credentials.desc);
    const project = new ci.Project({
      appid: credentials.appId,
      type: "miniGame",
      projectPath: buildDir,
      privateKeyPath: credentials.privateKeyPath
    });
    const uploadResult = await ci.upload({
      project: project as unknown as Parameters<typeof ci.upload>[0]["project"],
      version,
      desc: uploadDescription,
      robot: credentials.robot,
      onProgressUpdate(progress) {
        if (typeof progress === "string") {
          console.log(progress);
          return;
        }
        console.log(`[miniprogram-ci] ${progress.status}: ${progress.message}`);
      }
    });

    const receipt: UploadReceipt = {
      schemaVersion: 1,
      buildTemplatePlatform: "wechatgame",
      projectName: metadata.projectName,
      artifactArchiveFileName: metadata.archiveFileName,
      artifactArchiveSha256: metadata.archiveSha256,
      artifactMetadataPath: path.relative(process.cwd(), artifacts.metadataPath).replace(/\\/g, "/"),
      ...(metadata.sourceRevision ? { sourceRevision: metadata.sourceRevision } : {}),
      uploadVersion: version,
      uploadDescription,
      uploadAppId: credentials.appId,
      artifactAppId: metadata.appId,
      usedAppIdOverride: credentials.appId !== metadata.appId,
      uploadRobot: credentials.robot,
      uploadedAt: new Date().toISOString(),
      ...(uploadResult.strUint64Version ? { strUint64Version: uploadResult.strUint64Version } : {}),
      ...(uploadResult.subPackageInfo ? { subPackageInfo: uploadResult.subPackageInfo } : {}),
      ...(uploadResult.pluginInfo ? { pluginInfo: uploadResult.pluginInfo } : {}),
      github: {
        ...(process.env.GITHUB_REPOSITORY ? { repository: process.env.GITHUB_REPOSITORY } : {}),
        ...(process.env.GITHUB_RUN_ID ? { runId: process.env.GITHUB_RUN_ID } : {}),
        ...(process.env.GITHUB_RUN_ATTEMPT ? { runAttempt: process.env.GITHUB_RUN_ATTEMPT } : {}),
        ...(process.env.GITHUB_WORKFLOW ? { workflow: process.env.GITHUB_WORKFLOW } : {}),
        ...(process.env.GITHUB_REF ? { ref: process.env.GITHUB_REF } : {}),
        ...(process.env.GITHUB_SHA ? { sha: process.env.GITHUB_SHA } : {})
      }
    };

    writeJsonFile(receiptPath, receipt);
    console.log(`Uploaded WeChat mini game release version ${receipt.uploadVersion} to appid ${receipt.uploadAppId}.`);
    console.log(`Wrote upload receipt: ${path.relative(process.cwd(), receiptPath).replace(/\\/g, "/")}`);

    const summaryPath = args.summaryPath ?? process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      appendGitHubSummary(summaryPath, receipt);
    }
  } finally {
    credentials?.cleanup();
    fs.rmSync(extractedRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
