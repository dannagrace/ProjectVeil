import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWechatMinigameTemplateArtifacts,
  normalizeWechatMinigameBuildConfig
  // Release validation tests run under the repo root runner from both the main checkout and git worktrees.
  // Import the shared Node-only helper from tooling/, not the Cocos asset tree.
} from "../tooling/cocos-wechat-build.ts";

interface PackagedArtifact {
  artifactsDir: string;
  metadataPath: string;
  reportPath: string;
  uploadReceiptPath: string;
}

function createPackagedWechatReleaseArtifact(): PackagedArtifact {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-rc-build-"));
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-rc-artifacts-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-rc-config-"));
  fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, "game.json"),
    JSON.stringify({
      deviceOrientation: "portrait",
      networkTimeout: {
        request: 10000,
        connectSocket: 10000,
        uploadFile: 10000,
        downloadFile: 10000
      },
      subpackages: []
    })
  );
  fs.writeFileSync(path.join(tempDir, "game.js"), "\"use strict\";\n");
  fs.writeFileSync(path.join(tempDir, "application.js"), "\"use strict\";\n");
  fs.writeFileSync(path.join(tempDir, "src", "settings.json"), JSON.stringify({ subpackages: [] }));

  const configPath = path.join(configDir, "wechat-minigame.build.json");
  const config = normalizeWechatMinigameBuildConfig({
    projectName: "Project Veil",
    appId: "wxrcartifactappid",
    runtimeRemoteUrl: "wss://veil.example.com/socket",
    remoteAssetRoot: "https://cdn.example.com/assets",
    domains: {
      request: ["https://veil.example.com"],
      socket: ["wss://veil.example.com"],
      uploadFile: [],
      downloadFile: ["https://cdn.example.com"]
    }
  });
  const artifacts = buildWechatMinigameTemplateArtifacts(config);
  fs.writeFileSync(path.join(tempDir, "project.config.json"), JSON.stringify(artifacts.projectConfigJson));
  fs.writeFileSync(path.join(tempDir, "codex.wechat.build.json"), JSON.stringify(artifacts.manifestJson));
  fs.writeFileSync(path.join(tempDir, "README.codex.md"), `${artifacts.releaseChecklistMarkdown}\n`);
  fs.writeFileSync(configPath, JSON.stringify(config));

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/package-wechat-minigame-release.ts",
      "--config",
      configPath,
      "--output-dir",
      tempDir,
      "--artifacts-dir",
      artifactsDir,
      "--expect-exported-runtime",
      "--source-revision",
      "abc1234"
    ],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe"
    }
  );

  execFileSync(
    "node",
    ["--import", "tsx", "./scripts/smoke-wechat-minigame-release.ts", "--artifacts-dir", artifactsDir],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe"
    }
  );

  const smokeReportPath = path.join(artifactsDir, "codex.wechat.smoke-report.json");
  const smokeReport = JSON.parse(fs.readFileSync(smokeReportPath, "utf8")) as {
    execution: { tester: string; device: string; clientVersion: string; executedAt: string; result: string; summary: string };
    cases: Array<{ id: string; status: string; notes: string; evidence: string[]; requiredEvidence?: Record<string, string> }>;
  };
  smokeReport.execution.tester = "codex";
  smokeReport.execution.device = "iPhone 15 / WeChat 8.0.x";
  smokeReport.execution.clientVersion = "1.0.155";
  smokeReport.execution.executedAt = "2026-03-29T21:20:00+08:00";
  smokeReport.execution.result = "passed";
  smokeReport.execution.summary = "All required smoke cases passed.";
  for (const entry of smokeReport.cases) {
    entry.status = "passed";
    entry.notes = "ok";
    entry.evidence = ["manual"];
  }
  const reconnectCase = smokeReport.cases.find((entry) => entry.id === "reconnect-recovery");
  if (reconnectCase?.requiredEvidence) {
    reconnectCase.requiredEvidence.roomId = "room-alpha";
    reconnectCase.requiredEvidence.reconnectPrompt = "连接已恢复";
    reconnectCase.requiredEvidence.restoredState = "Returned to room-alpha without rollback.";
  }
  const shareCase = smokeReport.cases.find((entry) => entry.id === "share-roundtrip");
  if (shareCase?.requiredEvidence) {
    shareCase.requiredEvidence.shareScene = "lobby";
    shareCase.requiredEvidence.shareQuery = "roomId=room-alpha&inviterId=player-7&shareScene=lobby";
    shareCase.requiredEvidence.roundtripState = "Roundtrip reopened room-alpha and restored inviterId player-7.";
  }
  fs.writeFileSync(smokeReportPath, `${JSON.stringify(smokeReport, null, 2)}\n`, "utf8");

  const metadataPath = path.join(artifactsDir, "project-veil-wechatgame-release.package.json");
  const uploadReceiptPath = path.join(artifactsDir, "project-veil-wechatgame-release.upload.json");
  fs.writeFileSync(
    uploadReceiptPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        buildTemplatePlatform: "wechatgame",
        projectName: "Project Veil",
        artifactArchiveFileName: "project-veil-wechatgame-release.tar.gz",
        artifactArchiveSha256: JSON.parse(fs.readFileSync(metadataPath, "utf8")).archiveSha256 as string,
        artifactMetadataPath: path.relative(path.resolve(__dirname, "../../.."), metadataPath).replace(/\\/g, "/"),
        sourceRevision: "abc1234",
        uploadVersion: "1.0.155",
        uploadDescription: "robot 1 upload Project Veil 1.0.155 commit abc1234",
        uploadAppId: "wxrcartifactappid",
        artifactAppId: "wxrcartifactappid",
        usedAppIdOverride: false,
        uploadRobot: 1,
        uploadedAt: "2026-03-29T13:20:00.000Z"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    artifactsDir,
    metadataPath,
    reportPath: path.join(artifactsDir, "codex.wechat.rc-validation-report.json"),
    uploadReceiptPath
  };
}

test("validate:wechat-rc reports missing artifact arguments without a stack trace", () => {
  const result = spawnSync("node", ["--import", "tsx", "./scripts/validate-wechat-release-candidate.ts"], {
    cwd: path.resolve(__dirname, "../../.."),
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pass either --artifacts-dir <dir> or both --archive <tar\.gz> and --metadata <package\.json>\./);
  assert.match(result.stderr, /Usage: npm run validate -- wechat-rc -- --artifacts-dir <release-artifacts-dir>/);
  assert.doesNotMatch(result.stderr, /at main \(/);
});

test("validate:wechat-rc writes a stable aggregate report for a valid RC artifact bundle", () => {
  const { artifactsDir, reportPath } = createPackagedWechatReleaseArtifact();

  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/validate-wechat-release-candidate.ts",
      "--artifacts-dir",
      artifactsDir,
      "--expected-revision",
      "abc1234",
      "--version",
      "1.0.155",
      "--require-smoke-report"
    ],
    {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /Wrote release candidate validation report/);
  assert.match(output, /Commit: abc1234/);
  assert.match(output, /Version: 1.0.155/);
  assert.match(output, /Result: passed/);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    version: string | null;
    commit: string | null;
    artifact: { archivePath: string; metadataPath: string; smokeReportPath?: string; uploadReceiptPath?: string };
    summary: { status: string; failureSummary: string[] };
    checks: Array<{ id: string; status: string }>;
  };
  assert.equal(report.version, "1.0.155");
  assert.equal(report.commit, "abc1234");
  assert.equal(report.summary.status, "passed");
  assert.deepEqual(report.summary.failureSummary, []);
  assert.ok(report.artifact.archivePath.endsWith(".tar.gz"));
  assert.ok(report.artifact.metadataPath.endsWith(".package.json"));
  assert.ok(report.artifact.smokeReportPath?.endsWith("codex.wechat.smoke-report.json"));
  assert.ok(report.artifact.uploadReceiptPath?.endsWith(".upload.json"));
  assert.deepEqual(
    report.checks.map((check) => `${check.id}:${check.status}`),
    [
      "package-sidecar:passed",
      "artifact-verify:passed",
      "smoke-report:passed",
      "upload-receipt:passed"
    ]
  );
});

test("validate:wechat-rc fails clearly on release version mismatch", () => {
  const { artifactsDir, reportPath } = createPackagedWechatReleaseArtifact();

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "--import",
          "tsx",
          "./scripts/validate-wechat-release-candidate.ts",
          "--artifacts-dir",
          artifactsDir,
          "--expected-revision",
          "abc1234",
          "--version",
          "9.9.9",
          "--require-smoke-report"
        ],
        {
          cwd: path.resolve(__dirname, "../../.."),
          encoding: "utf8",
          stdio: "pipe"
        }
      ),
    /Release candidate version mismatch: expected 9\.9\.9, receipt=1\.0\.155/
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    version: string | null;
    summary: { status: string; failureSummary: string[] };
  };
  assert.equal(report.version, "9.9.9");
  assert.equal(report.summary.status, "failed");
  assert.match(report.summary.failureSummary.join("\n"), /upload-receipt: Release candidate version mismatch/);
});

test("validate:wechat-rc fails clearly on invalid package sidecar metadata", () => {
  const { artifactsDir, metadataPath, reportPath } = createPackagedWechatReleaseArtifact();
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as { archiveSha256: string };
  metadata.archiveSha256 = "bad-sha";
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "--import",
          "tsx",
          "./scripts/validate-wechat-release-candidate.ts",
          "--artifacts-dir",
          artifactsDir,
          "--expected-revision",
          "abc1234"
        ],
        {
          cwd: path.resolve(__dirname, "../../.."),
          encoding: "utf8",
          stdio: "pipe"
        }
      ),
    /Release sidecar archiveSha256 must be a 64-character lowercase hex string/
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    summary: { status: string; failureSummary: string[] };
  };
  assert.equal(report.summary.status, "failed");
  assert.match(report.summary.failureSummary.join("\n"), /package-sidecar: Release sidecar archiveSha256 must be a 64-character lowercase hex string/);
});
