import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
} from "../../apps/server/src/observability";
import { runRuntimeSloSummaryCli } from "../runtime-slo-summary.ts";

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

test("runRuntimeSloSummaryCli returns exit code 1 and writes all artifacts when candidate_gate fails", async () => {
  // Seed a failing observability state (too few rooms, no gameplay traffic)
  resetRuntimeObservability();
  for (let index = 0; index < 3; index += 1) {
    recordRuntimeRoom({
      roomId: `room-${index + 1}`,
      day: 3,
      connectedPlayers: 1,
      heroCount: 2,
      activeBattles: 0,
      updatedAt: "2026-04-16T12:00:00.000Z"
    });
  }

  const payload = buildRuntimeSloSummaryPayload("project-veil-test");
  const markdown = renderRuntimeSloSummaryMarkdown(payload);
  const text = renderRuntimeSloSummaryText(payload);

  const candidateGate = payload.profiles.find((p) => p.id === "candidate_gate");
  assert.equal(candidateGate?.status, "fail", "setup: candidate_gate must be failing for this test to be meaningful");

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-slo-cli-test-"));
  const jsonPath = path.join(workspace, "slo.json");
  const mdPath = path.join(workspace, "slo.md");
  const txtPath = path.join(workspace, "slo.txt");
  const serverUrl = "http://127.0.0.1:19999";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url === `${serverUrl}/api/runtime/slo-summary`) {
      return { ok: true, status: 200, json: async () => payload, text: async () => "" } as Response;
    }
    if (url === `${serverUrl}/api/runtime/slo-summary?format=markdown`) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => markdown } as Response;
    }
    if (url === `${serverUrl}/api/runtime/slo-summary?format=text`) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => text } as Response;
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  try {
    const exitCode = await runRuntimeSloSummaryCli([
      "node",
      "scripts/runtime-slo-summary.ts",
      "--server-url",
      serverUrl,
      "--profile",
      "candidate_gate",
      "--output",
      jsonPath,
      "--markdown-output",
      mdPath,
      "--text-output",
      txtPath
    ]);

    assert.equal(exitCode, 1, "CLI must exit with code 1 when candidate_gate is failing");
    assert.ok(fs.existsSync(jsonPath), "JSON artifact must be written even when candidate_gate fails");
    assert.ok(fs.existsSync(mdPath), "markdown artifact must be written even when candidate_gate fails");
    assert.ok(fs.existsSync(txtPath), "text artifact must be written even when candidate_gate fails");

    const written = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.equal(written.profiles.find((p: { id: string }) => p.id === "candidate_gate")?.status, "fail");
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
