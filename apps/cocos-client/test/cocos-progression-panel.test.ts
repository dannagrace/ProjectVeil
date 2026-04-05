import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosBattlePassPanelView } from "../assets/scripts/cocos-progression-panel.ts";
import { VeilProgressionPanel } from "../assets/scripts/VeilProgressionPanel.ts";
import { createComponentHarness, findNode, pressNode, readCardLabel, readLabelString } from "./helpers/cocos-panel-harness.ts";

test("buildCocosBattlePassPanelView hides the panel when battle_pass_enabled is false", () => {
  const view = buildCocosBattlePassPanelView({
    progress: {
      battlePassEnabled: false,
      seasonXp: 0,
      seasonPassTier: 1,
      seasonPassPremium: false,
      seasonPassClaimedTiers: []
    },
    pendingClaimTier: null,
    pendingPremiumPurchase: false,
    statusLabel: "battle_pass_enabled = false"
  });

  assert.equal(view.visible, false);
  assert.equal(view.premiumPurchaseEnabled, false);
});

test("VeilProgressionPanel renders battle pass rewards and routes taps to claim and premium actions", () => {
  const claimedTiers: number[] = [];
  let premiumPurchaseCount = 0;
  const { component, node } = createComponentHarness(VeilProgressionPanel, {
    name: "ProgressionPanelRoot",
    width: 380,
    height: 440
  });

  component.configure({
    onClaimTier: (tier) => {
      claimedTiers.push(tier);
    },
    onPurchasePremium: () => {
      premiumPurchaseCount += 1;
    }
  });

  component.render({
    battlePass: buildCocosBattlePassPanelView({
      progress: {
        battlePassEnabled: true,
        seasonXp: 1200,
        seasonPassTier: 3,
        seasonPassPremium: false,
        seasonPassClaimedTiers: [1]
      },
      pendingClaimTier: null,
      pendingPremiumPurchase: false,
      statusLabel: "可领取当前解锁奖励。"
    })
  });

  assert.match(readCardLabel(node, "BattlePassHeader"), /赛季通行证/);
  assert.match(readCardLabel(node, "BattlePassNextReward"), /下一奖励/);
  assert.match(readCardLabel(node, "BattlePassTrack-0-free"), /免费奖励/);
  assert.match(readCardLabel(node, "BattlePassTrack-0-premium"), /高级奖励/);
  assert.match(readLabelString(findNode(node, "BattlePassPremiumAction")), /解锁高级通行证/);

  pressNode(findNode(node, "BattlePassTrack-0-free"));
  pressNode(findNode(node, "BattlePassPremiumAction"));

  assert.deepEqual(claimedTiers, [3]);
  assert.equal(premiumPurchaseCount, 1);
});

test("VeilProgressionPanel disables taps while a tier claim is pending", () => {
  const claimedTiers: number[] = [];
  const { component, node } = createComponentHarness(VeilProgressionPanel, {
    name: "ProgressionPanelRoot",
    width: 380,
    height: 440
  });

  component.configure({
    onClaimTier: (tier) => {
      claimedTiers.push(tier);
    }
  });

  component.render({
    battlePass: buildCocosBattlePassPanelView({
      progress: {
        battlePassEnabled: true,
        seasonXp: 2200,
        seasonPassTier: 5,
        seasonPassPremium: true,
        seasonPassClaimedTiers: [1, 2, 3]
      },
      pendingClaimTier: 5,
      pendingPremiumPurchase: false,
      statusLabel: "正在领取奖励..."
    })
  });

  assert.match(readCardLabel(node, "BattlePassTrack-0-free"), /领取中/);
  pressNode(findNode(node, "BattlePassTrack-0-free"));

  assert.deepEqual(claimedTiers, []);
});
