import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-cocos-rc-consistency-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runCheck(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/cocos-rc-evidence-consistency-check.ts", ...args], {
      cwd,
      encoding: "utf8",
      stdio: "pipe"
    });
    return { stdout, status: 0 };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; status?: number };
    return {
      stdout: execError.stdout ?? "",
      status: execError.status ?? 1
    };
  }
}

test("cocos RC evidence consistency check passes when RC and readiness artifacts align", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-cocos-rc";
  const revision = "abc1234";
  const readinessSnapshotPath = path.join(artifactsDir, "release-readiness-2026-04-06T08-30-00.000Z.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const primaryJourneyEvidencePath = path.join(artifactsDir, `cocos-primary-journey-evidence-${candidate}-${revision}.json`);
  const cocosRcSnapshotPath = path.join(artifactsDir, `cocos-rc-snapshot-${candidate}-${revision}.json`);
  const mainJourneyManifestPath = path.join(artifactsDir, `cocos-main-journey-manifest-${candidate}-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);

  writeJson(readinessSnapshotPath, {
    generatedAt: "2026-04-06T08:30:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });
  writeJson(gateSummaryPath, {
    generatedAt: "2026-04-06T08:35:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    },
    inputs: {
      snapshotPath: readinessSnapshotPath
    }
  });
  writeJson(primaryJourneyEvidencePath, {
    candidate: {
      name: candidate,
      commit: revision,
      shortCommit: revision
    },
    execution: {
      completedAt: "2026-04-06T08:38:00.000Z"
    }
  });
  writeJson(cocosRcSnapshotPath, {
    candidate: {
      name: candidate,
      commit: revision,
      shortCommit: revision
    },
    execution: {
      executedAt: "2026-04-06T08:40:00.000Z"
    },
    linkedEvidence: {
      releaseReadinessSnapshot: {
        path: readinessSnapshotPath
      },
      primaryJourneyEvidence: {
        path: primaryJourneyEvidencePath
      }
    }
  });
  writeJson(mainJourneyManifestPath, {
    candidate: {
      name: candidate,
      revision: {
        commit: revision,
        shortCommit: revision
      }
    },
    generatedAt: "2026-04-06T08:42:00.000Z",
    linkedEvidence: {
      snapshot: readinessSnapshotPath,
      primaryJourneyEvidence: primaryJourneyEvidencePath
    }
  });
  writeJson(bundlePath, {
    bundle: {
      generatedAt: "2026-04-06T08:45:00.000Z",
      candidate,
      commit: revision,
      shortCommit: revision
    },
    artifacts: {
      primaryJourneyEvidence: primaryJourneyEvidencePath,
      mainJourneyManifest: mainJourneyManifestPath,
      snapshot: cocosRcSnapshotPath
    },
    linkedEvidence: {
      releaseReadinessSnapshot: {
        path: readinessSnapshotPath
      }
    }
  });

  const outputPath = path.join(workspace, "cocos-rc-evidence-consistency.json");
  const markdownOutputPath = path.join(workspace, "cocos-rc-evidence-consistency.md");
  const result = runCheck(
    [
      "--candidate",
      candidate,
      "--expected-revision",
      revision,
      "--release-readiness-snapshot",
      readinessSnapshotPath,
      "--release-gate-summary",
      gateSummaryPath,
      "--primary-journey-evidence",
      primaryJourneyEvidencePath,
      "--cocos-rc-snapshot",
      cocosRcSnapshotPath,
      "--cocos-main-journey-manifest",
      mainJourneyManifestPath,
      "--cocos-rc-bundle",
      bundlePath,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; findingCount: number };
    artifacts: Array<{ status: string; findings: unknown[] }>;
  };
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.findingCount, 0);
  assert.equal(report.artifacts.every((artifact) => artifact.status === "passed"), true);
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Overall status: \*\*PASSED\*\*/);
});

test("cocos RC evidence consistency check reports candidate drift, stale artifacts, and broken links", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-cocos-rc";
  const revision = "abc1234";
  const readinessSnapshotPath = path.join(artifactsDir, "release-readiness-2026-04-01T08-30-00.000Z.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const primaryJourneyEvidencePath = path.join(artifactsDir, `cocos-primary-journey-evidence-${candidate}-${revision}.json`);
  const cocosRcSnapshotPath = path.join(artifactsDir, `cocos-rc-snapshot-${candidate}-${revision}.json`);
  const mainJourneyManifestPath = path.join(artifactsDir, `cocos-main-journey-manifest-${candidate}-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);

  writeJson(readinessSnapshotPath, {
    generatedAt: "2026-04-01T08:30:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });
  writeJson(gateSummaryPath, {
    generatedAt: "2026-04-06T08:35:00.000Z",
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbeef"
    },
    inputs: {
      snapshotPath: path.join(artifactsDir, "release-readiness-older.json")
    }
  });
  writeJson(primaryJourneyEvidencePath, {
    candidate: {
      name: "other-candidate",
      commit: revision,
      shortCommit: revision
    },
    execution: {
      completedAt: "2026-04-06T08:38:00.000Z"
    }
  });
  writeJson(cocosRcSnapshotPath, {
    candidate: {
      name: candidate,
      commit: revision,
      shortCommit: revision
    },
    execution: {
      executedAt: "2026-04-06T08:40:00.000Z"
    },
    linkedEvidence: {
      releaseReadinessSnapshot: {
        path: path.join(artifactsDir, "release-readiness-different.json")
      },
      primaryJourneyEvidence: {
        path: primaryJourneyEvidencePath
      }
    }
  });
  writeJson(mainJourneyManifestPath, {
    candidate: {
      name: candidate,
      revision: {
        commit: revision,
        shortCommit: revision
      }
    },
    generatedAt: "2026-04-06T08:42:00.000Z",
    linkedEvidence: {
      snapshot: readinessSnapshotPath,
      primaryJourneyEvidence: primaryJourneyEvidencePath
    }
  });
  writeJson(bundlePath, {
    bundle: {
      generatedAt: "2026-04-06T08:45:00.000Z",
      candidate,
      commit: revision,
      shortCommit: revision
    },
    artifacts: {
      primaryJourneyEvidence: path.join(artifactsDir, "cocos-primary-journey-evidence-other.json"),
      mainJourneyManifest: mainJourneyManifestPath,
      snapshot: cocosRcSnapshotPath
    },
    linkedEvidence: {
      releaseReadinessSnapshot: {
        path: readinessSnapshotPath
      }
    }
  });

  const outputPath = path.join(workspace, "cocos-rc-evidence-consistency.json");
  const markdownOutputPath = path.join(workspace, "cocos-rc-evidence-consistency.md");
  const result = runCheck(
    [
      "--candidate",
      candidate,
      "--expected-revision",
      revision,
      "--release-readiness-snapshot",
      readinessSnapshotPath,
      "--release-gate-summary",
      gateSummaryPath,
      "--primary-journey-evidence",
      primaryJourneyEvidencePath,
      "--cocos-rc-snapshot",
      cocosRcSnapshotPath,
      "--cocos-main-journey-manifest",
      mainJourneyManifestPath,
      "--cocos-rc-bundle",
      bundlePath,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath,
      "--max-age-hours",
      "24"
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string };
    artifacts: Array<{ id: string; findings: Array<{ code: string }> }>;
  };
  assert.equal(report.summary.status, "failed");

  const readiness = report.artifacts.find((artifact) => artifact.id === "release-readiness-snapshot");
  const gate = report.artifacts.find((artifact) => artifact.id === "release-gate-summary");
  const primaryJourney = report.artifacts.find((artifact) => artifact.id === "primary-journey-evidence");
  const rcSnapshot = report.artifacts.find((artifact) => artifact.id === "cocos-rc-snapshot");
  const bundle = report.artifacts.find((artifact) => artifact.id === "cocos-rc-bundle");

  assert.deepEqual(readiness?.findings.map((finding) => finding.code), ["stale"]);
  assert.deepEqual(gate?.findings.map((finding) => finding.code), ["revision_mismatch", "linked_artifact_mismatch"]);
  assert.deepEqual(primaryJourney?.findings.map((finding) => finding.code), ["candidate_mismatch"]);
  assert.deepEqual(rcSnapshot?.findings.map((finding) => finding.code), ["linked_artifact_mismatch"]);
  assert.deepEqual(bundle?.findings.map((finding) => finding.code), ["linked_artifact_mismatch"]);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /Cocos RC Evidence Consistency Check/);
  assert.match(markdown, /older than the 24h freshness window/);
  assert.match(markdown, /reports candidate other-candidate, expected phase1-cocos-rc/);
});
