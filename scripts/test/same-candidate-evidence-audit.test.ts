import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-same-candidate-audit-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

function runAudit(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/same-candidate-evidence-audit.ts", ...args], {
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

test("same-candidate evidence audit passes when artifact families align to the same candidate revision", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-2026-04-02T08-30-00.000Z.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const ledgerPath = path.join(artifactsDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);

  writeJson(snapshotPath, {
    generatedAt: "2026-04-02T08:30:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });
  writeJson(gateSummaryPath, {
    generatedAt: "2026-04-02T08:35:00.000Z",
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
      generatedAt: "2026-04-02T08:40:00.000Z",
      candidate,
      commit: revision,
      shortCommit: revision
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
    lastUpdated: "2026-04-02T08:42:00.000Z",
    linkedReadinessSnapshot: snapshotPath,
    rows: [
      {
        evidenceType: "runtime-observability-review",
        candidate,
        revision,
        owner: "oncall-ops",
        status: "done",
        lastUpdated: "2026-04-02T08:41:00.000Z",
        artifactPath: path.join(artifactsDir, `runtime-observability-signoff-${revision}.md`),
        notes: "Release runtime endpoints reviewed for this candidate."
      },
      {
        evidenceType: "cocos-rc-checklist-review",
        candidate,
        revision,
        owner: "release-owner",
        status: "done",
        lastUpdated: "2026-04-02T08:42:00.000Z",
        artifactPath: path.join(artifactsDir, `cocos-rc-checklist-${revision}.md`),
        notes: "Checklist reviewed for this candidate."
      }
    ]
  });

  const outputPath = path.join(workspace, "same-candidate-evidence-audit.json");
  const markdownOutputPath = path.join(workspace, "same-candidate-evidence-audit.md");
  const result = runAudit(
    [
      "--candidate",
      candidate,
      "--candidate-revision",
      revision,
      "--snapshot",
      snapshotPath,
      "--release-gate-summary",
      gateSummaryPath,
      "--cocos-rc-bundle",
      bundlePath,
      "--manual-evidence-ledger",
      ledgerPath,
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
    manualEvidenceContract: {
      status: string;
      requiredFamilies: Array<{ id: string; status: string; applicable: boolean; findings: unknown[] }>;
    };
    artifactFamilies: Array<{ status: string; findings: unknown[] }>;
  };
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.findingCount, 0);
  assert.equal(report.manualEvidenceContract.status, "passed");
  assert.equal(report.manualEvidenceContract.requiredFamilies.every((family) => !family.applicable || family.status === "passed"), true);
  assert.equal(report.artifactFamilies.every((family) => family.status === "passed"), true);
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Overall status: \*\*PASSED\*\*/);
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /## Manual Evidence Contract/);
});

test("same-candidate evidence audit reports missing, stale, and revision mismatch findings in one summary", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-2026-04-02T08-30-00.000Z.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const ledgerPath = path.join(artifactsDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);

  writeJson(snapshotPath, {
    generatedAt: "2026-03-25T08:30:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });
  writeJson(gateSummaryPath, {
    generatedAt: "2026-04-02T08:35:00.000Z",
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbeef"
    },
    inputs: {
      snapshotPath: path.join(artifactsDir, "release-readiness-older.json")
    }
  });
  writeLedger(ledgerPath, {
    candidate,
    targetRevision: revision,
    lastUpdated: "2026-04-02T08:42:00.000Z",
    linkedReadinessSnapshot: snapshotPath,
    rows: [
      {
        evidenceType: "runtime-observability-review",
        candidate,
        revision,
        owner: "oncall-ops",
        status: "done",
        lastUpdated: "2026-04-02T08:41:00.000Z",
        artifactPath: path.join(artifactsDir, `runtime-observability-signoff-${revision}.md`),
        notes: "Release runtime endpoints reviewed for this candidate."
      }
    ]
  });

  const outputPath = path.join(workspace, "same-candidate-evidence-audit.json");
  const result = runAudit(
    [
      "--candidate",
      candidate,
      "--candidate-revision",
      revision,
      "--snapshot",
      snapshotPath,
      "--release-gate-summary",
      gateSummaryPath,
      "--cocos-rc-bundle",
      bundlePath,
      "--manual-evidence-ledger",
      ledgerPath,
      "--output",
      outputPath,
      "--max-age-hours",
      "72"
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string };
    manualEvidenceContract: {
      status: string;
      requiredFamilies: Array<{ id: string; findings: Array<{ code: string }> }>;
    };
    artifactFamilies: Array<{ id: string; findings: Array<{ code: string }> }>;
  };
  assert.equal(report.summary.status, "failed");
  assert.equal(report.manualEvidenceContract.status, "failed");
  const snapshotFamily = report.artifactFamilies.find((family) => family.id === "release-readiness-snapshot");
  const gateSummaryFamily = report.artifactFamilies.find((family) => family.id === "release-gate-summary");
  const bundleFamily = report.artifactFamilies.find((family) => family.id === "cocos-rc-bundle");
  const cocosContractFamily = report.manualEvidenceContract.requiredFamilies.find((family) => family.id === "cocos-rc-signoff");
  assert.deepEqual(snapshotFamily?.findings.map((finding) => finding.code), ["stale"]);
  assert.deepEqual(gateSummaryFamily?.findings.map((finding) => finding.code), ["revision_mismatch", "linked_snapshot_mismatch"]);
  assert.deepEqual(bundleFamily?.findings.map((finding) => finding.code), ["missing"]);
  assert.deepEqual(cocosContractFamily?.findings.map((finding) => finding.code), ["missing"]);
});

test("same-candidate evidence audit flags stale runtime sign-off, blocked WeChat evidence, and pending ledger items", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessDir = path.join(workspace, "artifacts", "release-readiness");
  const wechatArtifactsDir = path.join(workspace, "artifacts", "wechat-release");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(releaseReadinessDir, "release-readiness-2026-04-02T08-30-00.000Z.json");
  const gateSummaryPath = path.join(releaseReadinessDir, `release-gate-summary-${revision}.json`);
  const bundlePath = path.join(releaseReadinessDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const ledgerPath = path.join(releaseReadinessDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);
  const wechatSummaryPath = path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json");
  const runtimeSignoffPath = path.join(wechatArtifactsDir, `runtime-observability-signoff-${candidate}-${revision}.md`);

  writeJson(snapshotPath, {
    generatedAt: "2026-04-02T08:30:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });
  writeJson(gateSummaryPath, {
    generatedAt: "2026-04-02T08:35:00.000Z",
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
      generatedAt: "2026-04-02T08:40:00.000Z",
      candidate,
      commit: revision,
      shortCommit: revision
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
    lastUpdated: "2026-04-02T08:42:00.000Z",
    linkedReadinessSnapshot: snapshotPath,
    rows: [
      {
        evidenceType: "runtime-observability-review",
        candidate,
        revision,
        owner: "oncall-ops",
        status: "pending",
        lastUpdated: "2026-04-02T08:41:00.000Z",
        artifactPath: runtimeSignoffPath,
        notes: "Still waiting on release-environment captures."
      }
    ]
  });
  writeJson(wechatSummaryPath, {
    generatedAt: "2026-04-02T08:45:00.000Z",
    candidate: {
      revision,
      status: "blocked"
    },
    evidence: {
      manualReview: {
        status: "blocked",
        requiredPendingChecks: 1,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "wechat-runtime-observability-signoff",
            title: "WeChat runtime observability reviewed for this candidate",
            required: true,
            status: "pending",
            owner: "release-oncall",
            recordedAt: "2026-03-28T08:14:00.000Z",
            revision,
            artifactPath: runtimeSignoffPath,
            notes: "Need release-environment health/auth-readiness/metrics captures."
          }
        ]
      }
    },
    blockers: [
      {
        id: "smoke-report-stale",
        summary: "Smoke report is stale for this candidate.",
        artifactPath: path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json")
      }
    ]
  });
  fs.mkdirSync(path.dirname(runtimeSignoffPath), { recursive: true });
  fs.writeFileSync(runtimeSignoffPath, "# Runtime observability sign-off\n", "utf8");

  const outputPath = path.join(workspace, "same-candidate-evidence-audit.json");
  const markdownOutputPath = path.join(workspace, "same-candidate-evidence-audit.md");
  const result = runAudit(
    [
      "--candidate",
      candidate,
      "--candidate-revision",
      revision,
      "--snapshot",
      snapshotPath,
      "--release-gate-summary",
      gateSummaryPath,
      "--cocos-rc-bundle",
      bundlePath,
      "--manual-evidence-ledger",
      ledgerPath,
      "--wechat-artifacts-dir",
      wechatArtifactsDir,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath,
      "--max-age-hours",
      "72"
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string };
    manualEvidenceContract: {
      status: string;
      requiredFamilies: Array<{ id: string; findings: Array<{ code: string; artifactPath?: string }>; summary: string }>;
    };
    artifactFamilies: Array<{ id: string; findings: Array<{ code: string; artifactPath?: string }> }>;
  };
  assert.equal(report.summary.status, "failed");
  assert.equal(report.manualEvidenceContract.status, "failed");

  const ledgerFamily = report.artifactFamilies.find((family) => family.id === "manual-evidence-ledger");
  const wechatFamily = report.artifactFamilies.find((family) => family.id === "wechat-release-evidence");
  const runtimeContractFamily = report.manualEvidenceContract.requiredFamilies.find((family) => family.id === "runtime-observability");
  const wechatContractFamily = report.manualEvidenceContract.requiredFamilies.find((family) => family.id === "wechat-release-signoff");

  assert.deepEqual(ledgerFamily?.findings.map((finding) => finding.code), ["manual_pending"]);
  assert.deepEqual(wechatFamily?.findings.map((finding) => finding.code), ["manual_pending", "manual_pending", "stale", "blocked"]);
  assert.equal(wechatFamily?.findings[1]?.artifactPath, runtimeSignoffPath);
  assert.deepEqual(runtimeContractFamily?.findings.map((finding) => finding.code), ["manual_pending", "manual_pending", "stale"]);
  assert.match(wechatContractFamily?.summary ?? "", /missing for candidate/);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /Manual Evidence Contract/);
  assert.match(markdown, /WeChat release evidence summary/);
  assert.match(markdown, /Runtime observability sign-off is still pending/);
  assert.match(markdown, /Smoke report is stale for this candidate/);
});
