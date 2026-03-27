import assert from "node:assert/strict";
import test from "node:test";
import { buildBattleEnterCopy, buildBattleExitCopy } from "../assets/scripts/cocos-battle-transition-copy";
import type { WorldEvent } from "../assets/scripts/VeilCocosSession";

test("buildBattleEnterCopy distinguishes pve and pvp encounters", () => {
  const neutralEnter = buildBattleEnterCopy([
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-7",
      initiator: "neutral",
      battleId: "battle-1",
      path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      moveCost: 1
    }
  ]);
  assert.deepEqual(neutralEnter, {
    badge: "AMBUSH",
    title: "中立守军主动来袭",
    subtitle: "目标 neutral-7，切入战斗场景",
    tone: "enter"
  });

  const heroEnter = buildBattleEnterCopy([
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "hero",
      defenderHeroId: "hero-2",
      initiator: "hero",
      battleId: "battle-2",
      path: [{ x: 3, y: 4 }, { x: 3, y: 5 }],
      moveCost: 1
    }
  ]);
  assert.deepEqual(heroEnter, {
    badge: "PVP",
    title: "敌方英雄 hero-2",
    subtitle: "双方部队展开接战",
    tone: "enter"
  });
});

test("buildBattleExitCopy summarizes rewards and progression", () => {
  const events: WorldEvent[] = [
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: {
        kind: "gold",
        amount: 300
      }
    },
    {
      type: "hero.progressed",
      heroId: "hero-1",
      battleId: "battle-1",
      battleKind: "neutral",
      experienceGained: 120,
      totalExperience: 120,
      level: 2,
      levelsGained: 1,
      skillPointsAwarded: 1,
      availableSkillPoints: 1
    }
  ];

  assert.deepEqual(buildBattleExitCopy(events, true), {
    badge: "VICTORY",
    title: "战斗胜利",
    subtitle: "金币 +300 · Lv 2",
    tone: "victory"
  });

  assert.deepEqual(buildBattleExitCopy(events, false), {
    badge: "RETREAT",
    title: "战斗失利",
    subtitle: "金币 +300 · Lv 2",
    tone: "defeat"
  });
});
