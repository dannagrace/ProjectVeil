import assert from "node:assert/strict";
import test from "node:test";
import { Sprite, UIOpacity } from "cc";
import { VeilBattleTransition } from "../assets/scripts/VeilBattleTransition.ts";
import { loadPixelSpriteAssets } from "../assets/scripts/cocos-pixel-sprites.ts";
import { createComponentHarness, findNode, readLabelString } from "./helpers/cocos-panel-harness.ts";
import { useCcSpriteResourceDoubles } from "./helpers/cc-sprite-resources.ts";

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test("VeilBattleTransition uses pixel terrain frames for the formal battle overlay", async (t) => {
  useCcSpriteResourceDoubles(t);
  await loadPixelSpriteAssets("boot");

  const { component, node } = createComponentHarness(VeilBattleTransition, {
    name: "BattleTransitionRoot",
    width: 960,
    height: 640
  });
  const statefulComponent = component as VeilBattleTransition & Record<string, unknown>;
  statefulComponent.scheduleOnce = ((callback: () => void) => {
    callback();
    return undefined;
  }) as typeof component.scheduleOnce;

  component.onLoad();
  await flushMicrotasks();

  await component.playEnter({
    badge: "ENGAGE",
    title: "遭遇中立守军",
    subtitle: "切入战斗场景",
    tone: "enter",
    terrain: "sand",
    detailChips: [
      { icon: "battle", label: "中立遭遇" },
      { icon: "hero", label: "Guard x12" }
    ]
  });

  const overlayNode = findNode(node, "ProjectVeilBattleOverlay");
  const terrainNode = findNode(node, "ProjectVeilBattleOverlayTerrain");
  const terrainSprite = terrainNode?.getComponent(Sprite) ?? null;
  const terrainOpacity = terrainNode?.getComponent(UIOpacity) ?? null;

  assert.equal(readLabelString(findNode(node, "ProjectVeilBattleOverlayBadge")), "ENGAGE");
  assert.equal(readLabelString(findNode(node, "ProjectVeilBattleOverlayTitle")), "遭遇中立守军");
  assert.equal(readLabelString(findNode(node, "ProjectVeilBattleOverlaySubtitle")), "切入战斗场景");
  assert.equal(terrainNode?.active, true);
  assert.equal(terrainSprite?.spriteFrame?.name, "pixel/terrain/sand-tile");
  assert.equal(terrainOpacity?.opacity, 246);
  assert.equal(findNode(node, "ProjectVeilBattleOverlayChips")?.active, true);
  assert.equal(overlayNode?.active, false);

  await component.playExit({
    badge: "VICTORY",
    title: "战斗胜利",
    subtitle: "返回世界地图",
    tone: "victory",
    terrain: null,
    detailChips: []
  });

  assert.equal(readLabelString(findNode(node, "ProjectVeilBattleOverlayBadge")), "VICTORY");
  assert.equal(readLabelString(findNode(node, "ProjectVeilBattleOverlayTitle")), "战斗胜利");
  assert.equal(terrainNode?.active, false);
  assert.equal(terrainSprite?.spriteFrame, null);
  assert.equal(terrainOpacity?.opacity, 0);
  assert.equal(findNode(node, "ProjectVeilBattleOverlayChips")?.active, false);
});
