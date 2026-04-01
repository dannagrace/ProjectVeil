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

interface RuntimeEvidenceCasePayload {
  id: string;
  status: "blocked" | "passed" | "failed" | "not_applicable";
  notes?: string;
  evidence?: string[];
  requiredEvidence?: Record<string, string>;
}

interface ManualReviewCheckPayload {
  id: string;
  title: string;
  status?: "passed" | "failed" | "pending" | "not_applicable";
  required?: boolean;
  notes?: string;
  evidence?: string[];
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
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

function writeRuntimeEvidence(metadataPath: string, runtimeEvidencePath: string, cases: RuntimeEvidenceCasePayload[], result?: "blocked" | "passed" | "failed"): void {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as ReleasePackageMetadata;
  const payload = {
    schemaVersion: 1,
    buildTemplatePlatform: "wechatgame",
    artifact: {
      archiveFileName: metadata.archiveFileName,
      archiveSha256: metadata.archiveSha256,
      sourceRevision: metadata.sourceRevision
    },
    execution: {
      tester: "codex-bot",
      device: "iPhone 15 Pro / WeChat 8.0.50",
      clientVersion: "8.0.50",
      executedAt: "2026-03-31T10:00:00+08:00",
      ...(result ? { result } : {}),
      summary: "Automated device evidence imported from CI runtime adapter."
    },
    cases
  };

  fs.writeFileSync(runtimeEvidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function updateArchiveMetadata(metadataPath: string, archivePath: string): void {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as ReleasePackageMetadata;
  metadata.archiveBytes = fs.statSync(archivePath).size;
  metadata.archiveSha256 = hashFileSha256(archivePath);
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function writeManualChecks(filePath: string, checks: ManualReviewCheckPayload[]): void {
  fs.writeFileSync(filePath, `${JSON.stringify(checks, null, 2)}\n`, "utf8");
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
  const summaryPath = path.join(artifact.artifactsDir, "explicit-summary.json");
  const markdownPath = path.join(artifact.artifactsDir, "explicit-summary.md");

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
      "--summary",
      summaryPath,
      "--markdown",
      markdownPath,
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

  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    candidate: { revision: string; status: string };
    artifacts: { validationReportPath: string; smokeReportPath: string; markdownPath: string };
    evidence: {
      smoke: { status: string };
      manualReview: { status: string; requiredPendingChecks: number; checks: Array<{ id: string; status: string }> };
    };
    blockers: Array<{ id: string; summary: string }>;
  };

  assert.match(output, /Candidate status: blocked/);
  assert.equal(summary.candidate.revision, sourceRevision);
  assert.equal(summary.candidate.status, "blocked");
  assert.equal(summary.artifacts.validationReportPath, reportPath);
  assert.equal(summary.artifacts.markdownPath, markdownPath);
  assert.equal(summary.evidence.smoke.status, "skipped");
  assert.equal(summary.evidence.manualReview.status, "blocked");
  assert.equal(summary.evidence.manualReview.requiredPendingChecks, 4);
  assert.deepEqual(
    summary.evidence.manualReview.checks.map((check) => `${check.id}:${check.status}`),
    [
      "wechat-devtools-export-review:pending",
      "wechat-device-runtime-review:pending",
      "wechat-runtime-observability-signoff:pending",
      "wechat-release-checklist:pending"
    ]
  );
  assert.match(summary.blockers.map((blocker) => `${blocker.id}:${blocker.summary}`).join("\n"), /smoke-report-missing/);
  assert.match(summary.blockers.map((blocker) => `${blocker.id}:${blocker.summary}`).join("\n"), /manual:wechat-devtools-export-review/);
  assert.match(summary.blockers.map((blocker) => `${blocker.id}:${blocker.summary}`).join("\n"), /manual:wechat-device-runtime-review/);
  assert.match(summary.blockers.map((blocker) => `${blocker.id}:${blocker.summary}`).join("\n"), /manual:wechat-runtime-observability-signoff/);
  assert.match(fs.readFileSync(markdownPath, "utf8"), /WeChat Release Candidate Summary/);
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

test("validate:wechat-rc marks the candidate ready when smoke evidence and manual review are complete", () => {
  const artifact = packageFixtureArtifact();
  const smokeReportPath = path.join(artifact.artifactsDir, "codex.wechat.smoke-report.json");
  const manualChecksPath = path.join(artifact.artifactsDir, "wechat-manual-review.json");
  const summaryPath = path.join(artifact.artifactsDir, "codex.wechat.release-candidate-summary.json");
  const markdownPath = path.join(artifact.artifactsDir, "codex.wechat.release-candidate-summary.md");
  writePassingSmokeReport(artifact.metadataPath, smokeReportPath);
  writeManualChecks(manualChecksPath, [
    {
      id: "wechat-devtools-export-review",
      title: "Real WeChat export imported and launched in Developer Tools",
      status: "passed",
      required: true,
      notes: "Imported the packaged export into WeChat Developer Tools and captured startup evidence for the same revision.",
      evidence: ["devtools-startup.png", "devtools-console.log"],
      owner: "release-oncall",
      recordedAt: "2026-04-02T08:10:00.000Z",
      revision: sourceRevision,
      artifactPath: "artifacts/wechat-release/devtools-export-review.json"
    },
    {
      id: "wechat-device-runtime-review",
      title: "Physical-device WeChat runtime validated for this candidate",
      status: "passed",
      required: true,
      notes: "Attached the smoke report and capture set from the device validation pass for the same revision.",
      evidence: ["artifacts/wechat-release/codex.wechat.smoke-report.json", "device-runtime.mp4"],
      owner: "release-oncall",
      recordedAt: "2026-04-02T08:12:00.000Z",
      revision: sourceRevision,
      artifactPath: "artifacts/wechat-release/device-runtime-review.json"
    },
    {
      id: "wechat-runtime-observability-signoff",
      title: "WeChat runtime observability reviewed for this candidate",
      status: "passed",
      required: true,
      notes: "Captured health, diagnostic snapshot, and metrics evidence for the release environment.",
      evidence: [
        "/api/runtime/health payload",
        "/api/runtime/diagnostic-snapshot?format=text",
        "/api/runtime/metrics scrape"
      ],
      owner: "release-oncall",
      recordedAt: "2026-04-02T08:14:00.000Z",
      revision: sourceRevision,
      artifactPath: "artifacts/wechat-release/runtime-observability-signoff.json"
    },
    {
      id: "wechat-release-checklist",
      title: "WeChat RC checklist and blockers reviewed",
      status: "passed",
      required: true,
      notes: "Checklist and blockers resolved for the packaged candidate.",
      evidence: [
        "docs/release-evidence/cocos-wechat-rc-checklist.template.md",
        "docs/release-evidence/cocos-wechat-rc-blockers.template.md"
      ],
      owner: "release-oncall",
      recordedAt: "2026-04-02T08:15:00.000Z",
      revision: sourceRevision,
      artifactPath: "artifacts/wechat-release/checklist-review.json"
    }
  ]);

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
      "--smoke-report",
      smokeReportPath,
      "--manual-checks",
      manualChecksPath,
      "--summary",
      summaryPath,
      "--markdown",
      markdownPath,
      "--expected-revision",
      sourceRevision
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    candidate: { status: string; revision: string };
    evidence: {
      package: { status: string };
      validation: { status: string };
      smoke: { status: string };
      manualReview: { status: string; requiredPendingChecks: number; requiredFailedChecks: number };
    };
    blockers: Array<{ id: string }>;
  };

  assert.match(output, /Candidate status: ready/);
  assert.equal(summary.candidate.status, "ready");
  assert.equal(summary.candidate.revision, sourceRevision);
  assert.equal(summary.evidence.package.status, "passed");
  assert.equal(summary.evidence.validation.status, "passed");
  assert.equal(summary.evidence.smoke.status, "passed");
  assert.equal(summary.evidence.manualReview.status, "ready");
  assert.equal(summary.evidence.manualReview.requiredPendingChecks, 0);
  assert.equal(summary.evidence.manualReview.requiredFailedChecks, 0);
  assert.equal(summary.blockers.length, 0);
  assert.match(fs.readFileSync(markdownPath, "utf8"), /Candidate status: `ready`/);
});

test("smoke:wechat-release ingests automated runtime evidence into the existing smoke schema", () => {
  const artifact = packageFixtureArtifact();
  const runtimeEvidencePath = path.join(artifact.artifactsDir, "codex.wechat.runtime-evidence.json");
  const smokeReportPath = path.join(artifact.artifactsDir, "codex.wechat.smoke-report.json");

  writeRuntimeEvidence(artifact.metadataPath, runtimeEvidencePath, [
    {
      id: "startup",
      status: "passed",
      notes: "Cold start reached the login bridge in 2.1s.",
      evidence: ["artifacts/wechat-release/startup.mp4"]
    },
    {
      id: "lobby-entry",
      status: "passed",
      notes: "Lobby rendered with guest identity and no fatal modal.",
      evidence: ["artifacts/wechat-release/lobby.png"]
    },
    {
      id: "room-entry",
      status: "passed",
      notes: "Joined room-alpha from the lobby.",
      evidence: ["artifacts/wechat-release/room-entry.png"]
    },
    {
      id: "reconnect-recovery",
      status: "passed",
      notes: "Recovered the same authority room after a network toggle.",
      evidence: ["artifacts/wechat-release/reconnect.mp4"],
      requiredEvidence: {
        roomId: "room-alpha",
        reconnectPrompt: "连接已恢复",
        restoredState: "Restored room-alpha with the same hero state and lobby context."
      }
    },
    {
      id: "share-roundtrip",
      status: "not_applicable",
      notes: "Share roundtrip automation is excluded from this RC lane; artifact still records the intended payload.",
      evidence: ["artifacts/wechat-release/share-not-applicable.txt"],
      requiredEvidence: {
        shareScene: "lobby",
        shareQuery: "roomId=room-alpha&inviterId=player-7",
        roundtripState: "Not executed in this automated lane."
      }
    },
    {
      id: "key-assets",
      status: "passed",
      notes: "Startup, lobby, and room critical assets loaded without 404s.",
      evidence: ["artifacts/wechat-release/assets.log"]
    }
  ]);

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/smoke-wechat-minigame-release.ts",
      "--metadata",
      artifact.metadataPath,
      "--report",
      smokeReportPath,
      "--runtime-evidence",
      runtimeEvidencePath
    ],
    {
      cwd: repoRoot,
      stdio: "pipe"
    }
  );

  const report = JSON.parse(fs.readFileSync(smokeReportPath, "utf8")) as {
    execution: { tester: string; result: string };
    cases: Array<{ id: string; status: string; notes: string; requiredEvidence?: Record<string, string> }>;
  };

  assert.equal(report.execution.tester, "codex-bot");
  assert.equal(report.execution.result, "passed");
  assert.equal(report.cases.find((entry) => entry.id === "login-lobby")?.status, "passed");
  assert.match(report.cases.find((entry) => entry.id === "login-lobby")?.notes ?? "", /startup \+ lobby entry/i);
  assert.equal(report.cases.find((entry) => entry.id === "reconnect-recovery")?.requiredEvidence?.roomId, "room-alpha");
  assert.equal(report.cases.find((entry) => entry.id === "share-roundtrip")?.status, "not_applicable");

  const validationOutput = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/smoke-wechat-minigame-release.ts",
      "--metadata",
      artifact.metadataPath,
      "--report",
      smokeReportPath,
      "--check",
      "--expected-revision",
      sourceRevision
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(validationOutput, /Validated WeChat smoke report:/);
});

test("smoke:wechat-release reports blocked automated evidence distinctly from failed evidence", () => {
  const artifact = packageFixtureArtifact();
  const runtimeEvidencePath = path.join(artifact.artifactsDir, "codex.wechat.runtime-evidence.blocked.json");
  const smokeReportPath = path.join(artifact.artifactsDir, "codex.wechat.smoke-report.blocked.json");

  writeRuntimeEvidence(
    artifact.metadataPath,
    runtimeEvidencePath,
    [
      {
        id: "startup",
        status: "passed",
        evidence: ["startup.log"]
      },
      {
        id: "lobby-entry",
        status: "blocked",
        notes: "Device farm did not attach to the lobby interaction phase.",
        evidence: ["device-farm-summary.txt"]
      },
      {
        id: "share-roundtrip",
        status: "not_applicable",
        requiredEvidence: {
          shareScene: "lobby",
          shareQuery: "roomId=room-alpha",
          roundtripState: "Not executed in this automated lane."
        }
      }
    ],
    "blocked"
  );

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/smoke-wechat-minigame-release.ts",
      "--metadata",
      artifact.metadataPath,
      "--report",
      smokeReportPath,
      "--runtime-evidence",
      runtimeEvidencePath
    ],
    {
      cwd: repoRoot,
      stdio: "pipe"
    }
  );

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "--import",
          "tsx",
          "./scripts/smoke-wechat-minigame-release.ts",
          "--metadata",
          artifact.metadataPath,
          "--report",
          smokeReportPath,
          "--check"
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: "pipe"
        }
      ),
    /blocked pending device\/runtime evidence/
  );
});
