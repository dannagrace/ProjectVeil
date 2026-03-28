import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface Args {
  artifactsDir?: string;
  archivePath?: string;
  metadataPath?: string;
  expectedRevision?: string;
  keepExtracted: boolean;
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

interface WechatMinigameReleaseManifestFile {
  relativePath: string;
  bytes: number;
  sha256: string;
}

interface WechatMinigameReleaseManifest {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  projectName: string;
  appId: string;
  buildOutputDir: string;
  sourceRevision?: string;
  runtimeRemoteUrl?: string;
  remoteAssetRoot?: string;
  packageSizes: {
    totalBytes: number;
    mainPackageBytes: number;
    totalSubpackageBytes: number;
  };
  warnings: string[];
  files: WechatMinigameReleaseManifestFile[];
}

const REQUIRED_SMOKE_FILES = [
  "game.json",
  "project.config.json",
  "codex.wechat.build.json",
  "README.codex.md",
  "codex.wechat.release.json",
  "game.js",
  "application.js",
  "src/settings.json"
] as const;

function parseArgs(argv: string[]): Args {
  let artifactsDir: string | undefined;
  let archivePath: string | undefined;
  let metadataPath: string | undefined;
  let expectedRevision: string | undefined;
  let keepExtracted = false;

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
    if (arg === "--expected-revision" && next) {
      expectedRevision = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--keep-extracted") {
      keepExtracted = true;
    }
  }

  return {
    ...(artifactsDir ? { artifactsDir } : {}),
    ...(archivePath ? { archivePath } : {}),
    ...(metadataPath ? { metadataPath } : {}),
    ...(expectedRevision ? { expectedRevision } : {}),
    keepExtracted
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function hashFileSha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fail(message: string): never {
  throw new Error(message);
}

function listFilesRecursively(rootDir: string, currentDir = rootDir): Array<{ relativePath: string; bytes: number }> {
  const entries = fs
    .readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: Array<{ relativePath: string; bytes: number }> = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(rootDir, fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const stats = fs.statSync(fullPath);
    files.push({
      relativePath: path.relative(rootDir, fullPath).replace(/\\/g, "/"),
      bytes: stats.size
    });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
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

  const [archiveFileName] = archives;
  const [sidecarFileName] = sidecars;

  return {
    archivePath: path.join(resolvedArtifactsDir, archiveFileName),
    metadataPath: path.join(resolvedArtifactsDir, sidecarFileName)
  };
}

function resolveInputArtifacts(args: Args): { archivePath: string; metadataPath: string } {
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

function verifyRevision(
  expectedRevision: string | undefined,
  metadataRevision: string | undefined,
  manifestRevision: string | undefined
): void {
  if (metadataRevision && manifestRevision && metadataRevision !== manifestRevision) {
    fail(`Revision mismatch between sidecar and release manifest: ${metadataRevision} !== ${manifestRevision}`);
  }

  if (expectedRevision) {
    if (!metadataRevision) {
      fail(`Release sidecar is missing sourceRevision; expected ${expectedRevision}.`);
    }
    if (!manifestRevision) {
      fail(`Release manifest is missing sourceRevision; expected ${expectedRevision}.`);
    }
    if (metadataRevision !== expectedRevision || manifestRevision !== expectedRevision) {
      fail(
        `Release revision mismatch: expected ${expectedRevision}, sidecar=${metadataRevision}, manifest=${manifestRevision}`
      );
    }
  }
}

function verifySmokeFiles(buildDir: string): void {
  for (const relativePath of REQUIRED_SMOKE_FILES) {
    const filePath = path.join(buildDir, relativePath);
    if (!fs.existsSync(filePath)) {
      fail(`Smoke validation failed: required file is missing from release payload: ${relativePath}`);
    }
  }
}

function verifyBuildMetadataConsistency(
  buildDir: string,
  metadata: WechatMinigameReleasePackageMetadata,
  manifest: WechatMinigameReleaseManifest
): void {
  const projectConfig = readJsonFile<{ projectname?: string; appid?: string; compileType?: string }>(
    path.join(buildDir, "project.config.json")
  );
  const buildManifest = readJsonFile<{ buildTemplatePlatform?: string; projectName?: string; buildOutputDir?: string }>(
    path.join(buildDir, "codex.wechat.build.json")
  );

  if (projectConfig.projectname !== manifest.projectName || projectConfig.projectname !== metadata.projectName) {
    fail("project.config.json projectname does not match release sidecar/manifest.");
  }
  if (projectConfig.appid !== manifest.appId || projectConfig.appid !== metadata.appId) {
    fail("project.config.json appid does not match release sidecar/manifest.");
  }
  if (projectConfig.compileType !== "game") {
    fail(`project.config.json compileType must be "game", received ${JSON.stringify(projectConfig.compileType)}.`);
  }
  if (buildManifest.buildTemplatePlatform !== "wechatgame") {
    fail(
      `codex.wechat.build.json buildTemplatePlatform must be "wechatgame", received ${JSON.stringify(buildManifest.buildTemplatePlatform)}.`
    );
  }
  if (buildManifest.projectName !== manifest.projectName) {
    fail("codex.wechat.build.json projectName does not match release manifest.");
  }
}

function verifyManifestFiles(
  buildDir: string,
  metadata: WechatMinigameReleasePackageMetadata,
  manifest: WechatMinigameReleaseManifest
): void {
  if (metadata.fileCount !== manifest.files.length) {
    fail(`Sidecar fileCount mismatch: expected ${metadata.fileCount}, manifest listed ${manifest.files.length}.`);
  }

  const actualFiles = listFilesRecursively(buildDir);
  const actualFilesWithoutManifest = actualFiles.filter((file) => file.relativePath !== "codex.wechat.release.json");
  const actualTotalBytes = actualFilesWithoutManifest.reduce((sum, file) => sum + file.bytes, 0);
  if (actualTotalBytes !== manifest.packageSizes.totalBytes) {
    fail(
      `Manifest packageSizes.totalBytes mismatch: expected ${manifest.packageSizes.totalBytes}, actual ${actualTotalBytes}.`
    );
  }

  const manifestEntries = new Map(manifest.files.map((file) => [file.relativePath, file]));
  for (const file of actualFilesWithoutManifest) {
    const manifestEntry = manifestEntries.get(file.relativePath);
    if (!manifestEntry) {
      fail(`Release manifest is missing file entry: ${file.relativePath}`);
    }
    if (manifestEntry.bytes !== file.bytes) {
      fail(`Release manifest byte count mismatch for ${file.relativePath}: ${manifestEntry.bytes} !== ${file.bytes}`);
    }
    const actualSha = hashFileSha256(path.join(buildDir, file.relativePath));
    if (manifestEntry.sha256 !== actualSha) {
      fail(`Release manifest SHA-256 mismatch for ${file.relativePath}.`);
    }
  }

  for (const relativePath of manifestEntries.keys()) {
    if (!actualFilesWithoutManifest.some((file) => file.relativePath === relativePath)) {
      fail(`Release payload is missing manifest-listed file: ${relativePath}`);
    }
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const { archivePath, metadataPath } = resolveInputArtifacts(args);

  const metadata = readJsonFile<WechatMinigameReleasePackageMetadata>(metadataPath);
  if (metadata.schemaVersion !== 1 || metadata.buildTemplatePlatform !== "wechatgame") {
    fail(`Unsupported WeChat release sidecar: ${metadataPath}`);
  }

  if (path.basename(archivePath) !== metadata.archiveFileName) {
    fail(`Sidecar archiveFileName mismatch: ${metadata.archiveFileName} !== ${path.basename(archivePath)}`);
  }

  const archiveStats = fs.statSync(archivePath);
  if (archiveStats.size !== metadata.archiveBytes) {
    fail(`Sidecar archiveBytes mismatch: ${metadata.archiveBytes} !== ${archiveStats.size}`);
  }

  const archiveSha = hashFileSha256(archivePath);
  if (archiveSha !== metadata.archiveSha256) {
    fail(`Sidecar archiveSha256 mismatch for ${path.basename(archivePath)}.`);
  }

  const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-release-verify-"));
  try {
    extractArchive(archivePath, extractedRoot);

    const packageRootName = metadata.archiveFileName.replace(/\.tar\.gz$/, "");
    const packageRoot = path.join(extractedRoot, packageRootName);
    if (!fs.existsSync(packageRoot)) {
      fail(`Extracted archive root is missing: ${packageRootName}`);
    }

    const buildDir = path.join(packageRoot, metadata.packagedBuildDir);
    if (!fs.existsSync(buildDir)) {
      fail(`Packaged build directory is missing from archive: ${metadata.packagedBuildDir}`);
    }

    const releaseManifestPath = path.join(packageRoot, metadata.releaseManifestFile);
    if (!fs.existsSync(releaseManifestPath)) {
      fail(`Release manifest is missing from archive: ${metadata.releaseManifestFile}`);
    }

    const manifest = readJsonFile<WechatMinigameReleaseManifest>(releaseManifestPath);
    if (manifest.schemaVersion !== 1 || manifest.buildTemplatePlatform !== "wechatgame") {
      fail(`Unsupported WeChat release manifest: ${metadata.releaseManifestFile}`);
    }

    verifyRevision(args.expectedRevision, metadata.sourceRevision, manifest.sourceRevision);
    verifySmokeFiles(buildDir);
    verifyBuildMetadataConsistency(buildDir, metadata, manifest);
    verifyManifestFiles(buildDir, metadata, manifest);

    console.log(`Verified WeChat release archive: ${archivePath}`);
    console.log(`Smoke checklist passed for ${metadata.packagedBuildDir}`);
    console.log(`Release manifest entries: ${manifest.files.length}`);
    if (metadata.sourceRevision) {
      console.log(`Revision: ${metadata.sourceRevision}`);
    }
  } finally {
    if (args.keepExtracted) {
      console.log(`Kept extracted files at ${extractedRoot}`);
    } else {
      fs.rmSync(extractedRoot, { recursive: true, force: true });
    }
  }
}

main();
