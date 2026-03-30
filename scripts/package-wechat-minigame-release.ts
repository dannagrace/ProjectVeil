import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  analyzeWechatMinigameBuildOutput,
  buildWechatMinigameReleaseManifest,
  normalizeWechatMinigameBuildConfig
} from "../apps/cocos-client/tooling/cocos-wechat-build.ts";

interface Args {
  artifactsDir: string;
  configPath: string;
  expectExportedRuntime: boolean;
  outputDir?: string;
  packageName?: string;
  sourceRevision?: string;
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

function parseArgs(argv: string[]): Args {
  let artifactsDir = "artifacts/wechat-release";
  let configPath = "apps/cocos-client/wechat-minigame.build.json";
  let expectExportedRuntime = false;
  let outputDir: string | undefined;
  let packageName: string | undefined;
  let sourceRevision: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--artifacts-dir" && next) {
      artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--config" && next) {
      configPath = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--package-name" && next) {
      packageName = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--source-revision" && next) {
      sourceRevision = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--expect-exported-runtime") {
      expectExportedRuntime = true;
    }
  }

  return {
    artifactsDir,
    configPath,
    expectExportedRuntime,
    ...(outputDir ? { outputDir } : {}),
    ...(packageName ? { packageName } : {}),
    ...(sourceRevision ? { sourceRevision } : {})
  };
}

function sanitizePackageName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "wechatgame-release";
}

function hashFileSha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runTar(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("tar", args, {
    encoding: "utf8"
  });
}

function packageBuildDirectory(stagingRoot: string, packageRootName: string, archivePath: string): void {
  const deterministicArgs = [
    "--sort=name",
    "--mtime=UTC 1970-01-01",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-czf",
    archivePath,
    "-C",
    stagingRoot,
    packageRootName
  ];
  const fallbackArgs = ["-czf", archivePath, "-C", stagingRoot, packageRootName];
  const firstAttempt = runTar(deterministicArgs);

  if (!firstAttempt.error && firstAttempt.status === 0) {
    return;
  }

  const unsupportedOptionOutput = `${firstAttempt.stderr ?? ""}\n${firstAttempt.stdout ?? ""}`;
  const canRetryPortably =
    !firstAttempt.error &&
    firstAttempt.status !== 0 &&
    /not supported|unrecognized option|unknown option|illegal option/i.test(unsupportedOptionOutput);
  if (!canRetryPortably) {
    if (firstAttempt.error) {
      throw firstAttempt.error;
    }
    throw new Error(firstAttempt.stderr.trim() || "tar failed while packaging the WeChat mini game release.");
  }

  const fallbackAttempt = runTar(fallbackArgs);
  if (fallbackAttempt.error) {
    throw fallbackAttempt.error;
  }
  if (fallbackAttempt.status !== 0) {
    throw new Error(fallbackAttempt.stderr.trim() || "tar failed while packaging the WeChat mini game release.");
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const configPath = path.resolve(repoRoot, args.configPath);
  const config = normalizeWechatMinigameBuildConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const resolvedOutputDir = path.resolve(repoRoot, args.outputDir ?? config.buildOutputDir);
  const resolvedArtifactsDir = path.resolve(repoRoot, args.artifactsDir);

  const analysis = analyzeWechatMinigameBuildOutput(resolvedOutputDir, config, {
    expectExportedRuntime: args.expectExportedRuntime
  });
  if (analysis.errors.length > 0) {
    console.error(`WeChat mini game build is not ready for packaging: ${path.relative(repoRoot, resolvedOutputDir)}`);
    for (const error of analysis.errors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const manifest = buildWechatMinigameReleaseManifest(resolvedOutputDir, config, {
    expectExportedRuntime: args.expectExportedRuntime,
    ...(args.sourceRevision ? { sourceRevision: args.sourceRevision } : {})
  });
  const packageRootName = args.packageName
    ? sanitizePackageName(args.packageName)
    : `${sanitizePackageName(config.projectName)}-wechatgame-release`;
  const archiveFileName = `${packageRootName}.tar.gz`;
  const archivePath = path.join(resolvedArtifactsDir, archiveFileName);
  const metadataPath = path.join(resolvedArtifactsDir, `${packageRootName}.package.json`);
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-package-"));

  try {
    const packageRoot = path.join(stagingRoot, packageRootName);
    const stagedBuildDir = path.join(packageRoot, "wechatgame");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.cpSync(resolvedOutputDir, stagedBuildDir, { recursive: true });
    writeJsonFile(path.join(stagedBuildDir, "codex.wechat.release.json"), manifest);

    fs.mkdirSync(resolvedArtifactsDir, { recursive: true });
    if (fs.existsSync(archivePath)) {
      fs.rmSync(archivePath);
    }
    if (fs.existsSync(metadataPath)) {
      fs.rmSync(metadataPath);
    }

    packageBuildDirectory(stagingRoot, packageRootName, archivePath);
    const archiveStats = fs.statSync(archivePath);
    const metadata: WechatMinigameReleasePackageMetadata = {
      schemaVersion: 1,
      buildTemplatePlatform: "wechatgame",
      projectName: config.projectName,
      appId: config.appId,
      archiveFileName,
      archiveBytes: archiveStats.size,
      archiveSha256: hashFileSha256(archivePath),
      releaseManifestFile: "wechatgame/codex.wechat.release.json",
      exportedBuildDir: path.relative(repoRoot, resolvedOutputDir).replace(/\\/g, "/"),
      packagedBuildDir: "wechatgame",
      fileCount: manifest.files.length,
      ...(args.sourceRevision ? { sourceRevision: args.sourceRevision } : {}),
      ...(config.runtimeRemoteUrl ? { runtimeRemoteUrl: config.runtimeRemoteUrl } : {}),
      ...(config.remoteAssetRoot ? { remoteAssetRoot: config.remoteAssetRoot } : {})
    };
    writeJsonFile(metadataPath, metadata);

    console.log(`Packaged WeChat mini game release: ${path.relative(repoRoot, archivePath)}`);
    console.log(`Wrote package metadata: ${path.relative(repoRoot, metadataPath)}`);
    if (analysis.warnings.length > 0) {
      console.log("Warnings:");
      for (const warning of analysis.warnings) {
        console.log(`  - ${warning}`);
      }
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

main();
