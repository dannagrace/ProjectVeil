import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRuntimeDiagnosticsErrorEvent } from "../../packages/shared/src/index.ts";
import {
  buildCandidateRevisionTriageDigestFromPaths,
  renderMarkdown
} from "../candidate-revision-triage-digest.ts";

const repoRoot = path.resolve(__dirname, "../..");

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-candidate-triage-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("candidate triage digest aggregates server and h5 fingerprint summaries for one candidate revision", () => {
  const workspace = createTempWorkspace();
  const serverSnapshotPath = path.join(workspace, "server-runtime-diagnostic.json");
  const clientSnapshotPath = path.join(workspace, "client-runtime-diagnostic.json");

  writeJson(serverSnapshotPath, {
    schemaVersion: 1,
    exportedAt: "2026-04-04T10:00:00.000Z",
    source: { surface: "server-observability", devOnly: false, mode: "server" },
    room: null,
    world: null,
    battle: null,
    account: null,
    overview: null,
    diagnostics: {
      eventTypes: [],
      timelineTail: [],
      logTail: [],
      recoverySummary: null,
      predictionStatus: "server-observability",
      pendingUiTasks: 0,
      replay: null,
      primaryClientTelemetry: [],
      errorEvents: [
        buildRuntimeDiagnosticsErrorEvent({
          id: "server-share-1",
          recordedAt: "2026-04-04T09:59:00.000Z",
          source: "server",
          surface: "server",
          candidateRevision: "abc1234",
          featureArea: "share",
          ownerArea: "social",
          severity: "error",
          errorCode: "share_webhook_failed",
          message: "Share webhook returned 502.",
          context: {
            roomId: "room-share",
            playerId: "player-1",
            requestId: "share-1",
            route: "/api/share/publish",
            action: "share.publish",
            statusCode: 502,
            crash: false,
            detail: "upstream gateway failure"
          }
        })
      ],
      errorSummary: {
        totalEvents: 1,
        uniqueFingerprints: 1,
        fatalCount: 0,
        crashCount: 0,
        latestRecordedAt: "2026-04-04T09:59:00.000Z",
        byFeatureArea: [{ featureArea: "share", count: 1 }],
        topFingerprints: []
      }
    }
  });

  writeJson(clientSnapshotPath, {
    schemaVersion: 1,
    exportedAt: "2026-04-04T10:01:00.000Z",
    source: { surface: "h5-debug-shell", devOnly: true, mode: "world" },
    room: null,
    world: null,
    battle: null,
    account: null,
    overview: null,
    diagnostics: {
      eventTypes: [],
      timelineTail: [],
      logTail: [],
      recoverySummary: null,
      predictionStatus: null,
      pendingUiTasks: 1,
      replay: null,
      primaryClientTelemetry: [],
      errorEvents: [
        buildRuntimeDiagnosticsErrorEvent({
          id: "client-login-1",
          recordedAt: "2026-04-04T10:00:30.000Z",
          source: "client",
          surface: "h5",
          candidateRevision: "abc1234",
          featureArea: "login",
          ownerArea: "account",
          severity: "fatal",
          errorCode: "auth_request_failed",
          message: "Login request failed and crashed the shell.",
          context: {
            roomId: null,
            playerId: "player-2",
            requestId: "auth-1",
            route: "/api/auth/login",
            action: "login.submit",
            statusCode: 500,
            crash: true,
            detail: "uncaught error boundary"
          }
        }),
        buildRuntimeDiagnosticsErrorEvent({
          id: "client-login-2",
          recordedAt: "2026-04-04T10:00:45.000Z",
          source: "client",
          surface: "h5",
          candidateRevision: "abc1234",
          featureArea: "login",
          ownerArea: "account",
          severity: "error",
          errorCode: "auth_request_failed",
          message: "Login request failed again.",
          context: {
            roomId: null,
            playerId: "player-3",
            requestId: "auth-2",
            route: "/api/auth/login",
            action: "login.submit",
            statusCode: 500,
            crash: false,
            detail: "same server 500"
          }
        })
      ],
      errorSummary: {
        totalEvents: 2,
        uniqueFingerprints: 1,
        fatalCount: 1,
        crashCount: 1,
        latestRecordedAt: "2026-04-04T10:00:45.000Z",
        byFeatureArea: [{ featureArea: "login", count: 2 }],
        topFingerprints: []
      }
    }
  });

  const digest = buildCandidateRevisionTriageDigestFromPaths({
    candidate: "phase1-rc",
    candidateRevision: "abc1234",
    inputPaths: [serverSnapshotPath, clientSnapshotPath]
  });

  assert.equal(digest.summary.totalEvents, 3);
  assert.equal(digest.summary.uniqueFingerprints, 2);
  assert.equal(digest.summary.fatalCount, 1);
  assert.equal(digest.summary.crashCount, 1);
  assert.equal(digest.topFingerprints[0]?.errorCode, "auth_request_failed");
  assert.equal(digest.topFingerprints[0]?.count, 2);
  assert.equal(digest.topFingerprints[0]?.suggestedOwner, "account");
  assert.equal(digest.artifacts[0]?.matchedEventCount, 1);
  assert.equal(digest.artifacts[1]?.matchedEventCount, 2);

  const markdown = renderMarkdown(digest);
  assert.match(markdown, /Candidate: `phase1-rc`/);
  assert.match(markdown, /`login`: 2 event\(s\), suggested owner `account`/);
  assert.match(markdown, /First seen revision: `abc1234`/);
});

test("candidate triage digest CLI writes json and markdown artifacts", () => {
  const workspace = createTempWorkspace();
  const inputPath = path.join(workspace, "client-errors.json");
  const outputPath = path.join(workspace, "candidate-triage.json");
  const markdownOutputPath = path.join(workspace, "candidate-triage.md");

  writeJson(inputPath, {
    errorEvents: [
      buildRuntimeDiagnosticsErrorEvent({
        id: "reward-1",
        recordedAt: "2026-04-04T11:00:00.000Z",
        source: "client",
        surface: "h5",
        candidateRevision: "abc1234",
        featureArea: "rewards",
        ownerArea: "progression",
        severity: "error",
        errorCode: "daily_reward_claim_failed",
        message: "Daily reward claim failed for one candidate.",
        context: {
          roomId: "room-alpha",
          playerId: "player-9",
          requestId: "reward-1",
          route: "/api/player-account/daily-reward",
          action: "reward.claim",
          statusCode: 409,
          crash: false,
          detail: "stale reward state"
        }
      })
    ]
  });

  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/candidate-revision-triage-digest.ts",
      "--candidate",
      "phase1-rc",
      "--candidate-revision",
      "abc1234",
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(markdownOutputPath), true);
});
