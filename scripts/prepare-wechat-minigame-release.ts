import fs from "node:fs";
import path from "node:path";
import {
  analyzeWechatMinigameBuildOutput,
  buildWechatMinigameReleaseManifest,
  normalizeWechatMinigameBuildConfig
} from "../apps/cocos-client/assets/scripts/cocos-wechat-build.ts";

interface Args {
  configPath: string;
  outputDir?: string;
  check: boolean;
  expectExportedRuntime: boolean;
  sourceRevision?: string;
}

function parseArgs(argv: string[]): Args {
  let configPath = "apps/cocos-client/wechat-minigame.build.json";
  let outputDir: string | undefined;
  let check = false;
  let expectExportedRuntime = false;
  let sourceRevision: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
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
    if (arg === "--source-revision" && next) {
      sourceRevision = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--expect-exported-runtime") {
      expectExportedRuntime = true;
    }
  }

  return {
    configPath,
    check,
    expectExportedRuntime,
    ...(outputDir ? { outputDir } : {}),
    ...(sourceRevision ? { sourceRevision } : {})
  };
}

function renderManifest(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function main(): void {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const configPath = path.resolve(repoRoot, args.configPath);
  const config = normalizeWechatMinigameBuildConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const outputDir = path.resolve(repoRoot, args.outputDir ?? config.buildOutputDir);
  const analysis = analyzeWechatMinigameBuildOutput(outputDir, config, {
    expectExportedRuntime: args.expectExportedRuntime
  });

  if (analysis.errors.length > 0) {
    console.error(`WeChat mini game build is not ready for release metadata: ${path.relative(repoRoot, outputDir)}`);
    for (const error of analysis.errors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const manifest = buildWechatMinigameReleaseManifest(outputDir, config, {
    expectExportedRuntime: args.expectExportedRuntime,
    ...(args.sourceRevision ? { sourceRevision: args.sourceRevision } : {})
  });
  const manifestPath = path.join(outputDir, "codex.wechat.release.json");
  const expected = renderManifest(manifest);

  if (args.check) {
    if (!fs.existsSync(manifestPath)) {
      console.error(`Release metadata is missing: ${path.relative(repoRoot, manifestPath)}`);
      console.error("Run npm run prepare:wechat-release to generate it.");
      process.exitCode = 1;
      return;
    }

    const actual = fs.readFileSync(manifestPath, "utf8");
    if (actual !== expected) {
      console.error(`Release metadata is stale: ${path.relative(repoRoot, manifestPath)}`);
      console.error("Run npm run prepare:wechat-release to refresh it.");
      process.exitCode = 1;
      return;
    }

    console.log(`WeChat release metadata is up to date: ${path.relative(repoRoot, manifestPath)}`);
    return;
  }

  fs.writeFileSync(manifestPath, expected, "utf8");
  console.log(`Prepared WeChat release metadata at ${path.relative(repoRoot, manifestPath)}`);
}

main();
