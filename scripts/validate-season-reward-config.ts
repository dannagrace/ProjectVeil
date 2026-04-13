import { resolveSeasonRewardConfig } from "../apps/server/src/season-rewards.ts";

const config = resolveSeasonRewardConfig();
console.log(
  `Season reward config is valid: ${config.brackets.length} bracket(s) loaded from configs/season-rewards.json`
);
