import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();
const MAX_AGE_HOURS = 48;

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-phase1-exit-dossier-freshness-gate-"));
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
        `| \`${row.evidenceType}\` | \`${row.candidate}\` | \`${row.revision}\` | \`release-owner\` | \`${row.status}\` | \`${row.lastUpdated}\` | \`${row.artifactPath}\` | ${row.notes} |`
    ) ?? [];
  fs.writeFileSync(
    filePath,
    `# Manual Release Evidence Owner Ledger

## Candidate

- Candidate: \`${input.candidate}\`
- Target revision: \`${input.targetRevision}\`
- Release owner: \`release-owner\`
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

function runGate(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/phase1-exit-dossier-freshness-gate.ts", ...args], {
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

function writePassingArtifacts(workspace: string): {
  candidate: string;
  revision: string;
  dossierPath: string;
  exitAuditPath: string;
  snapshotPath: string;
  gateSummaryPath: string;
  ledgerPath: string;
} {
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const bundleDir = path.join(artifactsDir, `phase1-candidate-dossier-${candidate}-${revision}`);
  const dossierPath = path.join(bundleDir, "phase1-candidate-dossier.json");
  const exitAuditPath = path.join(artifactsDir, `phase1-exit-audit-${candidate}-${revision}.json`);
  const snapshotPath = path.join(artifactsDir, `release-readiness-${revision}.json`);
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
  const ledgerPath = path.join(artifactsDir, `manual-release-evidence-owner-ledger-${candidate}-${revision}.md`);

  writeJson(snapshotPath, {
    generatedAt: hoursAgo(1.3),
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });

  writeJson(gateSummaryPath, {
    generatedAt: hoursAgo(1.2),
    revision: {
      commit: revision,
      shortCommit: revision
    },
    inputs: {
      snapshotPath
    }
  });

  writeLedger(ledgerPath, {
    candidate,
    targetRevision: revision,
    lastUpdated: hoursAgo(1.1),
    linkedReadinessSnapshot: snapshotPath,
    rows: [
      {
        evidenceType: "runtime-observability-review",
        candidate,
        revision,
        status: "done",
        lastUpdated: hoursAgo(1.0),
        artifactPath: "artifacts/release-readiness/runtime-observability-signoff.md",
        notes: "Reviewed for the pinned candidate revision."
      }
    ]
  });

  const phase1ExitEvidenceGate = {
    result: "pending",
    summary: "Candidate-level Phase 1 exit evidence is still pending for Runtime observability.",
    blockingSections: [],
    pendingSections: ["Runtime observability"],
    acceptedRiskSections: []
  };

  writeJson(dossierPath, {
    generatedAt: hoursAgo(0.9),
    candidate: {
      name: candidate,
      revision
    },
    inputs: {
      snapshotPath
    },
    artifacts: {
      releaseGateSummaryPath: gateSummaryPath
    },
    phase1ExitEvidenceGate
  });

  writeJson(exitAuditPath, {
    generatedAt: hoursAgo(0.8),
    candidate: {
      name: candidate,
      revision
    },
    inputs: {
      snapshotPath,
      releaseGateSummaryPath: gateSummaryPath,
      manualEvidenceLedgerPath: ledgerPath
    },
    phase1ExitEvidenceGate
  });

  return {
    candidate,
    revision,
    dossierPath,
    exitAuditPath,
    snapshotPath,
    gateSummaryPath,
    ledgerPath
  };
}

test("phase1 exit dossier freshness gate passes for aligned same-revision artifacts", () => {
  const workspace = createTempWorkspace();
  const fixture = writePassingArtifacts(workspace);
  const outputPath = path.join(workspace, "phase1-exit-dossier-freshness-gate.json");
  const markdownOutputPath = path.join(workspace, "phase1-exit-dossier-freshness-gate.md");

  const result = runGate(
    [
      "--candidate",
      fixture.candidate,
      "--candidate-revision",
      fixture.revision,
      "--dossier",
      fixture.dossierPath,
      "--exit-audit",
      fixture.exitAuditPath,
      "--snapshot",
      fixture.snapshotPath,
      "--release-gate-summary",
      fixture.gateSummaryPath,
      "--manual-evidence-ledger",
      fixture.ledgerPath,
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
  assert.match(result.stdout, /Wrote Phase 1 exit dossier freshness gate JSON/);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; findingCount: number };
  };
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.findingCount, 0);
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Overall status: \*\*PASSED\*\*/);
});

test("phase1 exit dossier freshness gate fails when the exit audit references the wrong gate summary", () => {
  const workspace = createTempWorkspace();
  const fixture = writePassingArtifacts(workspace);
  const wrongGateSummaryPath = path.join(workspace, "artifacts", "release-readiness", "release-gate-summary-deadbeef.json");
  writeJson(wrongGateSummaryPath, {
    generatedAt: hoursAgo(1),
    revision: {
      commit: "deadbeef"
    },
    inputs: {
      snapshotPath: fixture.snapshotPath
    }
  });
  writeJson(fixture.exitAuditPath, {
    generatedAt: hoursAgo(0.8),
    candidate: {
      name: fixture.candidate,
      revision: fixture.revision
    },
    inputs: {
      snapshotPath: fixture.snapshotPath,
      releaseGateSummaryPath: wrongGateSummaryPath,
      manualEvidenceLedgerPath: fixture.ledgerPath
    },
    phase1ExitEvidenceGate: {
      result: "pending",
      summary: "Candidate-level Phase 1 exit evidence is still pending for Runtime observability.",
      blockingSections: [],
      pendingSections: ["Runtime observability"],
      acceptedRiskSections: []
    }
  });

  const outputPath = path.join(workspace, "phase1-exit-dossier-freshness-gate.json");
  const result = runGate(
    [
      "--candidate",
      fixture.candidate,
      "--candidate-revision",
      fixture.revision,
      "--dossier",
      fixture.dossierPath,
      "--exit-audit",
      fixture.exitAuditPath,
      "--snapshot",
      fixture.snapshotPath,
      "--release-gate-summary",
      fixture.gateSummaryPath,
      "--manual-evidence-ledger",
      fixture.ledgerPath,
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
    report.artifactFamilies.find((family) => family.id === "phase1-exit-audit")?.findings.map((finding) => finding.code),
    ["linked_gate_mismatch"]
  );
});

test("phase1 exit dossier freshness gate fails stale artifacts and mismatched embedded exit gates", () => {
  const workspace = createTempWorkspace();
  const fixture = writePassingArtifacts(workspace);
  writeJson(fixture.dossierPath, {
    generatedAt: hoursAgo(MAX_AGE_HOURS + 2),
    candidate: {
      name: fixture.candidate,
      revision: fixture.revision
    },
    inputs: {
      snapshotPath: fixture.snapshotPath
    },
    artifacts: {
      releaseGateSummaryPath: fixture.gateSummaryPath
    },
    phase1ExitEvidenceGate: {
      result: "failed",
      summary: "Candidate-level Phase 1 exit evidence is blocked by Runtime observability.",
      blockingSections: ["Runtime observability"],
      pendingSections: [],
      acceptedRiskSections: []
    }
  });

  const outputPath = path.join(workspace, "phase1-exit-dossier-freshness-gate.json");
  const result = runGate(
    [
      "--candidate",
      fixture.candidate,
      "--candidate-revision",
      fixture.revision,
      "--dossier",
      fixture.dossierPath,
      "--exit-audit",
      fixture.exitAuditPath,
      "--snapshot",
      fixture.snapshotPath,
      "--release-gate-summary",
      fixture.gateSummaryPath,
      "--manual-evidence-ledger",
      fixture.ledgerPath,
      "--output",
      outputPath,
      "--max-age-hours",
      String(MAX_AGE_HOURS)
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    findings: Array<{ code: string }>;
  };
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["stale", "phase1_exit_gate_mismatch"]
  );
});
