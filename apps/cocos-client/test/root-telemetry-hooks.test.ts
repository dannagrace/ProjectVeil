import assert from "node:assert/strict";
import test from "node:test";
import {
  emitPrimaryClientTelemetryForRoot,
  handleAssetLoadFailureForRoot
} from "../assets/scripts/root/telemetry-hooks.ts";

test("emitPrimaryClientTelemetryForRoot prepends new events and caps the buffer", () => {
  const state = {
    primaryClientTelemetry: Array.from({ length: 12 }, (_, index) => ({
      at: `2026-04-20T00:00:${String(index).padStart(2, "0")}.000Z`,
      category: "session",
      checkpoint: `old-${index}`,
      status: "info",
      detail: `old detail ${index}`,
      roomId: "room-1",
      playerId: "player-1"
    }))
  };

  emitPrimaryClientTelemetryForRoot(state, {
    at: "2026-04-20T00:01:00.000Z",
    category: "battle",
    checkpoint: "newest",
    status: "positive",
    detail: "battle won",
    roomId: "room-1",
    playerId: "player-1"
  });

  assert.equal(state.primaryClientTelemetry.length, 12);
  assert.equal(state.primaryClientTelemetry[0]?.checkpoint, "newest");
  assert.equal(state.primaryClientTelemetry.at(-1)?.checkpoint, "old-10");
});

test("handleAssetLoadFailureForRoot only surfaces final critical failures once", () => {
  const pushedLogs: string[] = [];
  let renderCalls = 0;
  const state = {
    lastAssetFailureNoticeKey: null as string | null,
    achievementNotice: null as Record<string, unknown> | null,
    pushLog(line: string) {
      pushedLogs.push(line);
    },
    renderView() {
      renderCalls += 1;
    }
  };

  handleAssetLoadFailureForRoot(state, {
    assetType: "sprite",
    assetPath: "pixel/ui/banner.png",
    retryCount: 3,
    critical: true,
    finalFailure: true,
    errorMessage: "network_timeout"
  });
  handleAssetLoadFailureForRoot(state, {
    assetType: "sprite",
    assetPath: "pixel/ui/banner.png",
    retryCount: 3,
    critical: true,
    finalFailure: true,
    errorMessage: "network_timeout"
  });

  assert.equal(renderCalls, 1);
  assert.equal(pushedLogs.length, 1);
  assert.match(pushedLogs[0] ?? "", /pixel\/ui\/banner\.png/);
  assert.equal(state.lastAssetFailureNoticeKey, "sprite:pixel/ui/banner.png");
  assert.equal(state.achievementNotice?.title, "资源加载异常");
});
