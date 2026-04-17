import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildWechatMinigameReleaseManifest,
  normalizeWechatMinigameBuildConfig,
  type WechatMinigameReleaseManifest,
  type WechatMinigameSubpackageExpectation
} from "../apps/cocos-client/tooling/cocos-wechat-build.ts";

interface Args {
  configPath: string;
  buildDir: string;
  version?: string;
  sourceRevision?: string;
  baselineManifestPath?: string;
  outputDir: string;
}

interface WechatAssetsHotfixChangedSubpackage {
  root: string;
  bytes: number;
  fileCount: number;
}

interface WechatAssetsHotfixManifest {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  generatedAt: string;
  version: string;
  sourceRevision?: string;
  baselineRevision?: string;
  remoteAssetRoot: string;
  manifestUrl: string;
  changedFiles: Array<{
    path: string;
    sha256: string;
    bytes: number;
    url: string;
    packageRoot?: string;
  }>;
  changedSubpackages: WechatAssetsHotfixChangedSubpackage[];
  totalChangedBytes: number;
  rollbackVersion?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let configPath = "apps/cocos-client/wechat-minigame.build.json";
  let buildDir: string | undefined;
  let version: string | undefined;
  let sourceRevision: string | undefined;
  let baselineManifestPath: string | undefined;
  let outputDir = "artifacts/wechat-release";

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--config" && next) {
      configPath = next;
      index += 1;
      continue;
    }
    if (arg === "--build-dir" && next) {
      buildDir = next;
      index += 1;
      continue;
    }
    if (arg === "--version" && next) {
      version = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--source-revision" && next) {
      sourceRevision = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--baseline-manifest" && next) {
      baselineManifestPath = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!buildDir) {
    fail("Missing required --build-dir <wechatgame-build-dir>.");
  }

  return {
    configPath,
    buildDir,
    ...(version ? { version } : {}),
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(baselineManifestPath ? { baselineManifestPath } : {}),
    outputDir
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function resolveHotfixVersion(version?: string): string {
  if (version && version.trim()) {
    return version.trim();
  }
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function resolveFilePackageRoot(
  relativePath: string,
  expectedSubpackages: WechatMinigameSubpackageExpectation[]
): string | null {
  const matched = expectedSubpackages.find(
    (subpackage) => relativePath === subpackage.root || relativePath.startsWith(`${subpackage.root}/`)
  );
  return matched?.root ?? null;
}

function buildChangedSubpackageSummary(
  changedFiles: WechatAssetsHotfixManifest["changedFiles"]
): WechatAssetsHotfixChangedSubpackage[] {
  const byRoot = new Map<string, WechatAssetsHotfixChangedSubpackage>();
  for (const file of changedFiles) {
    if (!file.packageRoot) {
      continue;
    }
    const existing = byRoot.get(file.packageRoot) ?? {
      root: file.packageRoot,
      bytes: 0,
      fileCount: 0
    };
    existing.bytes += file.bytes;
    existing.fileCount += 1;
    byRoot.set(file.packageRoot, existing);
  }

  return Array.from(byRoot.values()).sort((left, right) => left.root.localeCompare(right.root));
}

function renderMarkdown(report: WechatAssetsHotfixManifest): string {
  const lines = [
    "# WeChat Assets Hotfix Manifest",
    "",
    `- Generated at: \`${report.generatedAt}\``,
    `- Version: \`${report.version}\``,
    `- Source revision: \`${report.sourceRevision ?? "unknown"}\``,
    `- Baseline revision: \`${report.baselineRevision ?? "none"}\``,
    `- Remote asset root: \`${report.remoteAssetRoot}\``,
    `- Manifest URL: \`${report.manifestUrl}\``,
    `- Total changed bytes: \`${report.totalChangedBytes}\``,
    report.rollbackVersion ? `- Rollback version: \`${report.rollbackVersion}\`` : "- Rollback version: `<none>`",
    "",
    "## Changed Subpackages",
    ""
  ];

  if (report.changedSubpackages.length === 0) {
    lines.push("- No subpackage-only changes detected.");
  } else {
    for (const entry of report.changedSubpackages) {
      lines.push(`- \`${entry.root}\`: ${entry.fileCount} files / ${entry.bytes} bytes`);
    }
  }

  lines.push("", "## Changed Files", "");
  if (report.changedFiles.length === 0) {
    lines.push("- No changed files.");
  } else {
    for (const file of report.changedFiles) {
      lines.push(
        `- \`${file.path}\` · ${file.bytes} bytes · ${file.packageRoot ? `subpackage \`${file.packageRoot}\`` : "main package"}`
      );
      lines.push(`  - URL: \`${file.url}\``);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

export function buildWechatAssetsHotfixManifest(args: Args): WechatAssetsHotfixManifest {
  const config = normalizeWechatMinigameBuildConfig(readJson(path.resolve(args.configPath)));
  if (!config.remoteAssetRoot) {
    fail("WeChat assets hotfix manifest requires remoteAssetRoot in the build config.");
  }

  const version = resolveHotfixVersion(args.version);
  const releaseManifest = buildWechatMinigameReleaseManifest(path.resolve(args.buildDir), config, {
    expectExportedRuntime: true,
    ...(args.sourceRevision ? { sourceRevision: args.sourceRevision } : {})
  });
  const baselineManifest = args.baselineManifestPath
    ? readJson<WechatMinigameReleaseManifest>(path.resolve(args.baselineManifestPath))
    : null;
  const baselineFiles = new Map((baselineManifest?.files ?? []).map((entry) => [entry.relativePath, entry]));
  const changedFiles = releaseManifest.files
    .filter((entry) => baselineFiles.get(entry.relativePath)?.sha256 !== entry.sha256)
    .map((entry) => {
      const packageRoot = resolveFilePackageRoot(entry.relativePath, config.expectedSubpackages);
      return {
        path: entry.relativePath,
        sha256: entry.sha256,
        bytes: entry.bytes,
        url: `${config.remoteAssetRoot!.replace(/\/+$/, "")}/${encodeURIComponent(version)}/${entry.relativePath}`,
        ...(packageRoot ? { packageRoot } : {})
      };
    });
  const changedSubpackages = buildChangedSubpackageSummary(changedFiles);
  const manifestUrl = `${config.remoteAssetRoot.replace(/\/+$/, "")}/${encodeURIComponent(version)}/codex.wechat.hotfix-manifest.json`;

  return {
    schemaVersion: 1,
    buildTemplatePlatform: "wechatgame",
    generatedAt: new Date().toISOString(),
    version,
    ...(releaseManifest.sourceRevision ? { sourceRevision: releaseManifest.sourceRevision } : {}),
    ...(baselineManifest?.sourceRevision ? { baselineRevision: baselineManifest.sourceRevision } : {}),
    remoteAssetRoot: config.remoteAssetRoot,
    manifestUrl,
    changedFiles,
    changedSubpackages,
    totalChangedBytes: changedFiles.reduce((sum, entry) => sum + entry.bytes, 0),
    ...(baselineManifest?.sourceRevision ? { rollbackVersion: baselineManifest.sourceRevision } : {})
  };
}

export function runWechatAssetsHotfixCli(argv = process.argv): number {
  const args = parseArgs(argv);
  const report = buildWechatAssetsHotfixManifest(args);
  const outputDir = path.resolve(args.outputDir);
  const jsonPath = path.join(outputDir, "codex.wechat.hotfix-manifest.json");
  const markdownPath = path.join(outputDir, "codex.wechat.hotfix-manifest.md");

  writeJson(jsonPath, report);
  writeText(markdownPath, renderMarkdown(report));

  console.log(`Wrote WeChat hotfix manifest JSON: ${path.relative(process.cwd(), jsonPath).replace(/\\/g, "/")}`);
  console.log(`Wrote WeChat hotfix manifest Markdown: ${path.relative(process.cwd(), markdownPath).replace(/\\/g, "/")}`);
  console.log(`Changed files: ${report.changedFiles.length}`);

  return 0;
}

const executedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedDirectly) {
  try {
    process.exitCode = runWechatAssetsHotfixCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
