import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();
const MAX_AGE_HOURS = 72;

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-same-candidate-audit-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function writeCocosRcBundleArtifacts(input: {
  artifactsDir: string;
  candidate: string;
  revision: string;
  releaseReadinessSnapshotPath: string;
  snapshotExecutedAt: string;
  primaryJourneyCompletedAt: string;
  snapshotRevision?: string;
  primaryJourneyRevision?: string;
  linkedPrimaryJourneyPath?: string;
  linkedSnapshotPath?: string;
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
      commit: input.snapshotRevision ?? input.revision,
      shortCommit: input.snapshotRevision ?? input.revision
    },
    execution: {
      executedAt: input.snapshotExecutedAt
    },
    linkedEvidence: {
      primaryJourneyEvidence: {
        path: input.linkedPrimaryJourneyPath ?? primaryJourneyEvidencePath
      },
      releaseReadinessSnapshot: {
        path: input.linkedSnapshotPath ?? input.releaseReadinessSnapshotPath
      }
    }
  });
  writeJson(primaryJourneyEvidencePath, {
    candidate: {
      name: input.candidate,
      commit: input.primaryJourneyRevision ?? input.revision,
      shortCommit: input.primaryJourneyRevision ?? input.revision
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

function runAudit(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const nextArgs = [...args];
  if (!nextArgs.includes("--wechat-artifacts-dir")) {
    const outputIndex = nextArgs.findIndex((arg) => arg === "--output");
    const outputPath = outputIndex >= 0 ? nextArgs[outputIndex + 1] : undefined;
    if (outputPath) {
      const wechatArtifactsDir = path.join(path.dirname(outputPath), "artifacts", "wechat-release");
      fs.mkdirSync(wechatArtifactsDir, { recursive: true });
      nextArgs.push("--wechat-artifacts-dir", wechatArtifactsDir);
    }
  }
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/same-candidate-evidence-audit.ts", ...nextArgs], {
      cwd,
      encoding: "utf8",
      stdio: "pipe"
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      status: execError.status ?? 1
    };
  }
}

function getOwnerReminderPaths(outputDir: string, candidate: string, revision: string): {
  jsonPath: string;
  markdownPath: string;
} {
  const suffix = `${candidate}-${revision.slice(0, 12)}`;
  return {
    jsonPath: path.join(outputDir, `candidate-evidence-owner-reminder-report-${suffix}.json`),
    markdownPath: path.join(outputDir, `candidate-evidence-owner-reminder-report-${suffix}.md`)
  };
}

function getFreshnessHistoryPath(outputDir: string, candidate: string): string {
  return path.join(outputDir, `candidate-evidence-freshness-history-${candidate}.json`);
}

test("same-candidate evidence audit reports CLI argument errors without a stack trace", () => {
  const result = runAudit(["--help"], REPO_ROOT);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /Candidate evidence audit failed: Unknown argument: --help/);
  assert.doesNotMatch(output, /same-candidate-evidence-audit\.ts:\d+/);
  assert.doesNotMatch(output, /\bat parseArgs\b/);
  assert.doesNotMatch(output, /\bat main\b/);
});

test("same-candidate evidence audit passes when required artifact families align to the same candidate revision", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-2026-04-05T08-30-00.000Z.json");
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
        evidenceType: "runtime-observability-review",
        candidate,
        revision,
        owner: "oncall-ops",
        status: "done",
        lastUpdated: hoursAgo(1),
        artifactPath: path.join(artifactsDir, `runtime-observability-signoff-${revision}.md`),
        notes: "Release runtime endpoints reviewed for this candidate."
      },
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
    summary: { status: string; findingCount: number; blockerCount: number; warningCount: number };
    manualEvidenceContract: {
      status: string;
      requiredFamilies: Array<{ id: string; status: string; applicable: boolean; findings: unknown[] }>;
    };
    artifactFamilies: Array<{ status: string; findings: unknown[] }>;
  };
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.findingCount, 0);
  assert.equal(report.summary.blockerCount, 0);
  assert.equal(report.summary.warningCount, 0);
  assert.equal(report.manualEvidenceContract.status, "passed");
  assert.equal(report.manualEvidenceContract.requiredFamilies.every((family) => !family.applicable || family.status === "passed"), true);
  assert.equal(report.artifactFamilies.every((family) => family.status === "passed"), true);
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Overall status: \*\*PASSED\*\*/);
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /## Review Triage/);

  const ownerReminder = JSON.parse(
    fs.readFileSync(getOwnerReminderPaths(path.dirname(outputPath), candidate, revision).jsonPath, "utf8")
  ) as {
    summary: { status: string; itemCount: number };
  };
  assert.equal(ownerReminder.summary.status, "passed");
  assert.equal(ownerReminder.summary.itemCount, 0);
});

test("same-candidate evidence audit reports missing, stale, and revision mismatch findings in one summary", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-2026-04-05T08-30-00.000Z.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const ledgerPath = path.join(artifactsDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);

  writeJson(snapshotPath, {
    generatedAt: hoursAgo(MAX_AGE_HOURS + 24),
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });
  writeJson(gateSummaryPath, {
    generatedAt: hoursAgo(1),
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
    lastUpdated: hoursAgo(1),
    linkedReadinessSnapshot: snapshotPath,
    rows: [
      {
        evidenceType: "runtime-observability-review",
        candidate,
        revision,
        owner: "oncall-ops",
        status: "done",
        lastUpdated: hoursAgo(1),
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
    summary: { status: string; blockerCount: number; warningCount: number };
    manualEvidenceContract: {
      status: string;
      requiredFamilies: Array<{ id: string; findings: Array<{ code: string }> }>;
    };
    artifactFamilies: Array<{ id: string; findings: Array<{ code: string }> }>;
  };
  assert.equal(report.summary.status, "failed");
  assert.equal(report.summary.blockerCount > 0, true);
  assert.equal(report.summary.warningCount, 0);
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

test("same-candidate evidence audit emits an owner reminder report with stale, missing, and missing-owner conditions", () => {
  const workspace = createTempWorkspace();
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
    generatedAt: hoursAgo(MAX_AGE_HOURS + 24),
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
    lastUpdated: hoursAgo(MAX_AGE_HOURS + 24),
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
      path.join(artifactsDir, "missing-bundle.json"),
      "--manual-evidence-ledger",
      ledgerPath,
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
  const ownerReminderPaths = getOwnerReminderPaths(path.dirname(outputPath), candidate, revision);
  const ownerReminder = JSON.parse(fs.readFileSync(ownerReminderPaths.jsonPath, "utf8")) as {
    summary: {
      status: string;
      itemCount: number;
      staleArtifactCount: number;
      missingArtifactCount: number;
      missingOwnerAssignmentCount: number;
    };
    items: Array<{
      artifactFamilyId: string;
      condition: string;
      expectedOwners: string[];
      ownerLedgerEvidenceTypes: string[];
    }>;
  };
  assert.equal(ownerReminder.summary.status, "failed");
  assert.equal(ownerReminder.summary.itemCount, 3);
  assert.equal(ownerReminder.summary.staleArtifactCount, 1);
  assert.equal(ownerReminder.summary.missingArtifactCount, 1);
  assert.equal(ownerReminder.summary.missingOwnerAssignmentCount, 1);

  const staleSnapshot = ownerReminder.items.find((item) => item.artifactFamilyId === "release-readiness-snapshot");
  const missingBundle = ownerReminder.items.find((item) => item.artifactFamilyId === "cocos-rc-bundle");
  const staleLedger = ownerReminder.items.find((item) => item.artifactFamilyId === "manual-evidence-ledger");
  assert.equal(staleSnapshot?.condition, "missing_owner_assignment");
  assert.deepEqual(staleSnapshot?.expectedOwners, []);
  assert.deepEqual(staleSnapshot?.ownerLedgerEvidenceTypes, []);
  assert.equal(missingBundle?.condition, "missing_artifact");
  assert.deepEqual(missingBundle?.expectedOwners, ["release-owner"]);
  assert.deepEqual(missingBundle?.ownerLedgerEvidenceTypes, ["cocos-rc-checklist-review", "cocos-rc-blockers-review", "cocos-presentation-signoff"]);
  assert.equal(staleLedger?.condition, "stale_artifact");
  assert.deepEqual(staleLedger?.expectedOwners, ["release-oncall"]);

  const reminderMarkdown = fs.readFileSync(ownerReminderPaths.markdownPath, "utf8");
  assert.match(reminderMarkdown, /Condition: `missing_owner_assignment`/);
  assert.match(reminderMarkdown, /Condition: `missing_artifact`/);
  assert.match(reminderMarkdown, /Store the JSON \+ Markdown outputs in/);
});

test("same-candidate evidence audit appends candidate freshness history across repeated RC audits", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-current.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const ledgerPath = path.join(artifactsDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);
  const outputDir = path.join(workspace, "outputs");
  const outputPath = path.join(outputDir, "same-candidate-evidence-audit.json");
  const markdownOutputPath = path.join(outputDir, "same-candidate-evidence-audit.md");
  const historyPath = getFreshnessHistoryPath(outputDir, candidate);
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
        evidenceType: "runtime-observability-review",
        candidate,
        revision,
        owner: "oncall-ops",
        status: "done",
        lastUpdated: hoursAgo(1),
        artifactPath: path.join(artifactsDir, `runtime-observability-signoff-${revision}.md`),
        notes: "Release runtime endpoints reviewed for this candidate."
      },
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

  const baseArgs = [
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
  ];

  const firstResult = runAudit(baseArgs, REPO_ROOT);
  assert.equal(firstResult.status, 0);

  writeJson(gateSummaryPath, {
    generatedAt: hoursAgo(1),
    revision: {
      commit: "deadbeef",
      shortCommit: "deadbeef"
    },
    inputs: {
      snapshotPath
    }
  });

  const secondResult = runAudit(baseArgs, REPO_ROOT);
  assert.equal(secondResult.status, 1);

  const history = JSON.parse(fs.readFileSync(historyPath, "utf8")) as {
    candidate: { name: string };
    generatedAt: string;
    entries: Array<{
      candidateRevision: string;
      overallStatus: string;
      blockerCount: number;
      warningCount: number;
      blockingFindings: Array<{ familyId: string; code: string }>;
      artifactFamilies: Array<{ id: string; revision?: string; findingCodes: string[] }>;
    }>;
  };
  assert.equal(history.candidate.name, candidate);
  assert.equal(typeof history.generatedAt, "string");
  assert.equal(history.entries.length, 2);
  assert.equal(history.entries[0]?.candidateRevision, revision);
  assert.equal(history.entries[0]?.overallStatus, "passed");
  assert.equal(history.entries[0]?.blockingFindings.length, 0);
  assert.equal(history.entries[1]?.candidateRevision, revision);
  assert.equal(history.entries[1]?.overallStatus, "failed");
  assert.equal((history.entries[1]?.blockerCount ?? 0) > 0, true);
  assert.equal(history.entries[1]?.warningCount, 0);
  assert.equal(
    history.entries[1]?.blockingFindings.some((finding) => finding.familyId === "release-gate-summary" && finding.code === "revision_mismatch"),
    true
  );
  assert.deepEqual(
    history.entries[1]?.artifactFamilies.find((family) => family.id === "release-gate-summary")?.findingCodes,
    ["revision_mismatch"]
  );
  assert.equal(history.entries[1]?.artifactFamilies.find((family) => family.id === "release-gate-summary")?.revision, "deadbeef");
});

test("same-candidate evidence audit flags stale runtime sign-off, blocked WeChat evidence, and pending ledger items", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessDir = path.join(workspace, "artifacts", "release-readiness");
  const wechatArtifactsDir = path.join(workspace, "artifacts", "wechat-release");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(releaseReadinessDir, "release-readiness-2026-04-05T08-30-00.000Z.json");
  const gateSummaryPath = path.join(releaseReadinessDir, `release-gate-summary-${revision}.json`);
  const bundlePath = path.join(releaseReadinessDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const ledgerPath = path.join(releaseReadinessDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);
  const wechatSummaryPath = path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json");
  const runtimeEvidencePath = path.join(releaseReadinessDir, `runtime-observability-evidence-${candidate}-${revision}.json`);
  const runtimeGatePath = path.join(releaseReadinessDir, `runtime-observability-gate-${candidate}-${revision}.json`);
  const runtimeSignoffPath = path.join(wechatArtifactsDir, `runtime-observability-signoff-${candidate}-${revision}.md`);
  const cocosArtifacts = writeCocosRcBundleArtifacts({
    artifactsDir: releaseReadinessDir,
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
  writeJson(runtimeEvidencePath, {
    generatedAt: hoursAgo(1),
    candidate: {
      name: candidate,
      revision,
      shortRevision: revision,
      targetSurface: "wechat"
    }
  });
  writeJson(runtimeGatePath, {
    generatedAt: hoursAgo(1),
    candidate: {
      name: candidate,
      revision,
      shortRevision: revision,
      targetSurface: "wechat"
    },
    evidenceSource: {
      artifactPath: runtimeEvidencePath
    }
  });
  writeLedger(ledgerPath, {
    candidate,
    targetRevision: revision,
    lastUpdated: hoursAgo(1),
    linkedReadinessSnapshot: snapshotPath,
    rows: [
      {
        evidenceType: "runtime-observability-review",
        candidate,
        revision,
        owner: "oncall-ops",
        status: "pending",
        lastUpdated: hoursAgo(1),
        artifactPath: runtimeSignoffPath,
        notes: "Still waiting on release-environment captures."
      }
    ]
  });
  writeJson(wechatSummaryPath, {
    generatedAt: hoursAgo(1),
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
            recordedAt: hoursAgo(MAX_AGE_HOURS + 24),
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
      "--target-surface",
      "wechat",
      "--snapshot",
      snapshotPath,
      "--release-gate-summary",
      gateSummaryPath,
      "--cocos-rc-bundle",
      bundlePath,
      "--runtime-observability-evidence",
      runtimeEvidencePath,
      "--runtime-observability-gate",
      runtimeGatePath,
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
    summary: { status: string; blockerCount: number; warningCount: number };
    triage: {
      blockers: Array<{ familyId: string; code: string }>;
      warnings: Array<{ familyId: string; code: string }>;
    };
    manualEvidenceContract: {
      status: string;
      requiredFamilies: Array<{ id: string; findings: Array<{ code: string; artifactPath?: string }>; summary: string }>;
    };
    artifactFamilies: Array<{ id: string; findings: Array<{ code: string; artifactPath?: string }> }>;
  };
  assert.equal(report.summary.status, "failed");
  assert.equal(report.summary.blockerCount > 0, true);
  assert.equal(report.summary.warningCount, 0);
  assert.equal(report.manualEvidenceContract.status, "failed");

  const ledgerFamily = report.artifactFamilies.find((family) => family.id === "manual-evidence-ledger");
  const wechatFamily = report.artifactFamilies.find((family) => family.id === "wechat-release-evidence");
  const runtimeContractFamily = report.manualEvidenceContract.requiredFamilies.find((family) => family.id === "runtime-observability");
  const wechatContractFamily = report.manualEvidenceContract.requiredFamilies.find((family) => family.id === "wechat-release-signoff");

  assert.deepEqual(ledgerFamily?.findings.map((finding) => finding.code), ["manual_pending"]);
  assert.deepEqual(wechatFamily?.findings.map((finding) => finding.code), ["manual_pending", "manual_pending", "stale", "blocked"]);
  assert.equal(wechatFamily?.findings[1]?.artifactPath, runtimeSignoffPath);
  assert.deepEqual(runtimeContractFamily?.findings.map((finding) => finding.code), ["manual_pending", "manual_pending", "stale"]);
  assert.match(wechatContractFamily?.summary ?? "", /missing for candidate|warns for candidate|blocks candidate/);
  assert.equal(report.triage.warnings.length, 0);
  assert.equal(report.triage.blockers.some((entry) => entry.familyId === "wechat-release-evidence" && entry.code === "blocked"), true);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /Manual Evidence Contract/);
  assert.match(markdown, /WeChat release evidence summary/);
  assert.match(markdown, /Runtime observability sign-off is still pending/);
  assert.match(markdown, /Smoke report is stale for this candidate/);
});

test("same-candidate evidence audit treats runtime evidence as advisory for h5 review", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-2026-04-05T08-30-00.000Z.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const ledgerPath = path.join(artifactsDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);
  const runtimeEvidencePath = path.join(artifactsDir, `runtime-observability-evidence-${candidate}-${revision}.json`);
  const runtimeGatePath = path.join(artifactsDir, `runtime-observability-gate-${candidate}-${revision}.json`);
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
  writeJson(runtimeEvidencePath, {
    generatedAt: hoursAgo(MAX_AGE_HOURS + 24),
    candidate: {
      name: candidate,
      revision,
      shortRevision: revision,
      targetSurface: "h5"
    }
  });
  writeJson(runtimeGatePath, {
    generatedAt: hoursAgo(MAX_AGE_HOURS + 24),
    candidate: {
      name: candidate,
      revision: "deadbeef",
      shortRevision: "deadbeef",
      targetSurface: "h5"
    },
    evidenceSource: {
      artifactPath: path.join(artifactsDir, "runtime-observability-evidence-other.json")
    }
  });

  const outputPath = path.join(workspace, "same-candidate-evidence-audit.json");
  const markdownOutputPath = path.join(workspace, "same-candidate-evidence-audit.md");
  const result = runAudit(
    [
      "--candidate",
      candidate,
      "--candidate-revision",
      revision,
      "--target-surface",
      "h5",
      "--snapshot",
      snapshotPath,
      "--release-gate-summary",
      gateSummaryPath,
      "--cocos-rc-bundle",
      bundlePath,
      "--runtime-observability-evidence",
      runtimeEvidencePath,
      "--runtime-observability-gate",
      runtimeGatePath,
      "--manual-evidence-ledger",
      ledgerPath,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath,
      "--max-age-hours",
      "72"
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; blockerCount: number; warningCount: number };
    triage: {
      blockers: Array<{ familyId: string; code: string }>;
      warnings: Array<{ familyId: string; code: string }>;
    };
    artifactFamilies: Array<{ id: string; status: string; findings: Array<{ code: string }> }>;
  };

  assert.equal(report.summary.status, "warning");
  assert.equal(report.summary.blockerCount, 0);
  assert.equal(report.summary.warningCount, 4);
  assert.equal(report.triage.blockers.length, 0);
  assert.deepEqual(
    report.triage.warnings.map((entry) => `${entry.familyId}:${entry.code}`),
    [
      "runtime-observability-evidence:stale",
      "runtime-observability-gate:revision_mismatch",
      "runtime-observability-gate:stale",
      "runtime-observability-gate:linked_artifact_mismatch"
    ]
  );

  const runtimeEvidenceFamily = report.artifactFamilies.find((family) => family.id === "runtime-observability-evidence");
  const runtimeGateFamily = report.artifactFamilies.find((family) => family.id === "runtime-observability-gate");
  assert.equal(runtimeEvidenceFamily?.status, "warning");
  assert.equal(runtimeGateFamily?.status, "warning");

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /Overall status: \*\*WARNING\*\*/);
  assert.match(markdown, /Advisory warnings: 4/);
});

test("same-candidate evidence audit fails when linked Cocos RC artifacts drift inside the bundle", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-2026-04-05T08-30-00.000Z.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const ledgerPath = path.join(artifactsDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);
  const mismatchedPrimaryJourneyPath = path.join(artifactsDir, `cocos-primary-journey-evidence-${candidate}-deadbeef.json`);
  const cocosArtifacts = writeCocosRcBundleArtifacts({
    artifactsDir,
    candidate,
    revision,
    releaseReadinessSnapshotPath: snapshotPath,
    snapshotExecutedAt: hoursAgo(1),
    primaryJourneyCompletedAt: hoursAgo(1),
    snapshotRevision: "deadbeef",
    linkedPrimaryJourneyPath: mismatchedPrimaryJourneyPath
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
        evidenceType: "runtime-observability-review",
        candidate,
        revision,
        owner: "oncall-ops",
        status: "done",
        lastUpdated: hoursAgo(1),
        artifactPath: path.join(artifactsDir, `runtime-observability-signoff-${revision}.md`),
        notes: "Release runtime endpoints reviewed for this candidate."
      },
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
      outputPath
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; blockerCount: number };
    artifactFamilies: Array<{ id: string; findings: Array<{ code: string }> }>;
  };
  assert.equal(report.summary.status, "failed");
  assert.equal(report.summary.blockerCount >= 2, true);
  assert.deepEqual(
    report.artifactFamilies.find((family) => family.id === "cocos-rc-snapshot")?.findings.map((finding) => finding.code),
    ["revision_mismatch", "linked_artifact_mismatch"]
  );
  assert.equal(
    report.artifactFamilies.find((family) => family.id === "cocos-primary-journey-evidence")?.findings.length,
    0
  );
});
