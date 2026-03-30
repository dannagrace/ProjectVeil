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
