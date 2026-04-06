import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();
const CURRENT_REVISION = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();
const CURRENT_SHORT_REVISION = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-release-evidence-index-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeLedger(filePath: string, candidate: string, revision: string, generatedAt: string): void {
  writeText(
    filePath,
    `# Manual Release Evidence Owner Ledger

## Candidate

- Candidate: \`${candidate}\`
- Target revision: \`${revision}\`
- Release owner: \`release-oncall\`
- Last updated: \`${generatedAt}\`
- Linked readiness snapshot: \`artifacts/release-readiness/release-readiness-${CURRENT_SHORT_REVISION}.json\`

## Ledger

| Evidence type | Candidate | Revision | Owner | Status | Last updated | Artifact path / link | Notes / blocker context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`cocos-rc-checklist-review\` | \`${candidate}\` | \`${revision}\` | \`release-oncall\` | \`done\` | \`${generatedAt}\` | \`artifacts/release-readiness/cocos-rc-checklist-${CURRENT_SHORT_REVISION}.md\` | Reviewed for this candidate. |
`
  );
}

function runIndex(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/release-evidence-index.ts", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { stdout, status: 0 };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; status?: number };
    return {
      stdout: execError.stdout ?? "",
      status: execError.status ?? 1,
    };
  }
}

test("release evidence index assembles the current checked-out revision into JSON and Markdown", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessDir = path.join(workspace, "artifacts", "release-readiness");
  const wechatArtifactsDir = path.join(workspace, "artifacts", "wechat-release");
  const outputPath = path.join(workspace, "current-release-evidence-index.json");
  const markdownOutputPath = path.join(workspace, "current-release-evidence-index.md");
  const candidate = "phase1-rc";
  const generatedAt = "2026-04-06T01:00:00.000Z";

  writeJson(path.join(releaseReadinessDir, `release-readiness-${CURRENT_SHORT_REVISION}.json`), {
    generatedAt,
    revision: {
      commit: CURRENT_REVISION,
      shortCommit: CURRENT_SHORT_REVISION,
    },
  });
  writeLedger(
    path.join(releaseReadinessDir, `manual-release-evidence-owner-ledger-${candidate}-${CURRENT_SHORT_REVISION}.md`),
    candidate,
    CURRENT_REVISION,
    generatedAt
  );
  writeJson(path.join(releaseReadinessDir, `release-gate-summary-${CURRENT_SHORT_REVISION}.json`), {
    generatedAt,
    revision: {
      commit: CURRENT_REVISION,
    },
  });
  writeJson(path.join(releaseReadinessDir, `same-candidate-evidence-audit-${candidate}-${CURRENT_SHORT_REVISION}.json`), {
    generatedAt,
    candidate: {
      name: candidate,
      revision: CURRENT_REVISION,
    },
  });
  writeJson(path.join(releaseReadinessDir, `release-readiness-dashboard-${candidate}-${CURRENT_SHORT_REVISION}.json`), {
    generatedAt,
    inputs: {
      candidate,
      candidateRevision: CURRENT_REVISION,
    },
    goNoGo: {
      candidateRevision: CURRENT_REVISION,
    },
  });
  writeJson(path.join(releaseReadinessDir, `cocos-rc-evidence-bundle-${candidate}-${CURRENT_SHORT_REVISION}.json`), {
    bundle: {
      generatedAt,
      candidate,
      commit: CURRENT_REVISION,
    },
  });
  writeJson(path.join(wechatArtifactsDir, "codex.wechat.smoke-report.json"), {
    execution: {
      executedAt: generatedAt,
    },
    artifact: {
      sourceRevision: CURRENT_REVISION,
    },
  });

  const result = runIndex([
    "--release-readiness-dir",
    releaseReadinessDir,
    "--wechat-artifacts-dir",
    wechatArtifactsDir,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath,
    "--max-age-hours",
    "100000",
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Overall status: passed/);

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    revision: { commit: string; shortCommit: string };
    candidate: { inferred?: string; observedCandidates: string[] };
    summary: { status: string; requiredMissingCount: number };
    artifactFamilies: Array<{ id: string; status: string; artifactPath?: string; selectedFrom: string }>;
  };

  assert.equal(report.revision.commit, CURRENT_REVISION);
  assert.equal(report.revision.shortCommit, CURRENT_SHORT_REVISION);
  assert.equal(report.candidate.inferred, candidate);
  assert.deepEqual(report.candidate.observedCandidates, [candidate]);
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.requiredMissingCount, 0);
  assert.equal(report.artifactFamilies.find((family) => family.id === "release-readiness-snapshot")?.selectedFrom, "current_revision");
  assert.equal(
    report.artifactFamilies.find((family) => family.id === "release-readiness-snapshot")?.artifactPath?.endsWith(
      `release-readiness-${CURRENT_SHORT_REVISION}.json`
    ),
    true
  );

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /# Current Release Evidence Index/);
  assert.match(markdown, /## Reviewer Workflow/);
  assert.match(markdown, /Cocos RC evidence bundle/);
});

test("release evidence index fails when required current-revision evidence is missing", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessDir = path.join(workspace, "artifacts", "release-readiness");
  const outputPath = path.join(workspace, "current-release-evidence-index.json");
  const markdownOutputPath = path.join(workspace, "current-release-evidence-index.md");

  writeJson(path.join(releaseReadinessDir, "release-readiness-stale.json"), {
    generatedAt: "2026-01-01T00:00:00.000Z",
    revision: {
      commit: "deadbeef",
    },
  });

  const result = runIndex([
    "--release-readiness-dir",
    releaseReadinessDir,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath,
    "--max-age-hours",
    "1",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Overall status: failed/);

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; requiredMissingCount: number };
    requiredWarnings: Array<{ code: string; summary: string }>;
    artifactFamilies: Array<{ id: string; status: string; warnings: Array<{ code: string }> }>;
  };

  assert.equal(report.summary.status, "failed");
  assert.equal(report.summary.requiredMissingCount > 0, true);
  assert.equal(report.requiredWarnings.some((warning) => warning.code === "missing_required"), true);
  assert.equal(
    report.artifactFamilies.find((family) => family.id === "release-readiness-snapshot")?.warnings.some(
      (warning) => warning.code === "revision_mismatch"
    ),
    true
  );
  assert.equal(
    report.artifactFamilies.find((family) => family.id === "manual-evidence-ledger")?.status,
    "missing"
  );
});
