import fs from "node:fs";
import path from "node:path";
import {
  analyzeWechatMinigameBuildOutput,
  normalizeWechatMinigameBuildConfig
} from "../apps/cocos-client/tooling/cocos-wechat-build.ts";

interface Args {
  configPath: string;
  outputDir?: string;
  expectExportedRuntime: boolean;
}

function parseArgs(argv: string[]): Args {
  let configPath = "apps/cocos-client/wechat-minigame.build.json";
  let outputDir: string | undefined;
  let expectExportedRuntime = false;

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
    if (arg === "--expect-exported-runtime") {
      expectExportedRuntime = true;
    }
  }

  return {
    configPath,
    expectExportedRuntime,
    ...(outputDir ? { outputDir } : {})
  };
}

function toMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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

  console.log(`WeChat mini game build report: ${path.relative(repoRoot, outputDir)}`);
  console.log(
    `  Main package: ${toMb(analysis.mainPackageBytes)} / ${toMb(analysis.mainPackageBudgetBytes)}`
  );
  console.log(
    `  Total subpackages: ${toMb(analysis.totalSubpackageBytes)} / ${toMb(analysis.totalSubpackageBudgetBytes)}`
  );

  if (analysis.subpackages.length > 0) {
    console.log("  Subpackages:");
    for (const subpackage of analysis.subpackages) {
      console.log(`    - ${subpackage.root}: ${toMb(subpackage.bytes)}`);
    }
  }

  if (analysis.warnings.length > 0) {
    console.log("  Warnings:");
    for (const warning of analysis.warnings) {
      console.log(`    - ${warning}`);
    }
  }

  if (analysis.errors.length > 0) {
    console.error("  Errors:");
    for (const error of analysis.errors) {
      console.error(`    - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("  Result: ok");
}

main();
