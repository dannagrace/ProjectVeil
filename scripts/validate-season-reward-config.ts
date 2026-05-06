import { resolveSeasonRewardConfig } from "../apps/server/src/domain/social/season-rewards.ts";

const [unknownArg] = process.argv.slice(2);
if (unknownArg) {
  console.error(`Season reward config validation failed: Unknown argument: ${unknownArg}`);
  process.exitCode = 1;
} else {
  const config = resolveSeasonRewardConfig();
  console.log(
    `Season reward config is valid: ${config.brackets.length} bracket(s) loaded from configs/season-rewards.json`
  );
}
