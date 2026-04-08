import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-cocos-main-journey-gate-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeMarkdown(filePath: string, candidate: string, revision: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `# Artifact\n\n- Candidate: \`${candidate}\`\n- Commit: \`${revision}\`\n`,
    "utf8"
  );
}

function runGate(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/cocos-main-journey-replay-gate.ts", ...args], {
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

test("main-journey replay gate passes aligned candidate evidence while separating presentation blockers", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-cocos-rc";
  const revision = "abc1234";
  const primaryJourneyEvidencePath = path.join(artifactsDir, `cocos-primary-journey-evidence-${candidate}-${revision}.json`);
  const snapshotPath = path.join(artifactsDir, `cocos-rc-snapshot-${candidate}-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const signoffPath = path.join(artifactsDir, `cocos-presentation-signoff-${candidate}-${revision}.json`);
  const checklistPath = path.join(artifactsDir, `cocos-rc-checklist-${candidate}-${revision}.md`);
  const blockersPath = path.join(artifactsDir, `cocos-rc-blockers-${candidate}-${revision}.md`);

  writeJson(primaryJourneyEvidencePath, {
    candidate: {
      name: candidate,
      commit: revision,
      shortCommit: revision
    },
    execution: {
      overallStatus: "passed",
      completedAt: "2026-04-08T10:00:00.000Z",
      summary: "Headless primary-client journey evidence passed."
    },
    journey: [
      { id: "lobby-entry", title: "Lobby entry", status: "passed", summary: "ok" },
      { id: "room-join", title: "Room join", status: "passed", summary: "ok" },
      { id: "map-explore", title: "Map explore", status: "passed", summary: "ok" },
      { id: "first-battle", title: "First battle", status: "passed", summary: "ok" },
      { id: "battle-settlement", title: "Battle settlement", status: "passed", summary: "ok" },
      { id: "reconnect-restore", title: "Reconnect restore", status: "passed", summary: "ok" },
      { id: "return-to-world", title: "Return to world", status: "passed", summary: "ok" }
    ]
  });
  writeJson(snapshotPath, {
    candidate: {
      name: candidate,
      commit: revision,
      shortCommit: revision
    },
    execution: {
      executedAt: "2026-04-08T10:05:00.000Z"
    },
    linkedEvidence: {
      primaryJourneyEvidence: {
        path: primaryJourneyEvidencePath
      }
    }
  });
  writeJson(signoffPath, {
    candidate: {
      name: candidate,
      commit: revision,
      shortCommit: revision
    },
    signoff: {
      status: "hold",
      summary: "Presentation sign-off remains on hold.",
      blockingItems: ["Pixel art / scene visuals"],
      controlledTestGaps: ["Audio"]
    }
  });
  writeMarkdown(checklistPath, candidate, revision);
  writeMarkdown(blockersPath, candidate, revision);
  writeJson(bundlePath, {
    bundle: {
      generatedAt: "2026-04-08T10:10:00.000Z",
      candidate,
      commit: revision,
      shortCommit: revision
    },
    artifacts: {
      primaryJourneyEvidence: primaryJourneyEvidencePath,
      snapshot: snapshotPath,
      presentationSignoff: signoffPath,
      checklistMarkdown: checklistPath,
      blockersMarkdown: blockersPath
    },
    review: {
      functionalEvidence: {
        status: "passed",
        summary: "Headless primary-client journey evidence passed."
      },
      presentationSignoff: {
        status: "hold",
        summary: "Presentation sign-off remains on hold."
      }
    }
  });

  const outputPath = path.join(workspace, "main-journey-gate.json");
  const markdownOutputPath = path.join(workspace, "main-journey-gate.md");
  const result = runGate(
    [
      "--candidate",
      candidate,
      "--expected-revision",
      revision,
      "--primary-journey-evidence",
      primaryJourneyEvidencePath,
      "--cocos-rc-snapshot",
      snapshotPath,
      "--cocos-rc-bundle",
      bundlePath,
      "--presentation-signoff",
      signoffPath,
      "--checklist",
      checklistPath,
      "--blockers",
      blockersPath,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; infrastructureFailureCount: number; evidenceDriftCount: number; presentationBlockerCount: number };
    coverage: { requiredSteps: Array<{ id: string; status: string }> };
    triage: { presentationStatus: string; presentationBlockers: string[]; infrastructureFailures: unknown[] };
  };
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.infrastructureFailureCount, 0);
  assert.equal(report.summary.evidenceDriftCount, 0);
  assert.equal(report.summary.presentationBlockerCount, 1);
  assert.deepEqual(
    report.coverage.requiredSteps.map((step) => step.id),
    ["lobby-entry", "room-join", "map-explore", "first-battle", "battle-settlement", "reconnect-restore"]
  );
  assert.equal(report.coverage.requiredSteps.every((step) => step.status === "passed"), true);
  assert.equal(report.triage.presentationStatus, "hold");
  assert.deepEqual(report.triage.presentationBlockers, ["Pixel art / scene visuals"]);
  assert.equal(report.triage.infrastructureFailures.length, 0);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /Cocos Main-Journey Replay Gate/);
  assert.match(markdown, /Presentation Blockers/);
  assert.match(markdown, /Pixel art \/ scene visuals/);
  assert.match(markdown, /Reviewer Workflow/);
});

test("main-journey replay gate fails when required coverage and revision consistency drift", () => {
  const workspace = createTempWorkspace();
  const artifactsDir = path.join(workspace, "artifacts", "release-readiness");
  const candidate = "phase1-cocos-rc";
  const revision = "abc1234";
  const primaryJourneyEvidencePath = path.join(artifactsDir, `cocos-primary-journey-evidence-${candidate}-${revision}.json`);
  const snapshotPath = path.join(artifactsDir, `cocos-rc-snapshot-${candidate}-${revision}.json`);
  const bundlePath = path.join(artifactsDir, `cocos-rc-evidence-bundle-${candidate}-${revision}.json`);
  const signoffPath = path.join(artifactsDir, `cocos-presentation-signoff-${candidate}-${revision}.json`);
  const checklistPath = path.join(artifactsDir, `cocos-rc-checklist-${candidate}-${revision}.md`);
  const blockersPath = path.join(artifactsDir, `cocos-rc-blockers-${candidate}-${revision}.md`);

  writeJson(primaryJourneyEvidencePath, {
    candidate: {
      name: candidate,
      commit: revision,
      shortCommit: revision
    },
    execution: {
      overallStatus: "failed",
      completedAt: "2026-04-08T10:00:00.000Z",
      summary: "Primary-client journey evidence failed during battle settlement."
    },
    journey: [
      { id: "lobby-entry", title: "Lobby entry", status: "passed", summary: "ok" },
      { id: "room-join", title: "Room join", status: "passed", summary: "ok" },
      { id: "map-explore", title: "Map explore", status: "passed", summary: "ok" },
      { id: "first-battle", title: "First battle", status: "passed", summary: "ok" },
      { id: "reconnect-restore", title: "Reconnect restore", status: "passed", summary: "ok" }
    ]
  });
  writeJson(snapshotPath, {
    candidate: {
      name: candidate,
      commit: revision,
      shortCommit: revision
    },
    execution: {
      executedAt: "2026-04-08T10:05:00.000Z"
    },
    linkedEvidence: {
      primaryJourneyEvidence: {
        path: primaryJourneyEvidencePath
      }
    }
  });
  writeJson(signoffPath, {
    candidate: {
      name: candidate,
      commit: revision,
      shortCommit: revision
    },
    signoff: {
      status: "approved",
      summary: "approved",
      blockingItems: [],
      controlledTestGaps: []
    }
  });
  writeMarkdown(checklistPath, candidate, "deadbeef");
  writeMarkdown(blockersPath, candidate, revision);
  writeJson(bundlePath, {
    bundle: {
      generatedAt: "2026-04-08T10:10:00.000Z",
      candidate,
      commit: revision,
      shortCommit: revision
    },
    artifacts: {
      primaryJourneyEvidence: primaryJourneyEvidencePath,
      snapshot: snapshotPath,
      presentationSignoff: signoffPath,
      checklistMarkdown: checklistPath,
      blockersMarkdown: blockersPath
    },
    review: {
      functionalEvidence: {
        status: "failed",
        summary: "Primary-client journey evidence failed during battle settlement."
      },
      presentationSignoff: {
        status: "approved",
        summary: "approved"
      }
    }
  });

  const outputPath = path.join(workspace, "main-journey-gate.json");
  const result = runGate(
    [
      "--candidate",
      candidate,
      "--expected-revision",
      revision,
      "--primary-journey-evidence",
      primaryJourneyEvidencePath,
      "--cocos-rc-snapshot",
      snapshotPath,
      "--cocos-rc-bundle",
      bundlePath,
      "--presentation-signoff",
      signoffPath,
      "--checklist",
      checklistPath,
      "--blockers",
      blockersPath,
      "--output",
      outputPath
    ],
    REPO_ROOT
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string };
    triage: { infrastructureFailures: Array<{ code: string }>; evidenceDrift: Array<{ code: string }> };
  };
  assert.equal(report.summary.status, "failed");
  assert.deepEqual(
    report.triage.infrastructureFailures.map((finding) => finding.code),
    ["functional_failure", "missing_step"]
  );
  assert.deepEqual(report.triage.evidenceDrift.map((finding) => finding.code), ["revision_mismatch"]);
});
