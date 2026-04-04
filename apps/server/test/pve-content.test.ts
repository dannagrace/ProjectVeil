import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCampaignMissionStates,
  buildDailyDungeonSummary,
  claimDailyDungeonRunReward,
  getCurrentDailyDungeonState,
  resolveCampaignConfig,
  resolveDailyDungeonConfig,
  startDailyDungeonRun
} from "../src/pve-content";

test("campaign config exposes a 10-mission scaffold with sequential unlocks", () => {
  const missions = resolveCampaignConfig();
  const states = buildCampaignMissionStates(missions, undefined);

  assert.equal(missions.length, 10);
  assert.equal(states[0]?.status, "available");
  assert.equal(states[1]?.unlockMissionId, states[0]?.id);
  assert.equal(states[1]?.status, "locked");
});

test("daily dungeon state resets by date key and enforces one-time reward claims per run", () => {
  const [dungeon] = resolveDailyDungeonConfig();
  assert.ok(dungeon);

  const started = startDailyDungeonRun(dungeon, undefined, 2, new Date("2026-04-04T02:00:00.000Z"));
  const claimed = claimDailyDungeonRunReward(dungeon, started.dailyDungeonState, started.run.runId, new Date("2026-04-04T02:05:00.000Z"));
  const summary = buildDailyDungeonSummary(dungeon, claimed.dailyDungeonState, new Date("2026-04-04T03:00:00.000Z"));
  const reset = getCurrentDailyDungeonState(claimed.dailyDungeonState, new Date("2026-04-05T03:00:00.000Z"));

  assert.equal(summary.attemptsUsed, 1);
  assert.equal(summary.attemptsRemaining, 2);
  assert.equal(summary.runs[0]?.rewardClaimedAt != null, true);
  assert.throws(
    () => claimDailyDungeonRunReward(dungeon, claimed.dailyDungeonState, started.run.runId, new Date("2026-04-04T02:06:00.000Z")),
    /daily_dungeon_reward_already_claimed/
  );
  assert.equal(reset.dateKey, "2026-04-05");
  assert.equal(reset.attemptsUsed, 0);
  assert.deepEqual(reset.runs, []);
});
