import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBossPhaseDescriptor,
  buildBossPhaseTracker,
  buildBossPhaseTransitionEvent
} from "../assets/scripts/cocos-boss-phase-ui.ts";
import type { BattleState } from "../assets/scripts/VeilCocosSession.ts";

function createBattleState(): BattleState {
  return {
    id: "battle-1",
    round: 1,
    lanes: 1,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack", "neutral-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        lane: 0,
        stackName: "Guard",
        initiative: 7,
        attack: 4,
        defense: 4,
        minDamage: 1,
        maxDamage: 2,
        count: 12,
        currentHp: 10,
        maxHp: 10,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      },
      "neutral-1-stack": {
        id: "neutral-1-stack",
        templateId: "shadow_hexer",
        camp: "defender",
        lane: 0,
        stackName: "Shadow Warden",
        initiative: 5,
        attack: 3,
        defense: 3,
        minDamage: 1,
        maxDamage: 3,
        count: 1,
        currentHp: 10,
        maxHp: 10,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [],
    log: ["战斗开始"],
    rng: { seed: 1, cursor: 0 },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1",
    encounterPosition: { x: 1, y: 1 },
    bossEncounter: {
      templateId: "boss-shadow-warden",
      bossUnitId: "neutral-1-stack",
      activePhaseId: "phase-2-warden-grip",
      maxBossHp: 10,
      triggeredAbilityKeys: []
    }
  };
}

test("buildBossPhaseDescriptor returns null for a missing battle", () => {
  assert.equal(buildBossPhaseDescriptor(null), null);
});

test("buildBossPhaseDescriptor maps the active phase from a multi-phase boss encounter", () => {
  const descriptor = buildBossPhaseDescriptor(createBattleState());

  assert.deepEqual(descriptor, {
    key: "battle-1:phase-2-warden-grip",
    templateId: "boss-shadow-warden",
    bossUnitId: "neutral-1-stack",
    bossName: "Shadow Warden",
    phaseId: "phase-2-warden-grip",
    phaseLabel: "阶段 2 · Warden Grip",
    phaseIndex: 1,
    totalPhases: 3,
    thresholdPercent: 55,
    detail: "Mist-woven chains drag the front line down.",
    nextThresholdPercent: 25
  });
});

test("buildBossPhaseDescriptor reports the final phase with no next threshold", () => {
  const battle: BattleState = {
    ...createBattleState(),
    bossEncounter: {
      ...createBattleState().bossEncounter!,
      activePhaseId: "phase-3-last-watch"
    }
  };

  const descriptor = buildBossPhaseDescriptor(battle);

  assert.equal(descriptor?.phaseLabel, "阶段 3 · Last Watch");
  assert.equal(descriptor?.totalPhases, 3);
  assert.equal(descriptor?.nextThresholdPercent, null);
});

test("buildBossPhaseTransitionEvent returns null when the phase does not change", () => {
  const battle = createBattleState();

  assert.equal(buildBossPhaseTransitionEvent(battle, battle), null);
});

test("buildBossPhaseTransitionEvent summarizes a phase change banner", () => {
  const previousBattle: BattleState = {
    ...createBattleState(),
    bossEncounter: {
      ...createBattleState().bossEncounter!,
      activePhaseId: "phase-1-veil"
    }
  };
  const nextBattle = createBattleState();

  assert.deepEqual(buildBossPhaseTransitionEvent(previousBattle, nextBattle), {
    key: "battle-1:phase-1-veil->phase-2-warden-grip",
    templateId: "boss-shadow-warden",
    bossUnitId: "neutral-1-stack",
    bossName: "Shadow Warden",
    previousPhaseId: "phase-1-veil",
    previousPhaseLabel: "阶段 1 · Veil",
    nextPhaseId: "phase-2-warden-grip",
    nextPhaseLabel: "阶段 2 · Warden Grip",
    nextPhaseIndex: 1,
    totalPhases: 3,
    thresholdPercent: 55,
    bannerTitle: "Shadow Warden · 阶段 2 · Warden Grip",
    bannerDetail: "血线跌破 55% · Mist-woven chains drag the front line down.",
    summaryLines: [
      "首领阶段切换：阶段 1 · Veil -> 阶段 2 · Warden Grip",
      "阈值：55% HP · Mist-woven chains drag the front line down."
    ]
  });
});

test("buildBossPhaseTransitionEvent throws when the referenced boss template is missing", () => {
  const previousBattle: BattleState = {
    ...createBattleState(),
    bossEncounter: {
      templateId: "boss-missing-template",
      bossUnitId: "neutral-1-stack",
      activePhaseId: "phase-1-veil",
      maxBossHp: 10,
      triggeredAbilityKeys: []
    }
  };
  const nextBattle: BattleState = {
    ...previousBattle,
    bossEncounter: {
      ...previousBattle.bossEncounter,
      activePhaseId: "phase-2-warden-grip"
    }
  };

  assert.throws(
    () => buildBossPhaseTransitionEvent(previousBattle, nextBattle),
    /Missing boss encounter template for Cocos phase UI: boss-missing-template/
  );
});

test("buildBossPhaseTracker builds markers with active and reached states", () => {
  const battle: BattleState = {
    ...createBattleState(),
    units: {
      ...createBattleState().units,
      "neutral-1-stack": {
        ...createBattleState().units["neutral-1-stack"]!,
        currentHp: 5
      }
    }
  };

  assert.deepEqual(buildBossPhaseTracker(battle), {
    title: "Shadow Warden · 阶段 2 · Warden Grip",
    detail: "当前血量 5/10 HP · 下一次切换 25% · Mist-woven chains drag the front line down.",
    markers: [
      {
        key: "phase-1-veil",
        label: "阶段 1 · Veil",
        thresholdPercent: 100,
        active: false,
        reached: true
      },
      {
        key: "phase-2-warden-grip",
        label: "阶段 2 · Warden Grip",
        thresholdPercent: 55,
        active: true,
        reached: true
      },
      {
        key: "phase-3-last-watch",
        label: "阶段 3 · Last Watch",
        thresholdPercent: 25,
        active: false,
        reached: false
      }
    ]
  });
});
