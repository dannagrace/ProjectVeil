import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");
const fixtureBuildDir = path.join(repoRoot, "apps", "cocos-client", "test", "fixtures", "wechatgame-export");
const defaultConfigPath = path.join(repoRoot, "apps", "cocos-client", "wechat-minigame.build.json");

test("release:wechat:rehearsal produces structured + markdown summaries", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-rehearsal-"));
  const buildDir = path.join(workspace, "build");
  const artifactsDir = path.join(workspace, "artifacts");
  const summaryPath = path.join(workspace, "summary.json");
  const markdownPath = path.join(workspace, "summary.md");
  const runtimeEvidencePath = path.join(workspace, "runtime-evidence.json");
  const manualChecksPath = path.join(workspace, "manual-review.json");
  const recordedAt = new Date().toISOString();

  fs.cpSync(fixtureBuildDir, buildDir, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });

  fs.writeFileSync(
    runtimeEvidencePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        buildTemplatePlatform: "wechatgame",
        artifact: {
          archiveFileName: "project-veil-wechatgame-release.tar.gz",
          sourceRevision: "abc1234"
        },
        execution: {
          tester: "codex-bot",
          device: "iPhone 15 Pro / WeChat 8.0.50",
          clientVersion: "8.0.50",
          executedAt: recordedAt,
          result: "passed",
          summary: "Imported runtime evidence from the rehearsal lane."
        },
        cases: [
          { id: "startup", status: "passed", evidence: ["startup.mp4"] },
          { id: "lobby-entry", status: "passed", evidence: ["lobby.png"] },
          { id: "room-entry", status: "passed", evidence: ["room-entry.png"] },
          {
            id: "reconnect-recovery",
            status: "passed",
            evidence: ["reconnect.mp4"],
            requiredEvidence: {
              roomId: "room-alpha",
              reconnectPrompt: "连接已恢复",
              restoredState: "Restored room-alpha with the same hero state and lobby context."
            }
          },
          {
            id: "share-roundtrip",
            status: "not_applicable",
            evidence: ["share-roundtrip.txt"],
            requiredEvidence: {
              shareScene: "lobby",
              shareQuery: "roomId=room-alpha&inviterId=player-7",
              roundtripState: "Not executed in this rehearsal lane."
            }
          },
          { id: "key-assets", status: "passed", evidence: ["assets.log"] }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(artifactsDir, "runtime-observability-signoff.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        candidate: "phase1-rc",
        targetRevision: "abc1234",
        reviewer: "release-oncall",
        recordedAt,
        status: "passed"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(artifactsDir, "checklist-review.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        candidate: "phase1-rc",
        targetRevision: "abc1234",
        reviewer: "release-oncall",
        recordedAt,
        status: "passed",
        blockerIds: ["none"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(artifactsDir, "device-runtime-review.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        candidate: "phase1-rc",
        targetRevision: "abc1234",
        reviewer: "release-oncall",
        recordedAt,
        status: "passed"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    manualChecksPath,
    `${JSON.stringify(
      [
        {
          id: "wechat-devtools-export-review",
          title: "Candidate-scoped WeChat package install/launch verification recorded",
          status: "passed",
          required: true,
          notes: "Generated install/launch verification during the rehearsal.",
          evidence: [path.join(artifactsDir, "codex.wechat.install-launch-evidence.json")],
          owner: "release-oncall",
          recordedAt,
          revision: "abc1234",
          artifactPath: path.join(artifactsDir, "codex.wechat.install-launch-evidence.json")
        },
        {
          id: "wechat-device-runtime-review",
          title: "Physical-device WeChat runtime validated for this candidate",
          status: "passed",
          required: true,
          notes: "Attached the smoke report and capture set from the rehearsal runtime pass.",
          evidence: [
            path.join(artifactsDir, "codex.wechat.smoke-report.json"),
            path.join(artifactsDir, "device-runtime-review.json")
          ],
          owner: "release-oncall",
          recordedAt,
          revision: "abc1234",
          artifactPath: path.join(artifactsDir, "device-runtime-review.json")
        },
        {
          id: "wechat-runtime-observability-signoff",
          title: "WeChat runtime observability reviewed for this candidate",
          status: "passed",
          required: true,
          notes: "Captured health/auth-readiness/metrics evidence for the release environment.",
          evidence: [path.join(artifactsDir, "runtime-observability-signoff.json")],
          owner: "release-oncall",
          recordedAt,
          revision: "abc1234",
          artifactPath: path.join(artifactsDir, "runtime-observability-signoff.json")
        },
        {
          id: "wechat-release-checklist",
          title: "WeChat RC checklist and blockers reviewed",
          status: "passed",
          required: true,
          notes: "Checklist and blockers resolved for the packaged candidate.",
          evidence: [path.join(artifactsDir, "checklist-review.json")],
          owner: "release-oncall",
          recordedAt,
          revision: "abc1234",
          artifactPath: path.join(artifactsDir, "checklist-review.json")
        }
      ],
      null,
      2
    )}\n`,
    "utf8"
  );

  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/wechat-release-rehearsal.ts",
      "--config",
      defaultConfigPath,
      "--build-dir",
      buildDir,
      "--artifacts-dir",
      artifactsDir,
      "--summary",
      summaryPath,
      "--markdown",
      markdownPath,
      "--source-revision",
      "abc1234",
      "--expected-revision",
      "abc1234",
      "--candidate",
      "phase1-rc",
      "--environment",
      "wechat-devtools",
      "--operator",
      "release-oncall",
      "--status",
      "passed",
      "--verification-summary",
      "Candidate rehearsal package import and first launch passed.",
      "--evidence",
      "devtools-import-capture.png",
      "--evidence",
      "first-launch-capture.png",
      "--runtime-evidence",
      runtimeEvidencePath,
      "--manual-checks",
      manualChecksPath,
      "--require-smoke-report"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /WeChat release rehearsal PASSED/);
  assert.ok(fs.existsSync(summaryPath));
  assert.ok(fs.existsSync(markdownPath));

  const report = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    summary: { status: string; artifacts: Record<string, string | undefined> };
    stages: Array<{ id: string; status: string }>;
  };
  assert.equal(report.summary.status, "passed");
  assert.deepEqual(
    report.stages.map((stage) => stage.status),
    ["passed", "passed", "passed", "passed", "passed", "passed"]
  );
  assert.ok(report.summary.artifacts.archivePath?.includes(".tar.gz"));
  assert.ok(report.summary.artifacts.metadataPath?.endsWith(".package.json"));
  assert.ok(
    report.summary.artifacts.installLaunchEvidenceJsonPath?.endsWith("codex.wechat.install-launch-evidence.json")
  );
  assert.ok(report.summary.artifacts.smokeReportPath?.endsWith("codex.wechat.smoke-report.json"));
  assert.ok(
    report.summary.artifacts.candidateSummaryJsonPath?.endsWith("codex.wechat.release-candidate-summary.json")
  );
  assert.ok(
    report.summary.artifacts.candidateSummaryMarkdownPath?.endsWith("codex.wechat.release-candidate-summary.md")
  );
});
