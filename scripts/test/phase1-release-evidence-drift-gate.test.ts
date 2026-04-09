import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-phase1-release-evidence-drift-gate-"));
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
- Release owner: \`release-owner\`
- Last updated: \`2026-04-09T01:00:00.000Z\`
- Linked readiness snapshot: \`${input.linkedReadinessSnapshot}\`

## Ledger

| Evidence type | Candidate | Revision | Owner | Status | Last updated | Artifact path / link | Notes / blocker context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`runtime-observability-review\` | \`${input.candidate}\` | \`${input.targetRevision}\` | \`oncall-ops\` | \`done\` | \`2026-04-09T01:05:00.000Z\` | \`artifacts/release-readiness/runtime-observability-signoff.md\` | Reviewed for the pinned candidate revision. |
`,
    "utf8"
  );
}

function runGate(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/phase1-release-evidence-drift-gate.ts", ...args], {
      cwd: REPO_ROOT,
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

test("phase1 release evidence drift gate passes for an aligned same-revision bundle and runtime observability packet", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-abc1234.json");
  const ledgerPath = path.join(artifactsDir, "manual-release-evidence-owner-ledger-phase1-rc-abc1234.md");
  const cocosBundlePath = path.join(artifactsDir, "cocos-rc-evidence-bundle-phase1-rc-abc1234.json");
  const runtimeEvidencePath = path.join(artifactsDir, "runtime-observability-evidence-phase1-rc-abc1234.json");
  const runtimeGatePath = path.join(artifactsDir, "runtime-observability-gate-phase1-rc-abc1234.json");
  const manifestPath = path.join(artifactsDir, "phase1-same-revision-evidence-bundle-manifest.json");
  const outputPath = path.join(workspace, "phase1-release-evidence-drift-gate.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-04-09T01:00:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });
  writeLedger(ledgerPath, {
    candidate,
    targetRevision: revision,
    linkedReadinessSnapshot: path.relative(REPO_ROOT, snapshotPath).replace(/\\/g, "/")
  });
  writeJson(cocosBundlePath, {
    bundle: {
      generatedAt: "2026-04-09T01:10:00.000Z",
      candidate,
      commit: revision,
      shortCommit: revision,
      overallStatus: "passed",
      summary: "RC bundle is aligned."
    }
  });
  writeJson(runtimeEvidencePath, {
    generatedAt: "2026-04-09T01:15:00.000Z",
    candidate: {
      name: candidate,
      revision,
      shortRevision: revision,
      branch: "main",
      dirty: false,
      targetSurface: "wechat"
    }
  });
  writeJson(runtimeGatePath, {
    generatedAt: "2026-04-09T01:20:00.000Z",
    candidate: {
      name: candidate,
      revision,
      targetSurface: "wechat"
    },
    summary: {
      status: "passed",
      headline: "Runtime observability gate passed."
    },
    evidenceSource: {
      artifactPath: path.relative(path.dirname(runtimeGatePath), runtimeEvidencePath).replace(/\\/g, "/"),
      generatedAt: "2026-04-09T01:15:00.000Z"
    }
  });
  writeJson(manifestPath, {
    generatedAt: "2026-04-09T01:30:00.000Z",
    summary: {
      status: "passed",
      findingCount: 0,
      summary: "Same-revision evidence bundle is coherent."
    },
    candidate: {
      name: candidate,
      revision,
      shortRevision: revision,
      targetSurface: "wechat"
    },
    artifacts: {
      releaseReadinessSnapshot: {
        path: path.relative(REPO_ROOT, snapshotPath).replace(/\\/g, "/"),
        exists: true,
        revision
      },
      cocosRcBundle: {
        path: path.relative(REPO_ROOT, cocosBundlePath).replace(/\\/g, "/"),
        exists: true,
        revision,
        candidate
      },
      manualEvidenceLedger: {
        path: path.relative(REPO_ROOT, ledgerPath).replace(/\\/g, "/"),
        exists: true,
        revision,
        candidate
      }
    },
    validation: {
      findings: []
    }
  });

  const result = runGate([
    "--candidate",
    candidate,
    "--candidate-revision",
    revision,
    "--same-revision-bundle-manifest",
    manifestPath,
    "--runtime-observability-gate",
    runtimeGatePath,
    "--output",
    outputPath
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Wrote Phase 1 release evidence drift gate JSON/);

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; findingCount: number };
    artifactFamilies: Array<{ id: string; status: string }>;
  };
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.findingCount, 0);
  assert.equal(report.artifactFamilies.find((family) => family.id === "runtime-observability-gate")?.status, "passed");
  assert.equal(report.artifactFamilies.find((family) => family.id === "runtime-observability-evidence")?.status, "passed");
});

test("phase1 release evidence drift gate fails on runtime observability revision drift", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-rc";
  const revision = "abc1234";
  const snapshotPath = path.join(artifactsDir, "release-readiness-abc1234.json");
  const ledgerPath = path.join(artifactsDir, "manual-release-evidence-owner-ledger-phase1-rc-abc1234.md");
  const cocosBundlePath = path.join(artifactsDir, "cocos-rc-evidence-bundle-phase1-rc-abc1234.json");
  const runtimeGatePath = path.join(artifactsDir, "runtime-observability-gate-phase1-rc-abc1234.json");
  const manifestPath = path.join(artifactsDir, "phase1-same-revision-evidence-bundle-manifest.json");
  const outputPath = path.join(workspace, "phase1-release-evidence-drift-gate.json");

  writeJson(snapshotPath, {
    generatedAt: "2026-04-09T01:00:00.000Z",
    revision: {
      commit: revision,
      shortCommit: revision
    }
  });
  writeLedger(ledgerPath, {
    candidate,
    targetRevision: revision,
    linkedReadinessSnapshot: path.relative(REPO_ROOT, snapshotPath).replace(/\\/g, "/")
  });
  writeJson(cocosBundlePath, {
    bundle: {
      generatedAt: "2026-04-09T01:10:00.000Z",
      candidate,
      commit: revision,
      shortCommit: revision,
      overallStatus: "passed"
    }
  });
  writeJson(runtimeGatePath, {
    generatedAt: "2026-04-09T01:20:00.000Z",
    candidate: {
      name: candidate,
      revision: "deadbeef",
      targetSurface: "wechat"
    },
    summary: {
      status: "passed",
      headline: "Runtime observability gate passed."
    }
  });
  writeJson(manifestPath, {
    generatedAt: "2026-04-09T01:30:00.000Z",
    summary: {
      status: "passed",
      findingCount: 0,
      summary: "Same-revision evidence bundle is coherent."
    },
    candidate: {
      name: candidate,
      revision,
      shortRevision: revision,
      targetSurface: "wechat"
    },
    artifacts: {
      releaseReadinessSnapshot: {
        path: path.relative(REPO_ROOT, snapshotPath).replace(/\\/g, "/"),
        exists: true,
        revision
      },
      cocosRcBundle: {
        path: path.relative(REPO_ROOT, cocosBundlePath).replace(/\\/g, "/"),
        exists: true,
        revision,
        candidate
      },
      manualEvidenceLedger: {
        path: path.relative(REPO_ROOT, ledgerPath).replace(/\\/g, "/"),
        exists: true,
        revision,
        candidate
      }
    },
    validation: {
      findings: []
    }
  });

  const result = runGate([
    "--candidate",
    candidate,
    "--candidate-revision",
    revision,
    "--same-revision-bundle-manifest",
    manifestPath,
    "--runtime-observability-gate",
    runtimeGatePath,
    "--output",
    outputPath
  ]);

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; findingCount: number };
    findings: Array<{ code: string; summary: string }>;
  };
  assert.equal(report.summary.status, "failed");
  assert.ok(report.summary.findingCount >= 1);
  assert.ok(report.findings.some((finding) => finding.code === "revision_mismatch"));
});
