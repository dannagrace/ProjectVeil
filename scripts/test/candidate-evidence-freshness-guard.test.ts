import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();
const MAX_AGE_HOURS = 72;

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-candidate-freshness-guard-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeCocosRcBundleArtifacts(input: {
  artifactsDir: string;
  candidate: string;
  revision: string;
  releaseReadinessSnapshotPath: string;
  snapshotExecutedAt: string;
  primaryJourneyCompletedAt: string;
}): {
  snapshotPath: string;
  primaryJourneyEvidencePath: string;
} {
  const snapshotPath = path.join(input.artifactsDir, `cocos-rc-snapshot-${input.candidate}-${input.revision}.json`);
  const primaryJourneyEvidencePath = path.join(
    input.artifactsDir,
    `cocos-primary-journey-evidence-${input.candidate}-${input.revision}.json`
  );
  writeJson(snapshotPath, {
    candidate: {
      name: input.candidate,
      commit: input.revision,
      shortCommit: input.revision
    },
    execution: {
      executedAt: input.snapshotExecutedAt
    },
    linkedEvidence: {
      primaryJourneyEvidence: {
        path: primaryJourneyEvidencePath
      },
      releaseReadinessSnapshot: {
        path: input.releaseReadinessSnapshotPath
      }
    }
  });
  writeJson(primaryJourneyEvidencePath, {
    candidate: {
      name: input.candidate,
      commit: input.revision,
      shortCommit: input.revision
    },
    execution: {
      completedAt: input.primaryJourneyCompletedAt
    }
  });
  return {
    snapshotPath,
    primaryJourneyEvidencePath
  };
}

function writeLedger(
  filePath: string,
  input: {
    candidate: string;
    targetRevision: string;
    lastUpdated: string;
    linkedReadinessSnapshot: string;
    rows?: Array<{
      evidenceType: string;
      candidate: string;
      revision: string;
      owner: string;
      status: string;
      lastUpdated: string;
      artifactPath: string;
      notes: string;
    }>;
  }
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const rows =
    input.rows?.map(
      (row) =>
        `| \`${row.evidenceType}\` | \`${row.candidate}\` | \`${row.revision}\` | \`${row.owner}\` | \`${row.status}\` | \`${row.lastUpdated}\` | \`${row.artifactPath}\` | ${row.notes} |`
    ) ?? [];
  fs.writeFileSync(
    filePath,
    `# Manual Release Evidence Owner Ledger

## Candidate

- Candidate: \`${input.candidate}\`
- Target revision: \`${input.targetRevision}\`
- Release owner: \`release-oncall\`
- Last updated: \`${input.lastUpdated}\`
- Linked readiness snapshot: \`${input.linkedReadinessSnapshot}\`

## Ledger

| Evidence type | Candidate | Revision | Owner | Status | Last updated | Artifact path / link | Notes / blocker context |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`,
    "utf8"
  );
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function runGuard(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/candidate-evidence-freshness-guard.ts", ...args], {
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

function writeBaseArtifacts(workspace: string): {
  artifactsDir: string;
  candidate: string;
  revision: string;
  snapshotPath: string;
  gateSummaryPath: string;
  bundlePath: string;
  ledgerPath: string;
} {
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-current.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const ledgerPath = path.join(artifactsDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);
  const cocosArtifacts = writeCocosRcBundleArtifacts({
    artifactsDir,
    candidate,
    revision,
    releaseReadinessSnapshotPath: snapshotPath,
    snapshotExecutedAt: hoursAgo(1),
    primaryJourneyCompletedAt: hoursAgo(1)
  });

  writeJson(snapshotPath, {
    generatedAt: hoursAgo(1),
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });
  writeJson(gateSummaryPath, {
    generatedAt: hoursAgo(1),
    revision: {
      commit: revision,
      shortCommit: revision
    },
    inputs: {
      snapshotPath
    }
  });
  writeJson(bundlePath, {
    bundle: {
      generatedAt: hoursAgo(1),
      candidate,
      commit: revision,
      shortCommit: revision
    },
    artifacts: {
      snapshot: cocosArtifacts.snapshotPath,
      primaryJourneyEvidence: cocosArtifacts.primaryJourneyEvidencePath
    },
    linkedEvidence: {
      releaseReadinessSnapshot: {
        path: snapshotPath
      }
    }
  });
  writeLedger(ledgerPath, {
    candidate,
    targetRevision: revision,
    lastUpdated: hoursAgo(1),
    linkedReadinessSnapshot: snapshotPath,
    rows: [
      {
        evidenceType: "cocos-rc-checklist-review",
        candidate,
        revision,
        owner: "release-owner",
        status: "done",
        lastUpdated: hoursAgo(1),
        artifactPath: path.join(artifactsDir, `cocos-rc-checklist-${revision}.md`),
        notes: "Checklist reviewed for this candidate."
      }
    ]
  });

  return {
    artifactsDir,
    candidate,
    revision,
    snapshotPath,
    gateSummaryPath,
    bundlePath,
    ledgerPath
  };
}

function createEmptyWechatArtifactsDir(workspace: string): string {
  const wechatArtifactsDir = path.join(workspace, "wechat-artifacts");
  fs.mkdirSync(wechatArtifactsDir, { recursive: true });
  return wechatArtifactsDir;
}

test("candidate evidence freshness guard passes for fresh same-revision candidate evidence", () => {
  const workspace = createTempWorkspace();
  const fixture = writeBaseArtifacts(workspace);
  const wechatArtifactsDir = createEmptyWechatArtifactsDir(workspace);
  const outputPath = path.join(workspace, "candidate-evidence-freshness-guard.json");
  const markdownOutputPath = path.join(workspace, "candidate-evidence-freshness-guard.md");

  const result = runGuard(
    [
      "--candidate",
      fixture.candidate,
      "--candidate-revision",
      fixture.revision,
      "--target-surface",
      "h5",
      "--snapshot",
      fixture.snapshotPath,
      "--release-gate-summary",
      fixture.gateSummaryPath,
      "--cocos-rc-bundle",
      fixture.bundlePath,
      "--manual-evidence-ledger",
      fixture.ledgerPath,
      "--wechat-artifacts-dir",
      wechatArtifactsDir,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath,
      "--max-age-hours",
      String(MAX_AGE_HOURS)
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Wrote candidate evidence freshness guard JSON/);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; findingCount: number };
  };
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.findingCount, 0);
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Overall status: \*\*PASSED\*\*/);
});

test("candidate evidence freshness guard fails mixed revision evidence", () => {
  const workspace = createTempWorkspace();
  const fixture = writeBaseArtifacts(workspace);
  const wechatArtifactsDir = createEmptyWechatArtifactsDir(workspace);
  writeJson(fixture.gateSummaryPath, {
    generatedAt: hoursAgo(1),
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbeef"
    },
    inputs: {
      snapshotPath: fixture.snapshotPath
    }
  });
  const outputPath = path.join(workspace, "candidate-evidence-freshness-guard.json");

  const result = runGuard(
    [
      "--candidate",
      fixture.candidate,
      "--candidate-revision",
      fixture.revision,
      "--target-surface",
      "h5",
      "--snapshot",
      fixture.snapshotPath,
      "--release-gate-summary",
      fixture.gateSummaryPath,
      "--cocos-rc-bundle",
      fixture.bundlePath,
      "--manual-evidence-ledger",
      fixture.ledgerPath,
      "--wechat-artifacts-dir",
      wechatArtifactsDir,
      "--output",
      outputPath,
      "--max-age-hours",
      String(MAX_AGE_HOURS)
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    artifactFamilies: Array<{ id: string; findings: Array<{ code: string }> }>;
  };
  assert.deepEqual(
    report.artifactFamilies.find((family) => family.id === "release-gate-summary")?.findings.map((finding) => finding.code),
    ["revision_mismatch"]
  );
});

test("candidate evidence freshness guard fails when a required candidate artifact is missing", () => {
  const workspace = createTempWorkspace();
  const fixture = writeBaseArtifacts(workspace);
  const wechatArtifactsDir = createEmptyWechatArtifactsDir(workspace);
  const outputPath = path.join(workspace, "candidate-evidence-freshness-guard.json");

  const result = runGuard(
    [
      "--candidate",
      fixture.candidate,
      "--candidate-revision",
      fixture.revision,
      "--target-surface",
      "h5",
      "--snapshot",
      fixture.snapshotPath,
      "--release-gate-summary",
      fixture.gateSummaryPath,
      "--cocos-rc-bundle",
      path.join(fixture.artifactsDir, "missing-bundle.json"),
      "--manual-evidence-ledger",
      fixture.ledgerPath,
      "--wechat-artifacts-dir",
      wechatArtifactsDir,
      "--output",
      outputPath,
      "--max-age-hours",
      String(MAX_AGE_HOURS)
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    artifactFamilies: Array<{ id: string; findings: Array<{ code: string }> }>;
  };
  assert.deepEqual(
    report.artifactFamilies.find((family) => family.id === "cocos-rc-bundle")?.findings.map((finding) => finding.code),
    ["missing"]
  );
});

test("candidate evidence freshness guard fails stale candidate evidence", () => {
  const workspace = createTempWorkspace();
  const fixture = writeBaseArtifacts(workspace);
  const wechatArtifactsDir = createEmptyWechatArtifactsDir(workspace);
  writeJson(fixture.snapshotPath, {
    generatedAt: hoursAgo(MAX_AGE_HOURS + 24),
    revision: {
      commit: fixture.revision,
      shortCommit: fixture.revision
    }
  });
  const outputPath = path.join(workspace, "candidate-evidence-freshness-guard.json");

  const result = runGuard(
    [
      "--candidate",
      fixture.candidate,
      "--candidate-revision",
      fixture.revision,
      "--target-surface",
      "h5",
      "--snapshot",
      fixture.snapshotPath,
      "--release-gate-summary",
      fixture.gateSummaryPath,
      "--cocos-rc-bundle",
      fixture.bundlePath,
      "--manual-evidence-ledger",
      fixture.ledgerPath,
      "--wechat-artifacts-dir",
      wechatArtifactsDir,
      "--output",
      outputPath,
      "--max-age-hours",
      String(MAX_AGE_HOURS)
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    artifactFamilies: Array<{ id: string; findings: Array<{ code: string }> }>;
  };
  assert.deepEqual(
    report.artifactFamilies.find((family) => family.id === "release-readiness-snapshot")?.findings.map((finding) => finding.code),
    ["stale"]
  );
});
