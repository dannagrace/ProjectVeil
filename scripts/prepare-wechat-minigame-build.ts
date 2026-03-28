import fs from "node:fs";
import path from "node:path";
import {
  buildWechatMinigameTemplateArtifacts,
  normalizeWechatMinigameBuildConfig
} from "../apps/cocos-client/assets/scripts/cocos-wechat-build.ts";

interface Args {
  configPath: string;
  templateDir: string;
  check: boolean;
  outputDir?: string;
}

function parseArgs(argv: string[]): Args {
  let configPath = "apps/cocos-client/wechat-minigame.build.json";
  let templateDir = "apps/cocos-client/build-templates/wechatgame";
  let check = false;
  let outputDir: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--config" && next) {
      configPath = next;
      index += 1;
      continue;
    }
    if (arg === "--template-dir" && next) {
      templateDir = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--check") {
      check = true;
    }
  }

  return {
    configPath,
    templateDir,
    check,
    ...(outputDir ? { outputDir } : {})
  };
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`, "utf8");
}

function compareFileContent(filePath: string, expected: string): string | undefined {
  if (!fs.existsSync(filePath)) {
    return `missing: ${filePath}`;
  }

  const actual = fs.readFileSync(filePath, "utf8");
  if (actual !== expected) {
    return `stale: ${filePath}`;
  }

  return undefined;
}

function main(): void {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const configPath = path.resolve(repoRoot, args.configPath);
  const templateDir = path.resolve(repoRoot, args.templateDir);
  const config = normalizeWechatMinigameBuildConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const artifacts = buildWechatMinigameTemplateArtifacts(config);

  if (args.check) {
    const mismatches = [
      compareFileContent(path.join(templateDir, "game.json"), `${JSON.stringify(artifacts.gameJson, null, 2)}\n`),
      compareFileContent(
        path.join(templateDir, "project.config.json"),
        `${JSON.stringify(artifacts.projectConfigJson, null, 2)}\n`
      ),
      compareFileContent(
        path.join(templateDir, "codex.wechat.build.json"),
        `${JSON.stringify(artifacts.manifestJson, null, 2)}\n`
      ),
      compareFileContent(path.join(templateDir, "README.codex.md"), `${artifacts.releaseChecklistMarkdown}\n`)
    ].filter((value): value is string => Boolean(value));

    if (mismatches.length > 0) {
      console.error("WeChat mini game template artifacts are stale:");
      for (const mismatch of mismatches) {
        const [status, mismatchPath] = mismatch.split(": ", 2);
        console.error(`  - ${status} ${path.relative(repoRoot, mismatchPath)}`);
      }
      console.error("Run npm run prepare:wechat-build to refresh them.");
      process.exitCode = 1;
      return;
    }

    console.log(`WeChat mini game templates are up to date: ${path.relative(repoRoot, templateDir)}`);
    return;
  }

  writeJsonFile(path.join(templateDir, "game.json"), artifacts.gameJson);
  writeJsonFile(path.join(templateDir, "project.config.json"), artifacts.projectConfigJson);
  writeJsonFile(path.join(templateDir, "codex.wechat.build.json"), artifacts.manifestJson);
  writeTextFile(path.join(templateDir, "README.codex.md"), artifacts.releaseChecklistMarkdown);

  if (args.outputDir) {
    const outputDir = path.resolve(repoRoot, args.outputDir);
    writeJsonFile(path.join(outputDir, "codex.wechat.build.json"), artifacts.manifestJson);
    writeTextFile(path.join(outputDir, "README.codex.md"), artifacts.releaseChecklistMarkdown);
  }

  console.log(`Prepared WeChat mini game templates at ${path.relative(repoRoot, templateDir)}`);
  if (args.outputDir) {
    console.log(`Wrote release checklist to ${args.outputDir}`);
  }
}

main();
