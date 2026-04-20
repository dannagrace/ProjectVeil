import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeSloSummaryPayload,
  recordActionValidationFailure,
  recordAuthTokenDeliveryFailure,
  recordAuthTokenDeliveryRequest,
  recordAuthTokenDeliverySuccess,
  recordBattleActionMessage,
  recordReconnectWindowOpened,
  recordReconnectWindowResolved,
  recordRuntimeRoom,
  recordWorldActionMessage,
  renderRuntimeSloSummaryMarkdown,
  renderRuntimeSloSummaryText,
  resetRuntimeObservability,
  setAuthTokenDeliveryQueueLatency
} from "@server/domain/ops/observability";

function seedRooms(count: number): void {
  for (let index = 0; index < count; index += 1) {
    recordRuntimeRoom({
      roomId: `room-${index + 1}`,
      day: 3,
      connectedPlayers: 1,
      heroCount: 2,
      activeBattles: index % 2,
      updatedAt: "2026-04-04T12:00:00.000Z"
    });
  }
}

test("buildRuntimeSloSummaryPayload emits a passing JSON/Markdown/text contract", () => {
  resetRuntimeObservability();
  seedRooms(48);
  for (let index = 0; index < 180; index += 1) {
    recordWorldActionMessage();
  }
  for (let index = 0; index < 72; index += 1) {
    recordBattleActionMessage();
  }
  recordReconnectWindowOpened();
  recordReconnectWindowResolved("success");
  recordAuthTokenDeliveryRequest();
  recordAuthTokenDeliverySuccess();
  setAuthTokenDeliveryQueueLatency({
    oldestQueuedLatencyMs: 120,
    nextAttemptDelayMs: 0
  });

  const report = buildRuntimeSloSummaryPayload("project-veil-test");
  const markdown = renderRuntimeSloSummaryMarkdown(report);
  const text = renderRuntimeSloSummaryText(report);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.service, "project-veil-test");
  assert.equal(report.status, "pass");
  assert.equal(report.snapshot.roomCount, 48);
  assert.equal(report.snapshot.reconnectBacklog, 0);
  assert.equal(report.snapshot.queueLatencyMs, 120);
  assert.equal(report.snapshot.gameplayErrorRate, 0);
  assert.equal(report.snapshot.reconnectErrorRate, 0);
  assert.equal(report.snapshot.tokenDeliveryErrorRate, 0);
  assert.equal(report.profiles.find((profile) => profile.id === "candidate_gate")?.status, "pass");
  assert.match(markdown, /# Runtime SLO Summary/);
  assert.match(markdown, /Candidate gate/);
  assert.match(text, /runtime_slo status=pass/);
});

test("buildRuntimeSloSummaryPayload classifies backlog, latency, and error-rate failures", () => {
  resetRuntimeObservability();
  seedRooms(10);
  for (let index = 0; index < 100; index += 1) {
    recordWorldActionMessage();
  }
  for (let index = 0; index < 5; index += 1) {
    recordActionValidationFailure("world", "hero_not_owned_by_player");
  }
  recordReconnectWindowOpened();
  recordReconnectWindowOpened();
  recordReconnectWindowResolved("failure");
  for (let index = 0; index < 10; index += 1) {
    recordAuthTokenDeliveryRequest();
  }
  for (let index = 0; index < 2; index += 1) {
    recordAuthTokenDeliveryFailure("timeout");
  }
  setAuthTokenDeliveryQueueLatency({
    oldestQueuedLatencyMs: 3200,
    nextAttemptDelayMs: 900
  });

  const report = buildRuntimeSloSummaryPayload("project-veil-test");
  const candidateGate = report.profiles.find((profile) => profile.id === "candidate_gate");

  assert.equal(report.status, "fail");
  assert.equal(report.snapshot.reconnectBacklog, 1);
  assert.equal(report.snapshot.gameplayErrorRate, 0.05);
  assert.equal(report.snapshot.reconnectErrorRate, 0.5);
  assert.equal(report.snapshot.tokenDeliveryErrorRate, 0.2);
  assert.equal(candidateGate?.status, "fail");
  assert.equal(candidateGate?.checks.find((check) => check.id === "room_count")?.status, "fail");
  assert.equal(candidateGate?.checks.find((check) => check.id === "reconnect_backlog")?.status, "warn");
  assert.equal(candidateGate?.checks.find((check) => check.id === "queue_latency")?.status, "fail");
  assert.equal(candidateGate?.checks.find((check) => check.id === "gameplay_error_rate")?.status, "fail");
  assert.equal(candidateGate?.checks.find((check) => check.id === "reconnect_error_rate")?.status, "fail");
  assert.equal(candidateGate?.checks.find((check) => check.id === "token_delivery_error_rate")?.status, "fail");
  assert.match(renderRuntimeSloSummaryMarkdown(report), /Alert-Friendly Diagnostics/);
});
