import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCampaignMissionStates,
  buildDailyDungeonSummary,
  claimDailyDungeonRunReward,
  getCurrentDailyDungeonState,
  resolveActiveDailyDungeon,
  resolveCampaignConfig,
  resolveDailyDungeonConfig,
  startDailyDungeonRun
} from "@server/domain/battle/pve-content";

test("campaign config exposes a 6-mission chapter 1 arc with dialogue and sequential unlocks", () => {
  const missions = resolveCampaignConfig();
  const states = buildCampaignMissionStates(missions, undefined);
  const chapter1 = missions.filter((mission) => mission.chapterId === "chapter1");
  const chapter2 = missions.filter((mission) => mission.chapterId === "chapter2");
  const chapter3 = missions.filter((mission) => mission.chapterId === "chapter3");
  const chapter4 = missions.filter((mission) => mission.chapterId === "chapter4");
  const chapter5 = missions.filter((mission) => mission.chapterId === "chapter5");
  const chapter6 = missions.filter((mission) => mission.chapterId === "chapter6");

  assert.equal(missions.length, 41);
  assert.equal(chapter1.length, 6);
  assert.equal(chapter2.length, 7);
  assert.equal(chapter3.length, 7);
  assert.equal(chapter4.length, 7);
  assert.equal(chapter5.length, 7);
  assert.equal(chapter6.length, 7);
  assert.equal(missions[0]?.introDialogue?.length, 2);
  assert.equal(chapter2.at(-1)?.bossEncounterName, "Captain Veyr, Ringbreaker");
  assert.equal(chapter2.at(-1)?.bossTemplateId, "boss-shadow-warden");
  assert.equal(chapter3.at(-1)?.midDialogue?.length, 3);
  assert.equal(chapter4.at(-1)?.reward.cosmeticId, "border-veilfall-throne");
  assert.equal(chapter5.at(-1)?.bossEncounterName, "Chancellor Morvane");
  assert.equal(chapter6.at(-1)?.reward.cosmeticId, "border-dawnwatch-paragon");
  assert.equal(missions[0]?.objectives[0]?.id, "c1m1-clear-patrol");
  assert.equal(states[0]?.status, "available");
  assert.equal(states[1]?.unlockMissionId, states[0]?.id);
  assert.equal(states[1]?.status, "locked");
  assert.equal(states.find((mission) => mission.id === "chapter2-highland-muster")?.status, "locked");
  assert.equal(states.find((mission) => mission.id === "chapter5-crownless-watch")?.status, "locked");
  assert.equal(states.find((mission) => mission.id === "chapter6-glassfront-march")?.status, "locked");
});

test("campaign chapter gates require prior chapter clears, hero level thresholds, and ranked progression", () => {
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
  const chapter5LockedByHeroLevel = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter4-veilfall-throne", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 21, rankDivision: "gold_i" }
  ).find((mission) => mission.id === "chapter5-crownless-watch");
  const chapter5LockedByRank = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter4-veilfall-throne", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 22, rankDivision: "silver_iii" }
  ).find((mission) => mission.id === "chapter5-crownless-watch");
  const chapter5Unlocked = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter4-veilfall-throne", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 22, rankDivision: "gold_i" }
  ).find((mission) => mission.id === "chapter5-crownless-watch");
  const chapter6LockedByHeroLevel = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter5-ashen-regency", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 27, rankDivision: "platinum_i" }
  ).find((mission) => mission.id === "chapter6-glassfront-march");
  const chapter6LockedByRank = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter5-ashen-regency", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 28, rankDivision: "gold_iii" }
  ).find((mission) => mission.id === "chapter6-glassfront-march");
  const chapter6Unlocked = buildCampaignMissionStates(
    missions,
    {
      missions: [{ missionId: "chapter5-ashen-regency", attempts: 1, completedAt: "2026-04-05T00:00:00.000Z" }]
    },
    { highestHeroLevel: 28, rankDivision: "platinum_i" }
  ).find((mission) => mission.id === "chapter6-glassfront-march");

  assert.equal(chapter2Mission?.status, "available");
  assert.equal(chapter3Locked?.status, "locked");
  assert.equal(chapter3Locked?.unlockRequirements?.find((requirement) => requirement.type === "hero_level")?.satisfied, false);
  assert.equal(chapter3Unlocked?.status, "available");
  assert.equal(chapter4Locked?.status, "locked");
  assert.equal(chapter4Locked?.unlockRequirements?.find((requirement) => requirement.type === "rank_division")?.satisfied, false);
  assert.equal(chapter4Unlocked?.status, "available");
  assert.equal(chapter5LockedByHeroLevel?.status, "locked");
  assert.equal(chapter5LockedByHeroLevel?.unlockRequirements?.find((requirement) => requirement.type === "hero_level")?.minimumHeroLevel, 22);
  assert.equal(chapter5LockedByRank?.status, "locked");
  assert.equal(chapter5LockedByRank?.unlockRequirements?.find((requirement) => requirement.type === "rank_division")?.minimumRankDivision, "gold_i");
  assert.equal(chapter5Unlocked?.status, "available");
  assert.equal(chapter6LockedByHeroLevel?.status, "locked");
  assert.equal(chapter6LockedByHeroLevel?.unlockRequirements?.find((requirement) => requirement.type === "hero_level")?.minimumHeroLevel, 28);
  assert.equal(chapter6LockedByRank?.status, "locked");
  assert.equal(chapter6LockedByRank?.unlockRequirements?.find((requirement) => requirement.type === "rank_division")?.minimumRankDivision, "platinum_i");
  assert.equal(chapter6Unlocked?.status, "available");
});

test("daily dungeon state resets by date key and enforces one-time reward claims per run", () => {
  const dungeon = resolveActiveDailyDungeon(new Date("2026-04-06T02:00:00.000Z"));
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

test("daily dungeon cannot be re-entered after the final floor reward is claimed in the same window", () => {
  const dungeon = resolveActiveDailyDungeon(new Date("2026-04-06T02:00:00.000Z"));
  assert.ok(dungeon);

  const finalFloor = Math.max(...dungeon.floors.map((floor) => floor.floor));
  const started = startDailyDungeonRun(dungeon, undefined, finalFloor, new Date("2026-04-06T02:00:00.000Z"));
  const claimed = claimDailyDungeonRunReward(dungeon, started.dailyDungeonState, started.run.runId, new Date("2026-04-06T02:05:00.000Z"));

  assert.throws(
    () => startDailyDungeonRun(dungeon, claimed.dailyDungeonState, 1, new Date("2026-04-06T02:10:00.000Z")),
    /daily_dungeon_already_completed/
  );
});

test("daily dungeon config includes weekly windows and resolves the active rotation by date", () => {
  const dungeons = resolveDailyDungeonConfig();

  assert.equal(dungeons.length, 5);
  assert.deepEqual(
    dungeons.map((dungeon) => dungeon.id),
    ["shadow-archives", "ember-forge", "tideworn-sanctum", "verdant-maze", "stormglass-spire"]
  );
  assert.deepEqual(
    dungeons.map((dungeon) => dungeon.activeWindow.startDate),
    ["2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27", "2026-05-04"]
  );
  assert.equal(resolveActiveDailyDungeon(new Date("2026-04-08T12:00:00.000Z")).id, "shadow-archives");
  assert.equal(resolveActiveDailyDungeon(new Date("2026-04-15T12:00:00.000Z")).id, "ember-forge");
  assert.equal(resolveActiveDailyDungeon(new Date("2026-04-22T12:00:00.000Z")).id, "tideworn-sanctum");
  assert.equal(resolveActiveDailyDungeon(new Date("2026-04-29T12:00:00.000Z")).id, "verdant-maze");
  assert.equal(resolveActiveDailyDungeon(new Date("2026-05-06T12:00:00.000Z")).id, "stormglass-spire");
});

test("daily dungeon config validation rejects malformed weekly windows", () => {
  assert.throws(
    () =>
      resolveDailyDungeonConfig({
        dungeons: [
          {
            id: "broken-rotation",
            name: "Broken Rotation",
            description: "Invalid authored window",
            attemptLimit: 3,
            activeWindow: {
              startDate: "2026-04-06",
              endDate: "2026-04-10"
            },
            floors: [
              {
                floor: 1,
                recommendedHeroLevel: 1,
                enemyArmyTemplateId: "wolf_pack",
                enemyArmyCount: 10,
                enemyStatMultiplier: 1.1,
                reward: { gems: 5 }
              }
            ]
          }
        ]
      }),
    /activeWindow must span exactly 7 calendar days/
  );
});

test("daily dungeon rotation rejects gaps and overlapping active windows", () => {
  assert.throws(
    () => resolveActiveDailyDungeon(new Date("2026-04-05T12:00:00.000Z")),
    /daily_dungeon_not_active_for_2026-04-05/
  );

  assert.throws(
    () =>
      resolveActiveDailyDungeon(
        new Date("2026-04-08T12:00:00.000Z"),
        {
          dungeons: [
            {
              id: "shadow-archives",
              name: "Shadow Archives",
              description: "Baseline window",
              attemptLimit: 3,
              activeWindow: {
                startDate: "2026-04-06",
                endDate: "2026-04-12"
              },
              floors: [
                {
                  floor: 1,
                  recommendedHeroLevel: 1,
                  enemyArmyTemplateId: "wolf_pack",
                  enemyArmyCount: 10,
                  enemyStatMultiplier: 1.1,
                  reward: { gems: 5 }
                }
              ]
            },
            {
              id: "ember-forge",
              name: "Ember Forge",
              description: "Overlapping window",
              attemptLimit: 3,
              activeWindow: {
                startDate: "2026-04-08",
                endDate: "2026-04-14"
              },
              floors: [
                {
                  floor: 1,
                  recommendedHeroLevel: 1,
                  enemyArmyTemplateId: "hero_guard_basic",
                  enemyArmyCount: 10,
                  enemyStatMultiplier: 1.1,
                  reward: { gems: 5 }
                }
              ]
            }
          ]
        }
      ),
    /activeWindow overlaps with dungeon "shadow-archives"/
  );
});
