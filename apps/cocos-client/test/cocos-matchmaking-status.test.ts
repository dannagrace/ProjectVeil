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
    statusLabel: "正在匹配…",
    queuePositionLabel: "位置 #4",
    waitEstimateLabel: "预计 27s",
    matchedLabel: "",
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

  assert.equal(view.statusLabel, "匹配成功");
  assert.equal(view.queuePositionLabel, "位置 -");
  assert.equal(view.waitEstimateLabel, "预计 0s");
  assert.match(view.matchedLabel, /房间 pvp-match-7/);
  assert.match(view.matchedLabel, /player-1 vs player-2/);
  assert.equal(view.canCancel, false);
  assert.equal(view.isMatched, true);
});

test("buildMatchmakingStatusView falls back to an idle shell", () => {
  assert.deepEqual(buildMatchmakingStatusView({ status: "idle" }), {
    statusLabel: "未在匹配",
    queuePositionLabel: "位置 -",
    waitEstimateLabel: "预计 --",
    matchedLabel: "",
    canCancel: false,
    isMatched: false
  });
});
