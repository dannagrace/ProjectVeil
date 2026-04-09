import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPhase1CandidateDossier, resolveLatestFile } from "../phase1-candidate-dossier.ts";

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-phase1-dossier-fallbacks-"));
}

function writeRuntimeGateArtifact(artifactsDir: string, revision: string): string {
  const runtimeGatePath = path.join(artifactsDir, `runtime-observability-gate-${revision}.json`);
  writeJson(runtimeGatePath, {
    schemaVersion: 1,
    generatedAt: "2026-04-05T08:45:05.000Z",
    candidate: {
      name: "phase1-rc",
      revision,
      shortRevision: revision,
      branch: "main",
      dirty: false,
      targetSurface: "wechat"
    },
    targetEnvironment: {
      label: "staging",
      serverUrl: "https://veil-staging.example.com"
    },
    summary: {
      status: "passed",
      headline: "Runtime health, auth readiness, and metrics passed for the target environment.",
      endpointStatuses: {
        "runtime-health": "passed",
        "auth-readiness": "passed",
        "runtime-metrics": "passed"
      }
    },
    readiness: {
      activeRoomCount: 3,
      connectionCount: 11,
      activeBattleCount: 1,
      heroCount: 5,
      actionMessagesTotal: 182,
      worldActionsTotal: 140,
      battleActionsTotal: 42,
      activeGuestSessionCount: 4,
      activeAccountSessionCount: 7,
      activeAccountLockCount: 0,
      pendingRegistrationCount: 0,
      pendingRecoveryCount: 0,
      tokenDeliveryQueueCount: 0,
      tokenDeliveryDeadLetterCount: 0,
      wechatLoginMode: "production",
      wechatCredentialsStatus: "configured",
      authHeadline: "Auth readiness is healthy."
    },
    endpoints: [
      {
        id: "runtime-health",
        label: "Runtime health",
        url: "https://veil-staging.example.com/api/runtime/health",
        status: "passed",
        httpStatus: 200,
        summary: "Runtime health responded with an OK payload.",
        observedAt: "2026-04-05T08:45:00.000Z",
        freshness: "fresh",
        details: ["activeRooms=3", "connections=11", "actions=182"],
        keyReadinessFields: {
          activeRoomCount: 3,
          connectionCount: 11,
          actionMessagesTotal: 182
        }
      },
      {
        id: "auth-readiness",
        label: "Auth readiness",
        url: "https://veil-staging.example.com/api/runtime/auth-readiness",
        status: "passed",
        httpStatus: 200,
        summary: "Auth readiness is healthy.",
        observedAt: "2026-04-05T08:45:05.000Z",
        freshness: "fresh",
        details: ["lockouts=0", "pendingRegistrations=0", "pendingRecoveries=0"],
        keyReadinessFields: {
          activeAccountLockCount: 0,
          pendingRegistrationCount: 0,
          pendingRecoveryCount: 0
        }
      },
      {
        id: "runtime-metrics",
        label: "Runtime metrics",
        url: "https://veil-staging.example.com/api/runtime/metrics",
        status: "passed",
        httpStatus: 200,
        summary: "Runtime metrics exposed the required Prometheus counters.",
        observedAt: "2026-04-05T08:45:05.000Z",
        freshness: "fresh",
        details: ["Required Prometheus metrics are present."],
        keyReadinessFields: {
          veil_active_room_count: true,
          veil_connection_count: true,
          veil_gameplay_action_messages_total: true,
          veil_auth_account_sessions: true,
          veil_auth_token_delivery_queue_count: true
        }
      }
    ]
  });
  return runtimeGatePath;
}

test("resolveLatestFile keeps asset-manifest fallback deterministic when candidate mtimes tie", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts");
  const alphaPath = path.join(artifactsDir, "asset-manifest-alpha.json");
  const betaPath = path.join(artifactsDir, "asset-manifest-beta.json");
  writeJson(alphaPath, { id: "alpha" });
  writeJson(betaPath, { id: "beta" });

  const tiedDate = new Date("2026-04-09T00:00:00.000Z");
  fs.utimesSync(alphaPath, tiedDate, tiedDate);
  fs.utimesSync(betaPath, tiedDate, tiedDate);

  assert.equal(
    resolveLatestFile(artifactsDir, (entry) => entry.startsWith("asset-manifest-") && entry.endsWith(".json")),
    alphaPath
  );
});

test("phase1 candidate dossier keeps missing bundle fallback recoverable while marking the exit gate failed", async () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const revision = "abc1234";

  const snapshotPath = path.join(artifactsDir, "release-readiness-pass.json");
  const h5SmokePath = path.join(artifactsDir, "client-release-candidate-smoke-pass.json");
  const reconnectSoakPath = path.join(artifactsDir, "colyseus-reconnect-soak-summary-pass.json");
  const persistencePath = path.join(artifactsDir, `phase1-release-persistence-regression-${revision}.json`);
  const runtimeObservabilityGatePath = writeRuntimeGateArtifact(artifactsDir, revision);
  const missingBundlePath = path.join(artifactsDir, "missing-bundle.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-04-05T08:30:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    summary: { status: "passed", requiredFailed: 0, requiredPending: 0 },
    checks: [{ id: "npm-test", required: true, status: "passed" }]
  });
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-05T08:32:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    execution: { status: "passed", exitCode: 0 },
    summary: { total: 2, passed: 2, failed: 0 }
  });
  writeJson(reconnectSoakPath, {
    generatedAt: "2026-04-05T08:33:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    status: "passed",
    summary: { failedScenarios: 0, scenarioNames: ["reconnect_soak"] },
    soakSummary: { reconnectAttempts: 64, invariantChecks: 256 },
    results: [
      {
        scenario: "reconnect_soak",
        failedRooms: 0,
        runtimeHealthAfterCleanup: {
          activeRoomCount: 0,
          connectionCount: 0,
          activeBattleCount: 0,
          heroCount: 0
        }
      }
    ]
  });
  writeJson(persistencePath, {
    generatedAt: "2026-04-05T08:41:00.000Z",
    revision: { commit: revision, shortCommit: revision },
    requestedStorageMode: "memory",
    effectiveStorageMode: "memory",
    storageDescription: "In-memory snapshot store.",
    summary: { status: "passed", assertionCount: 6 },
    contentValidation: {
      valid: true,
      bundleCount: 5,
      summary: "All shipped content packs validated.",
      issueCount: 0
    },
    persistenceRegression: { mapPackId: "phase1", assertions: ["room hydration reapplied resources"] }
  });

  const dossier = await buildPhase1CandidateDossier({
    candidate: "phase1-rc",
    candidateRevision: revision,
    runtimeObservabilityGatePath,
    snapshotPath,
    h5SmokePath,
    reconnectSoakPath,
    cocosBundlePath: missingBundlePath,
    persistencePath,
    targetSurface: "h5",
    maxEvidenceAgeHours: 72
  });

  const cocosSection = dossier.sections.find((section) => section.id === "cocos-rc-bundle");
  assert.equal(cocosSection?.result, "pending");
  assert.equal(cocosSection?.artifactPath, missingBundlePath);
  assert.match(cocosSection?.summary ?? "", /manifest is missing/i);
  assert.match(cocosSection?.details.join("\n") ?? "", /release:cocos-rc:bundle/);
  assert.equal(dossier.summary.requiredPending.includes("Cocos RC bundle"), true);
  assert.equal(dossier.phase1ExitEvidenceGate.result, "failed");
  assert.equal(dossier.summary.status, "failed");
});
