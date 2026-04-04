import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readGit(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function runBundle(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--import", "tsx", "./scripts/phase1-same-revision-evidence-bundle.ts", ...args],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "pipe"
      }
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; status?: number };
    return {
      status: execError.status ?? 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? ""
    };
  }
}

test("phase1 same-revision evidence bundle writes a machine-readable manifest for aligned artifacts", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-phase1-same-revision-bundle-"));
  const inputDir = path.join(workspace, "input");
  const outputDir = path.join(workspace, "bundle");
  const revision = readGit(["rev-parse", "HEAD"]);
  const shortRevision = readGit(["rev-parse", "--short", "HEAD"]);
  const candidate = "phase1-rc";

  const snapshotPath = path.join(inputDir, "release-readiness-snapshot.json");
  writeJson(snapshotPath, {
    generatedAt: "2026-04-04T01:00:00.000Z",
    revision: {
      commit: revision,
      shortCommit: shortRevision,
      branch: "main",
      dirty: false
    },
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    }
  });

  const h5SmokePath = path.join(inputDir, "client-release-candidate-smoke.json");
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-04T01:05:00.000Z",
    revision: {
      commit: revision,
      shortCommit: shortRevision
    },
    execution: {
      status: "passed",
      finishedAt: "2026-04-04T01:06:00.000Z"
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0,
      skipped: 0,
      flaky: 0
    }
  });

  const reconnectPath = path.join(inputDir, "colyseus-reconnect-soak-summary.json");
  writeJson(reconnectPath, {
    generatedAt: "2026-04-04T01:10:00.000Z",
    candidate: {
      name: candidate,
      revision
    },
    revision: {
      commit: revision,
      shortCommit: shortRevision
    },
    verdict: {
      status: "passed",
      summary: "Same-revision reconnect soak evidence is present and passing."
    },
    status: "passed",
    summary: {
      failedScenarios: 0
    },
    soakSummary: {
      reconnectAttempts: 128,
      invariantChecks: 512
    },
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

  const persistencePath = path.join(inputDir, "phase1-release-persistence-regression.json");
  writeJson(persistencePath, {
    generatedAt: "2026-04-04T01:20:00.000Z",
    revision: {
      commit: revision,
      shortCommit: shortRevision
    },
    effectiveStorageMode: "memory",
    contentValidation: {
      valid: true
    },
    summary: {
      status: "passed",
      assertionCount: 4
    },
    persistenceRegression: {
      mapPackId: "phase1-world",
      assertions: ["snapshot reload", "content pack integrity", "quest progression", "inventory restore"]
    }
  });

  const cocosSnapshotPath = path.join(inputDir, "cocos-rc-snapshot.json");
  writeJson(cocosSnapshotPath, {
    candidate: {
      commit: revision,
      shortCommit: shortRevision
    },
    execution: {
      executedAt: "2026-04-04T01:25:00.000Z",
      overallStatus: "passed",
      summary: "Cocos RC snapshot is current for the candidate revision."
    }
  });

  const checklistPath = path.join(inputDir, "cocos-rc-checklist.md");
  fs.writeFileSync(checklistPath, "# Checklist\n", "utf8");
  const blockersPath = path.join(inputDir, "cocos-rc-blockers.md");
  fs.writeFileSync(blockersPath, "# Blockers\n", "utf8");

  const cocosBundlePath = path.join(inputDir, "cocos-rc-evidence-bundle.json");
  writeJson(cocosBundlePath, {
    bundle: {
      generatedAt: "2026-04-04T01:30:00.000Z",
      candidate,
      commit: revision,
      shortCommit: shortRevision,
      overallStatus: "passed",
      summary: "Same-revision Cocos RC bundle is ready for review."
    },
    artifacts: {
      snapshot: cocosSnapshotPath,
      checklistMarkdown: checklistPath,
      blockersMarkdown: blockersPath
    },
    linkedEvidence: {
      releaseReadinessSnapshot: {
        path: snapshotPath
      }
    }
  });

  const releaseGateSummaryPath = path.join(inputDir, "release-gate-summary.json");
  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-04-04T01:35:00.000Z",
    revision: {
      commit: revision,
      shortCommit: shortRevision
    },
    summary: {
      status: "passed"
    },
    inputs: {
      snapshotPath
    }
  });

  const dashboardPath = path.join(inputDir, "release-readiness-dashboard.json");
  writeJson(dashboardPath, {
    generatedAt: "2026-04-04T01:40:00.000Z",
    overallStatus: "pass",
    inputs: {
      snapshotPath,
      cocosRcPath: cocosSnapshotPath,
      reconnectSoakPath: reconnectPath,
      persistencePath
    },
    goNoGo: {
      decision: "ready",
      summary: "Reviewer packet is coherent for the selected candidate artifacts.",
      requiredFailed: 0,
      requiredPending: 0
    }
  });

  const result = runBundle([
    "--candidate",
    candidate,
    "--candidate-revision",
    revision,
    "--target-surface",
    "h5",
    "--output-dir",
    outputDir,
    "--snapshot",
    snapshotPath,
    "--h5-smoke",
    h5SmokePath,
    "--reconnect-soak",
    reconnectPath,
    "--phase1-persistence",
    persistencePath,
    "--cocos-rc-bundle",
    cocosBundlePath,
    "--release-gate-summary",
    releaseGateSummaryPath,
    "--dashboard",
    dashboardPath
  ]);

  assert.equal(result.status, 0, result.stderr);

  const manifestPath = path.join(outputDir, "phase1-same-revision-evidence-bundle-manifest.json");
  const markdownPath = path.join(outputDir, "phase1-same-revision-evidence-bundle.md");
  assert.ok(fs.existsSync(manifestPath));
  assert.ok(fs.existsSync(markdownPath));

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    summary: { status: string; findingCount: number };
    artifacts: {
      releaseReadinessSnapshot: { path: string };
      h5Smoke?: { path: string };
      reconnectSoak: { path: string };
      phase1Persistence: { path: string };
      releaseGateSummary: { path: string };
      releaseReadinessDashboard: { path: string };
      cocosRcBundle: { path: string };
      manualEvidenceLedger: { path: string };
      cocosRcChecklist?: { path: string };
      cocosRcBlockers?: { path: string };
    };
    manualEvidencePlaceholders: Array<{ id: string; path: string; status: string }>;
    validation: { findings: Array<{ code: string }> };
  };

  assert.equal(manifest.summary.status, "passed");
  assert.equal(manifest.summary.findingCount, 0);
  assert.match(manifest.artifacts.releaseGateSummary.path, /release-gate-summary/);
  assert.match(manifest.artifacts.releaseReadinessDashboard.path, /release-readiness-dashboard/);
  assert.match(manifest.artifacts.cocosRcBundle.path, /cocos-rc-evidence-bundle/);
  assert.match(manifest.artifacts.manualEvidenceLedger.path, /manual-release-evidence-owner-ledger/);
  assert.equal(manifest.manualEvidencePlaceholders.some((entry) => entry.id === "cocos-rc-checklist-review"), true);
  assert.equal(manifest.manualEvidencePlaceholders.some((entry) => entry.id === "reconnect-release-followup"), true);
  assert.deepEqual(manifest.validation.findings, []);

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# Phase 1 Same-Revision Evidence Bundle/);
  assert.match(markdown, /No same-revision validation findings/);
});

test("phase1 same-revision evidence bundle fails clearly on stale and revision-mismatched artifacts", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-phase1-same-revision-bundle-fail-"));
  const inputDir = path.join(workspace, "input");
  const outputDir = path.join(workspace, "bundle");
  const revision = readGit(["rev-parse", "HEAD"]);
  const shortRevision = readGit(["rev-parse", "--short", "HEAD"]);

  const snapshotPath = path.join(inputDir, "release-readiness-snapshot.json");
  writeJson(snapshotPath, {
    generatedAt: "2026-03-20T01:00:00.000Z",
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbeef"
    },
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    }
  });

  const h5SmokePath = path.join(inputDir, "client-release-candidate-smoke.json");
  writeJson(h5SmokePath, {
    generatedAt: "2026-04-04T01:05:00.000Z",
    revision: {
      commit: revision,
      shortCommit: shortRevision
    },
    execution: {
      status: "passed",
      finishedAt: "2026-04-04T01:06:00.000Z"
    },
    summary: {
      total: 2,
      passed: 2,
      failed: 0,
      skipped: 0,
      flaky: 0
    }
  });

  const reconnectPath = path.join(inputDir, "colyseus-reconnect-soak-summary.json");
  writeJson(reconnectPath, {
    generatedAt: "2026-03-20T01:10:00.000Z",
    candidate: {
      name: "phase1-rc",
      revision: "deadbeef"
    },
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbeef"
    },
    verdict: {
      status: "passed",
      summary: "Old reconnect soak artifact."
    },
    status: "passed",
    summary: {
      failedScenarios: 0
    },
    soakSummary: {
      reconnectAttempts: 128,
      invariantChecks: 512
    },
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

  const persistencePath = path.join(inputDir, "phase1-release-persistence-regression.json");
  writeJson(persistencePath, {
    generatedAt: "2026-03-20T01:20:00.000Z",
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbeef"
    },
    effectiveStorageMode: "memory",
    contentValidation: {
      valid: true
    },
    summary: {
      status: "passed",
      assertionCount: 4
    },
    persistenceRegression: {
      mapPackId: "phase1-world",
      assertions: ["snapshot reload", "content pack integrity", "quest progression", "inventory restore"]
    }
  });

  const cocosSnapshotPath = path.join(inputDir, "cocos-rc-snapshot.json");
  writeJson(cocosSnapshotPath, {
    candidate: {
      commit: "deadbeef",
      shortCommit: "deadbeef"
    },
    execution: {
      executedAt: "2026-03-20T01:25:00.000Z",
      overallStatus: "passed"
    }
  });

  const checklistPath = path.join(inputDir, "cocos-rc-checklist.md");
  fs.writeFileSync(checklistPath, "# Checklist\n", "utf8");
  const blockersPath = path.join(inputDir, "cocos-rc-blockers.md");
  fs.writeFileSync(blockersPath, "# Blockers\n", "utf8");

  const cocosBundlePath = path.join(inputDir, "cocos-rc-evidence-bundle.json");
  writeJson(cocosBundlePath, {
    bundle: {
      generatedAt: "2026-03-20T01:30:00.000Z",
      candidate: "phase1-rc",
      commit: "deadbeef",
      shortCommit: "deadbeef",
      overallStatus: "passed",
      summary: "Old Cocos RC bundle."
    },
    artifacts: {
      snapshot: cocosSnapshotPath,
      checklistMarkdown: checklistPath,
      blockersMarkdown: blockersPath
    },
    linkedEvidence: {
      releaseReadinessSnapshot: {
        path: snapshotPath
      }
    }
  });

  const releaseGateSummaryPath = path.join(inputDir, "release-gate-summary.json");
  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-03-20T01:35:00.000Z",
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbeef"
    },
    summary: {
      status: "passed"
    },
    inputs: {
      snapshotPath
    }
  });

  const dashboardPath = path.join(inputDir, "release-readiness-dashboard.json");
  writeJson(dashboardPath, {
    generatedAt: "2026-03-20T01:40:00.000Z",
    overallStatus: "warn",
    inputs: {
      snapshotPath,
      cocosRcPath: cocosSnapshotPath,
      reconnectSoakPath: reconnectPath,
      persistencePath
    },
    goNoGo: {
      decision: "pending",
      summary: "Packet is stale and revision-mismatched.",
      requiredFailed: 0,
      requiredPending: 2
    }
  });

  const result = runBundle([
    "--candidate",
    "phase1-rc",
    "--candidate-revision",
    revision,
    "--target-surface",
    "h5",
    "--output-dir",
    outputDir,
    "--snapshot",
    snapshotPath,
    "--h5-smoke",
    h5SmokePath,
    "--reconnect-soak",
    reconnectPath,
    "--phase1-persistence",
    persistencePath,
    "--cocos-rc-bundle",
    cocosBundlePath,
    "--release-gate-summary",
    releaseGateSummaryPath,
    "--dashboard",
    dashboardPath,
    "--max-age-hours",
    "72"
  ]);

  assert.equal(result.status, 1);

  const manifestPath = path.join(outputDir, "phase1-same-revision-evidence-bundle-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    summary: { status: string };
    validation: { findings: Array<{ code: string }> };
  };

  assert.equal(manifest.summary.status, "failed");
  assert.equal(manifest.validation.findings.some((finding) => finding.code === "stale"), true);
  assert.equal(manifest.validation.findings.some((finding) => finding.code === "revision_mismatch"), true);
});
