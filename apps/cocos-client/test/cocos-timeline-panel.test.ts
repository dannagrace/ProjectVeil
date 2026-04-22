import assert from "node:assert/strict";
import test from "node:test";
import { VeilTimelinePanel } from "../assets/scripts/VeilTimelinePanel.ts";
import { loadPixelSpriteAssets } from "../assets/scripts/cocos-pixel-sprites.ts";
import { getPlaceholderSpriteAssetUsageSummary } from "../assets/scripts/cocos-placeholder-sprites.ts";
import { createComponentHarness, findNode, readLabelString } from "./helpers/cocos-panel-harness.ts";
import { useCcSpriteResourceDoubles } from "./helpers/cc-sprite-resources.ts";

test("VeilTimelinePanel retains placeholder sprites while entries exist and releases them when cleared", async (t) => {
  useCcSpriteResourceDoubles(t);
  await loadPixelSpriteAssets("boot");

  const { component } = createComponentHarness(VeilTimelinePanel, { name: "TimelinePanel", width: 280, height: 320 });

  component.render({
    entries: ["系统： 自动重连成功"]
  });

  let usage = getPlaceholderSpriteAssetUsageSummary();
  assert.equal(usage.referenceCounts.timeline, 1);

  component.render({
    entries: []
  });

  usage = getPlaceholderSpriteAssetUsageSummary();
  assert.equal(usage.referenceCounts.timeline, 0);

  component.onDestroy();
  usage = getPlaceholderSpriteAssetUsageSummary();
  assert.equal(usage.referenceCounts.timeline, 0);
});

test("VeilTimelinePanel renders timeline entries with icon and watermark transitions", async (t) => {
  useCcSpriteResourceDoubles(t);
  await loadPixelSpriteAssets("boot");

  const { component, node } = createComponentHarness(VeilTimelinePanel, { name: "TimelinePanel", width: 320, height: 360 });

  component.render({
    entries: [
      "系统： 房间权威状态恢复 · 推送缓存快照",
      "事件： 英雄凯琳获得木材 +5",
      "事件： 中立遭遇战胜利"
    ]
  });

  const headerIcon = findNode(node, "TimelineHeaderIcon");
  assert.ok(headerIcon, "expected header icon node");
  assert.equal(headerIcon.active, true);

  const watermark = findNode(node, "TimelineWatermark");
  assert.ok(watermark, "expected watermark node");
  assert.equal(watermark.active, false);

  const firstEntryLabel = findNode(node, "TimelineEntry-0-Label");
  assert.equal(readLabelString(firstEntryLabel), "房间权威状态恢复 · 推送缓存快照");
  const secondEntryBadge = findNode(node, "TimelineEntry-1")?.getChildByName("Badge");
  assert.match(readLabelString(secondEntryBadge), /事件/);
  assert.equal(readLabelString(findNode(node, "TimelineContent")), "时间线");

  component.render({
    entries: ["系统： 等待房间动态"]
  });
  assert.equal(watermark.active, false);

  component.render({ entries: [] });
  assert.equal(watermark.active, true);
  const summaryLabel = findNode(node, "TimelineContent");
  assert.match(readLabelString(summaryLabel), /等待房间动态/);
});
