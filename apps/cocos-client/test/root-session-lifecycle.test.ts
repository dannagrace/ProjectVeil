import assert from "node:assert/strict";
import test from "node:test";
import {
  describeSessionErrorForRoot,
  resetSessionViewportForRoot
} from "../assets/scripts/root/session-lifecycle.ts";

test("describeSessionErrorForRoot maps known session failures to player-facing copy", () => {
  assert.match(
    describeSessionErrorForRoot(new Error("connect_timeout"), "fallback"),
    /房间连接失败|房间请求超时/
  );
  assert.match(
    describeSessionErrorForRoot(new Error("room_left"), "fallback"),
    /房间会话已失效/
  );
  assert.match(
    describeSessionErrorForRoot(new Error("upgrade_required"), "fallback"),
    /停止支持/
  );
});

test("resetSessionViewportForRoot clears transient battle/session state", () => {
  let battlePresentationReset = 0;
  const state = {
    lastUpdate: { id: "snapshot" },
    pendingPrediction: { id: "prediction" },
    selectedBattleTargetId: "enemy-1",
    moveInFlight: true,
    battleActionInFlight: true,
    battleFeedback: { tone: "warning" },
    battlePresentation: {
      reset() {
        battlePresentationReset += 1;
      }
    },
    predictionStatus: "busy",
    inputDebug: "clicked",
    timelineEntries: ["one", "two"],
    primaryClientTelemetry: [{ checkpoint: "foo" }],
    logLines: ["old"]
  };

  resetSessionViewportForRoot(state, "已返回大厅");

  assert.equal(state.lastUpdate, null);
  assert.equal(state.pendingPrediction, null);
  assert.equal(state.selectedBattleTargetId, null);
  assert.equal(state.moveInFlight, false);
  assert.equal(state.battleActionInFlight, false);
  assert.equal(state.battleFeedback, null);
  assert.equal(state.predictionStatus, "");
  assert.equal(state.inputDebug, "input waiting");
  assert.deepEqual(state.timelineEntries, []);
  assert.deepEqual(state.primaryClientTelemetry, []);
  assert.deepEqual(state.logLines, ["已返回大厅"]);
  assert.equal(battlePresentationReset, 1);
});
