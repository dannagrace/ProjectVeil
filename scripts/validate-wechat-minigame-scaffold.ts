import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  validateCocosWechatMiniGameScaffoldConfig,
  type CocosWechatMiniGameScaffoldConfig
} from "../apps/cocos-client/assets/scripts/cocos-wechat-minigame-scaffold.ts";

async function main(): Promise<void> {
  const configPath = resolve(process.cwd(), "configs/wechat-mini-game-scaffold.json");
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as CocosWechatMiniGameScaffoldConfig;
  const issues = validateCocosWechatMiniGameScaffoldConfig(config);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  for (const issue of warnings) {
    console.warn(`WARN [${issue.code}] ${issue.message}`);
  }

  if (errors.length > 0) {
    for (const issue of errors) {
      console.error(`ERROR [${issue.code}] ${issue.message}`);
    }
    throw new Error(`wechat_minigame_scaffold_invalid:${errors.length}`);
  }

  console.log(
    `WeChat mini-game scaffold validated: env=${config.envVersion}, mainPackageBudgetMB=${config.mainPackageBudgetMB}, preloadBundles=${config.preloadBundles.join(",")}`
  );
}

void main();
