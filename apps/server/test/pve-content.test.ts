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

test("campaign config exposes a 6-mission chapter 1 arc with dialogue and sequential unlocks", () => {
  const missions = resolveCampaignConfig();
  const states = buildCampaignMissionStates(missions, undefined);
  const chapter1 = missions.filter((mission) => mission.chapterId === "chapter1");
  const chapter2 = missions.filter((mission) => mission.chapterId === "chapter2");
  const chapter3 = missions.filter((mission) => mission.chapterId === "chapter3");
  const chapter4 = missions.filter((mission) => mission.chapterId === "chapter4");

  assert.equal(missions.length, 27);
  assert.equal(chapter1.length, 6);
  assert.equal(chapter2.length, 7);
  assert.equal(chapter3.length, 7);
  assert.equal(chapter4.length, 7);
  assert.equal(missions[0]?.introDialogue?.length, 2);
  assert.equal(chapter2.at(-1)?.bossEncounterName, "Captain Veyr, Ringbreaker");
  assert.equal(chapter3.at(-1)?.midDialogue?.length, 3);
  assert.equal(chapter4.at(-1)?.reward.cosmeticId, "border-veilfall-throne");
  assert.equal(missions[0]?.objectives[0]?.id, "c1m1-clear-patrol");
  assert.equal(states[0]?.status, "available");
  assert.equal(states[1]?.unlockMissionId, states[0]?.id);
  assert.equal(states[1]?.status, "locked");
  assert.equal(states.find((mission) => mission.id === "chapter2-highland-muster")?.status, "locked");
});

test("campaign chapter gates require prior chapter clears, hero level 15, and silver rank", () => {
  const missions = resolveCampaignConfig();
  const chapter2Mission = buildCampaignMissionStates(missions, {
    missions: [{ missionId: "chapter1-defend-bridge", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
  }) .find((mission) => mission.id === "chapter2-highland-muster");
  const chapter3Locked = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter2-break-the-ring", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 14, rankDivision: "silver_i" }
  ).find((mission) => mission.id === "chapter3-ridgefire-scouts");
  const chapter3Unlocked = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter2-break-the-ring", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 15, rankDivision: "bronze_iii" }
  ).find((mission) => mission.id === "chapter3-ridgefire-scouts");
  const chapter4Locked = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter3-tempest-crown", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 18, rankDivision: "bronze_iii" }
  ).find((mission) => mission.id === "chapter4-basin-breach");
  const chapter4Unlocked = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter3-tempest-crown", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 18, rankDivision: "silver_i" }
  ).find((mission) => mission.id === "chapter4-basin-breach");

  assert.equal(chapter2Mission?.status, "available");
  assert.equal(chapter3Locked?.status, "locked");
  assert.equal(chapter3Locked?.unlockRequirements?.find((requirement) => requirement.type === "hero_level")?.satisfied, false);
  assert.equal(chapter3Unlocked?.status, "available");
  assert.equal(chapter4Locked?.status, "locked");
  assert.equal(chapter4Locked?.unlockRequirements?.find((requirement) => requirement.type === "rank_division")?.satisfied, false);
  assert.equal(chapter4Unlocked?.status, "available");
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
