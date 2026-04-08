import assert from "node:assert/strict";
import test from "node:test";
import { buildBattlePanelSections } from "../assets/scripts/cocos-battle-panel-model";
import { resolveBattlePanelUnitVisual } from "../assets/scripts/cocos-battle-unit-visuals";
import { VeilBattlePanel } from "../assets/scripts/VeilBattlePanel";
import type { SessionUpdate } from "../assets/scripts/VeilCocosSession";
import {
  createBattlePanelState,
  createBattleUpdate as createBattleUpdateFixture,
  createComponentHarness
} from "./helpers/cocos-panel-harness.ts";

function createBattleUpdate(): SessionUpdate {
  return createBattleUpdateFixture();
}

function createBossBattleUpdate(): SessionUpdate {
  const update = createBattleUpdateFixture();
  if (!update.battle) {
    return update;
  }

  update.battle.units["neutral-1-stack"] = {
    ...update.battle.units["neutral-1-stack"]!,
    templateId: "shadow_hexer",
    stackName: "Shadow Warden",
    currentHp: 5,
    maxHp: 10
  };
  update.battle.bossEncounter = {
    templateId: "boss-shadow-warden",
    bossUnitId: "neutral-1-stack",
    activePhaseId: "phase-2-warden-grip",
    maxBossHp: 10,
    triggeredAbilityKeys: []
  };
  update.battle.environment = [
    {
      id: "phase-2-snare",
      lane: 0,
      kind: "trap",
      effect: "slow",
      name: "Veil Snare",
      description: "Mist-woven chains drag the front line down.",
      damage: 0,
      charges: 2,
      revealed: true,
      triggered: false,
      grantedStatusId: "slowed",
      triggeredByCamp: "attacker"
    }
  ];
  return update;
}

test("buildBattlePanelSections groups ally, enemy and queue rows from a battle state", () => {
  const sections = buildBattlePanelSections({
    update: createBattleUpdate(),
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-1-stack",
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.equal(sections.idle, false);
  assert.equal(sections.orderItems.length, 2);
  assert.equal(sections.friendlyItems[0]?.title, "Guard x12");
  assert.equal(sections.enemyTargets[0]?.title, "Orc x8");
  assert.equal(sections.enemyTargets[0]?.selected, true);
});

test("battle panel stage banner derives the PVE terrain title from the encounter position", () => {
  const sections = buildBattlePanelSections({
    update: createBattleUpdate(),
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: null,
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.deepEqual(sections.stage, {
    terrain: "sand",
    title: "沙原战场 · 中立遭遇",
    subtitle: "坐标 (1,1) · 无额外障碍",
    badge: "PVE"
  });
});

test("battle panel exposes boss phase banner and hp threshold markers", () => {
  const sections = buildBattlePanelSections({
    update: createBossBattleUpdate(),
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-1-stack",
    actionPending: false,
    feedback: null,
    presentationState: {
      battleId: "battle-1",
      phase: "impact",
      moment: "impact_hit",
      label: "首领阶段切换",
      detail: "血线跌破 55% · Mist-woven chains drag the front line down.",
      badge: "P2",
      tone: "skill",
      result: null,
      summaryLines: ["首领阶段切换：阶段 1 · Veil -> 阶段 2 · Warden Grip"],
      phaseTransitionEvent: {
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
        summaryLines: ["首领阶段切换：阶段 1 · Veil -> 阶段 2 · Warden Grip"]
      },
      feedbackLayer: {
        animation: "hit",
        cue: "hit",
        transition: null,
        durationMs: null,
        pauseDurationMs: 900
      }
    }
  });

  assert.equal(sections.phaseBanner?.badge, "P2");
  assert.match(sections.phaseBanner?.title ?? "", /Warden Grip/);
  assert.equal(sections.bossPhaseTracker?.markers.length, 3);
  assert.equal(sections.bossPhaseTracker?.markers[1]?.active, true);
  assert.equal(sections.bossPhaseTracker?.markers[2]?.thresholdPercent, 25);
});

test("battle panel actions disable when it is not the controlled camp's turn", () => {
  const update = createBattleUpdate();
  if (update.battle) {
    update.battle.activeUnitId = "neutral-1-stack";
  }

  const sections = buildBattlePanelSections({
    update,
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-1-stack",
    actionPending: false,
    feedback: null,
    presentationState: null
  });

  assert.equal(sections.actions.every((action) => action.enabled === false), true);
});

test("battle unit visuals switch to the selected portrait variant for the chosen target", () => {
  assert.equal(resolveBattlePanelUnitVisual("orc_warrior", { selected: false }).portraitState, "idle");
  assert.equal(resolveBattlePanelUnitVisual("orc_warrior", { selected: true }).portraitState, "selected");
});

test("VeilBattlePanel renders an idle placeholder when no battle payload is present", () => {
  const { component } = createComponentHarness(VeilBattlePanel, { name: "BattlePanelRoot", width: 272, height: 400 });

  component.configure({});
  component.render(createBattlePanelState({ update: { ...createBattleUpdate(), battle: null } }));

  const statefulComponent = component as VeilBattlePanel & Record<string, unknown>;

  assert.equal((statefulComponent.titleLabel as { string: string } | null)?.string, "战斗面板");
  assert.match(String((statefulComponent.summaryLabel as { string: string } | null)?.string ?? ""), /当前没有战斗/);
  assert.equal(statefulComponent.stageBanner, null);
  component.onDestroy();
});

test("VeilBattlePanel preserves settlement feedback after battle resolution", () => {
  const { component, node } = createComponentHarness(VeilBattlePanel, { name: "BattlePanelRoot", width: 272, height: 420 });

  component.configure({});
  component.render(
    createBattlePanelState({
      update: { ...createBattleUpdate(), battle: null },
      feedback: {
        title: "战斗胜利",
        detail: "PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 0 队 · 战利品：金币 +12 · 准备返回世界地图",
        badge: "WIN",
        tone: "victory"
      },
      presentationState: {
        battleId: "battle-1",
        phase: "resolution",
        moment: "result_victory",
        label: "战斗胜利",
        detail: "PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 0 队 · 战利品：金币 +12 · 准备返回世界地图",
        badge: "WIN",
        tone: "victory",
        result: "victory",
        summaryLines: [
          "反馈层：动画 胜利 / 音效 胜利 / 转场 结算",
          "播报：PVE 遭遇已关闭 · 战线：我方剩余 1 队 / 对方剩余 0 队 · 战利品：金币 +12 · 准备返回世界地图",
          "战利品：金币 +12"
        ],
        phaseTransitionEvent: null,
        feedbackLayer: {
          animation: "victory",
          cue: "victory",
          transition: "exit",
          durationMs: 4200,
          pauseDurationMs: null
        }
      }
    })
  );

  const statefulComponent = component as VeilBattlePanel & Record<string, unknown>;

  assert.equal((statefulComponent.titleLabel as { string: string } | null)?.string, "战斗结算");
  assert.match(String((statefulComponent.feedbackLabel as { string: string } | null)?.string ?? ""), /战斗胜利/);
  assert.match(String((statefulComponent.summaryLabel as { string: string } | null)?.string ?? ""), /反馈层：动画 胜利/);
  assert.match(String((statefulComponent.summaryLabel as { string: string } | null)?.string ?? ""), /战利品：金币 \+12/);
  component.onDestroy();
});

test("VeilBattlePanel rerenders from an active turn into a pending-resolution state", () => {
  const { component } = createComponentHarness(VeilBattlePanel, { name: "BattlePanelRoot", width: 272, height: 520 });

  component.configure({});
  component.render(createBattlePanelState());

  const statefulComponent = component as VeilBattlePanel & Record<string, unknown>;
  const stageBanner = statefulComponent.stageBanner as { title: { string: string } } | null;
  const summaryBefore = String((statefulComponent.summaryLabel as { string: string } | null)?.string ?? "");

  assert.match(String(stageBanner?.title.string ?? ""), /中立遭遇/);
  assert.match(summaryBefore, /阶段：轮到我方/);

  component.render(createBattlePanelState({ actionPending: true }));

  assert.match(String((statefulComponent.summaryLabel as { string: string } | null)?.string ?? ""), /阶段：正在结算行动/);
  component.onDestroy();
});

test("VeilBattlePanel renders the transient boss phase banner and threshold tracker", () => {
  const { component } = createComponentHarness(VeilBattlePanel, { name: "BattlePanelRoot", width: 272, height: 560 });

  component.configure({});
  component.render(
    createBattlePanelState({
      update: createBossBattleUpdate(),
      presentationState: {
        battleId: "battle-1",
        phase: "impact",
        moment: "impact_hit",
        label: "首领阶段切换",
        detail: "血线跌破 55% · Mist-woven chains drag the front line down.",
        badge: "P2",
        tone: "skill",
        result: null,
        summaryLines: ["首领阶段：阶段 2 · Warden Grip · 阈值 55% HP"],
        phaseTransitionEvent: {
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
          summaryLines: ["首领阶段切换：阶段 1 · Veil -> 阶段 2 · Warden Grip"]
        },
        feedbackLayer: {
          animation: "hit",
          cue: "hit",
          transition: null,
          durationMs: null,
          pauseDurationMs: 900
        }
      }
    })
  );

  const statefulComponent = component as VeilBattlePanel & Record<string, unknown>;
  const phaseBanner = statefulComponent.phaseBanner as { title: { string: string }; meta: { string: string }; badge: { string: string } } | null;
  const phaseTracker = statefulComponent.phaseTracker as { title: { string: string }; meta: { string: string } } | null;

  assert.match(String(phaseBanner?.title.string ?? ""), /Warden Grip/);
  assert.match(String(phaseBanner?.meta.string ?? ""), /55%/);
  assert.equal(String(phaseBanner?.badge.string ?? ""), "P2");
  assert.match(String(phaseTracker?.title.string ?? ""), /Shadow Warden/);
  assert.match(String(phaseTracker?.meta.string ?? ""), /当前血量 5\/10 HP/);
  component.onDestroy();
});
