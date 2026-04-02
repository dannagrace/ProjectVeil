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
  }
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `# Manual Release Evidence Owner Ledger

## Candidate

- Candidate: \`${input.candidate}\`
- Target revision: \`${input.targetRevision}\`
- Release owner: \`release-oncall\`
- Last updated: \`${input.lastUpdated}\`
- Linked readiness snapshot: \`${input.linkedReadinessSnapshot}\`
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
    linkedReadinessSnapshot: snapshotPath
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
    artifactFamilies: Array<{ status: string; findings: unknown[] }>;
  };
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.findingCount, 0);
  assert.equal(report.artifactFamilies.every((family) => family.status === "passed"), true);
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Overall status: \*\*PASSED\*\*/);
});

test("same-candidate evidence audit reports missing, stale, and revision mismatch findings in one summary", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-2026-04-02T08-30-00.000Z.json");
  const gateSummaryPath = path.join(artifactsDir, `release-gate-summary-${revision}.json`);
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
    linkedReadinessSnapshot: snapshotPath
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
    artifactFamilies: Array<{ id: string; findings: Array<{ code: string }> }>;
  };
  assert.equal(report.summary.status, "failed");
  const snapshotFamily = report.artifactFamilies.find((family) => family.id === "release-readiness-snapshot");
  const gateSummaryFamily = report.artifactFamilies.find((family) => family.id === "release-gate-summary");
  const bundleFamily = report.artifactFamilies.find((family) => family.id === "cocos-rc-bundle");
  assert.deepEqual(snapshotFamily?.findings.map((finding) => finding.code), ["stale"]);
  assert.deepEqual(gateSummaryFamily?.findings.map((finding) => finding.code), ["revision_mismatch", "linked_snapshot_mismatch"]);
  assert.deepEqual(bundleFamily?.findings.map((finding) => finding.code), ["missing"]);
});
