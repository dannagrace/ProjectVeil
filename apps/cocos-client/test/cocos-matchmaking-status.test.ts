import assert from "node:assert/strict";
import test from "node:test";
import { buildMatchmakingStatusView } from "../assets/scripts/cocos-matchmaking-status.ts";

test("buildMatchmakingStatusView formats queued queue position and wait labels", () => {
  const view = buildMatchmakingStatusView({
    status: "queued",
    position: 4,
    estimatedWaitSeconds: 27
  });

  assert.deepEqual(view, {
    statusLabel: "排位搜索中",
    queuePositionLabel: "前方还有 3 组对手",
    waitEstimateLabel: "预计 27s 开赛",
    matchedLabel: "排队期间会保留今日冲榜势头，配到人后就能立刻开打。",
    canCancel: true,
    isMatched: false
  });
});

test("buildMatchmakingStatusView formats matched room and player labels", () => {
  const view = buildMatchmakingStatusView({
    status: "matched",
    roomId: "pvp-match-7",
    playerIds: ["player-1", "player-2"],
    seedOverride: 1007
  });

  assert.equal(view.statusLabel, "对手已锁定");
  assert.equal(view.queuePositionLabel, "房间已就绪");
  assert.equal(view.waitEstimateLabel, "现在就能开战");
  assert.match(view.matchedLabel, /房间 pvp-match-7/);
  assert.match(view.matchedLabel, /player-1 vs player-2/);
  assert.match(view.matchedLabel, /地图种子 1007/);
  assert.equal(view.canCancel, false);
  assert.equal(view.isMatched, true);
});

test("buildMatchmakingStatusView falls back to an idle shell", () => {
  assert.deepEqual(buildMatchmakingStatusView({ status: "idle" }), {
    statusLabel: "暂未开始排位",
    queuePositionLabel: "队列状态：空闲",
    waitEstimateLabel: "等待你发起下一局",
    matchedLabel: "打一场 PVP，就能刷新今日排位和社交战报。",
    canCancel: false,
    isMatched: false
  });
});
