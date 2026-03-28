import fs from "node:fs";
import path from "node:path";
import {
  buildWechatMinigameTemplateArtifacts,
  normalizeWechatMinigameBuildConfig
} from "../apps/cocos-client/assets/scripts/cocos-wechat-build.ts";

interface Args {
  configPath: string;
  templateDir: string;
  outputDir?: string;
}

function parseArgs(argv: string[]): Args {
  let configPath = "apps/cocos-client/wechat-minigame.build.json";
  let templateDir = "apps/cocos-client/build-templates/wechatgame";
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
    }
  }

  return {
    configPath,
    templateDir,
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

function main(): void {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const configPath = path.resolve(repoRoot, args.configPath);
  const templateDir = path.resolve(repoRoot, args.templateDir);
  const config = normalizeWechatMinigameBuildConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const artifacts = buildWechatMinigameTemplateArtifacts(config);

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
