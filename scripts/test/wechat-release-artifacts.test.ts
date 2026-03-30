import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");
const fixtureBuildDir = path.join(repoRoot, "apps", "cocos-client", "test", "fixtures", "wechatgame-export");
const defaultConfigPath = path.join(repoRoot, "apps", "cocos-client", "wechat-minigame.build.json");
const sourceRevision = "abc1234";

interface PackagedArtifact {
  artifactsDir: string;
  archivePath: string;
  metadataPath: string;
  packageName: string;
}

interface ReleasePackageMetadata {
  archiveFileName: string;
  archiveBytes: number;
  archiveSha256: string;
  appId: string;
  projectName: string;
  sourceRevision?: string;
}

function hashFileSha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function packageFixtureArtifact(): PackagedArtifact {
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-release-artifacts-"));

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/package-wechat-minigame-release.ts",
      "--config",
      defaultConfigPath,
      "--output-dir",
      fixtureBuildDir,
      "--artifacts-dir",
      artifactsDir,
      "--expect-exported-runtime",
      "--source-revision",
      sourceRevision
    ],
    {
      cwd: repoRoot,
      stdio: "pipe"
    }
  );

  const entries = fs.readdirSync(artifactsDir).sort();
  const archiveFileName = entries.find((entry) => entry.endsWith(".tar.gz"));
  const metadataFileName = entries.find((entry) => entry.endsWith(".package.json"));
  assert.ok(archiveFileName);
  assert.ok(metadataFileName);

  return {
    artifactsDir,
    archivePath: path.join(artifactsDir, archiveFileName),
    metadataPath: path.join(artifactsDir, metadataFileName),
    packageName: archiveFileName.replace(/\.tar\.gz$/, "")
  };
}

function writePassingSmokeReport(metadataPath: string, reportPath: string): void {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as ReleasePackageMetadata;
  const report = {
    schemaVersion: 1,
    buildTemplatePlatform: "wechatgame",
    projectName: metadata.projectName,
    appId: metadata.appId,
    artifact: {
      archiveFileName: metadata.archiveFileName,
      archiveSha256: metadata.archiveSha256,
      artifactsDir: path.dirname(metadataPath),
      metadataPath,
      sourceRevision: metadata.sourceRevision
    },
    execution: {
      tester: "codex",
      device: "iPhone 15 / WeChat 8.0.x",
      clientVersion: "1.0.155",
      executedAt: "2026-03-30T09:00:00+08:00",
      result: "passed",
      summary: "All required smoke cases passed."
    },
    cases: [
      {
        id: "login-lobby",
        title: "登录进入 Lobby",
        status: "passed",
        required: true,
        notes: "ok",
        evidence: ["manual"],
        steps: []
      },
      {
        id: "room-entry",
        title: "进入房间",
        status: "passed",
        required: true,
        notes: "ok",
        evidence: ["manual"],
        steps: []
      },
      {
        id: "reconnect-recovery",
        title: "断线重连或恢复",
        status: "passed",
        required: true,
        notes: "ok",
        evidence: ["manual"],
        steps: [],
        requiredEvidence: {
          roomId: "room-alpha",
          reconnectPrompt: "连接已恢复",
          restoredState: "Returned to room-alpha without rollback."
        }
      },
      {
        id: "share-roundtrip",
        title: "分享与回流",
        status: "passed",
        required: true,
        notes: "ok",
        evidence: ["manual"],
        steps: [],
        requiredEvidence: {
          shareScene: "lobby",
          shareQuery: "roomId=room-alpha&inviterId=player-7&shareScene=lobby",
          roundtripState: "Roundtrip reopened room-alpha and restored inviterId player-7."
        }
      },
      {
        id: "key-assets",
        title: "关键资源加载",
        status: "passed",
        required: true,
        notes: "ok",
        evidence: ["manual"],
        steps: []
      }
    ]
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function updateArchiveMetadata(metadataPath: string, archivePath: string): void {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as ReleasePackageMetadata;
  metadata.archiveBytes = fs.statSync(archivePath).size;
  metadata.archiveSha256 = hashFileSha256(archivePath);
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

test("verify:wechat-release supports explicit artifact paths and keep-extracted output", () => {
  const artifact = packageFixtureArtifact();

  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/verify-wechat-minigame-artifact.ts",
      "--archive",
      artifact.archivePath,
      "--metadata",
      artifact.metadataPath,
      "--expected-revision",
      sourceRevision,
      "--keep-extracted"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /Verified WeChat release archive:/);
  assert.match(output, /Release manifest entries: 7/);
  assert.match(output, /Kept extracted files at /);

  const keptMatch = output.match(/Kept extracted files at (.+)/);
  assert.ok(keptMatch?.[1]);
  const extractedRoot = keptMatch[1].trim();
  assert.ok(fs.existsSync(extractedRoot));
  assert.ok(fs.existsSync(path.join(extractedRoot, artifact.packageName, "wechatgame", "codex.wechat.release.json")));
  fs.rmSync(extractedRoot, { recursive: true, force: true });
});

test("verify:wechat-release fails when a required smoke file is missing from the packaged payload", () => {
  const artifact = packageFixtureArtifact();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-release-mutate-"));

  try {
    execFileSync("tar", ["-xzf", artifact.archivePath, "-C", tempDir], {
      cwd: repoRoot,
      stdio: "pipe"
    });
    fs.rmSync(path.join(tempDir, artifact.packageName, "wechatgame", "game.js"));
    execFileSync("tar", ["-czf", artifact.archivePath, "-C", tempDir, artifact.packageName], {
      cwd: repoRoot,
      stdio: "pipe"
    });
    updateArchiveMetadata(artifact.metadataPath, artifact.archivePath);

    assert.throws(
      () =>
        execFileSync(
          "node",
          [
            "--import",
            "tsx",
            "./scripts/verify-wechat-minigame-artifact.ts",
            "--archive",
            artifact.archivePath,
            "--metadata",
            artifact.metadataPath
          ],
          {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: "pipe"
          }
        ),
      /Smoke validation failed: required file is missing from release payload: game\.js/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("validate:wechat-rc marks smoke and upload receipt checks as skipped when optional artifacts are absent", () => {
  const artifact = packageFixtureArtifact();
  const reportPath = path.join(artifact.artifactsDir, "explicit-report.json");

  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/validate-wechat-release-candidate.ts",
      "--archive",
      artifact.archivePath,
      "--metadata",
      artifact.metadataPath,
      "--report",
      reportPath,
      "--expected-revision",
      sourceRevision
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /Result: passed/);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    artifact: { archivePath: string; metadataPath: string; smokeReportPath?: string; uploadReceiptPath?: string };
    summary: { status: string; failedChecks: number };
    checks: Array<{ id: string; status: string; summary: string }>;
  };

  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.failedChecks, 0);
  assert.equal(report.artifact.archivePath, artifact.archivePath);
  assert.equal(report.artifact.metadataPath, artifact.metadataPath);
  assert.equal(report.artifact.smokeReportPath, undefined);
  assert.equal(report.artifact.uploadReceiptPath, undefined);
  assert.deepEqual(
    report.checks.map((check) => `${check.id}:${check.status}:${check.summary}`),
    [
      "package-sidecar:passed:ok",
      "artifact-verify:passed:ok",
      "smoke-report:skipped:Smoke report not present.",
      "upload-receipt:skipped:Upload receipt not present."
    ]
  );
});

test("validate:wechat-rc requires an upload receipt when version validation is requested", () => {
  const artifact = packageFixtureArtifact();
  const smokeReportPath = path.join(artifact.artifactsDir, "codex.wechat.smoke-report.json");
  const reportPath = path.join(artifact.artifactsDir, "codex.wechat.rc-validation-report.json");
  writePassingSmokeReport(artifact.metadataPath, smokeReportPath);

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "--import",
          "tsx",
          "./scripts/validate-wechat-release-candidate.ts",
          "--archive",
          artifact.archivePath,
          "--metadata",
          artifact.metadataPath,
          "--smoke-report",
          smokeReportPath,
          "--report",
          reportPath,
          "--expected-revision",
          sourceRevision,
          "--version",
          "1.0.155",
          "--require-smoke-report"
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: "pipe"
        }
      ),
    /Upload receipt is required to validate release candidate version 1\.0\.155/
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    summary: { status: string; failureSummary: string[] };
    checks: Array<{ id: string; status: string }>;
  };

  assert.equal(report.summary.status, "failed");
  assert.match(report.summary.failureSummary.join("\n"), /upload-receipt: Upload receipt is required to validate release candidate version 1\.0\.155/);
  assert.deepEqual(
    report.checks.map((check) => `${check.id}:${check.status}`),
    [
      "package-sidecar:passed",
      "artifact-verify:passed",
      "smoke-report:passed",
      "upload-receipt:failed"
    ]
  );
});
