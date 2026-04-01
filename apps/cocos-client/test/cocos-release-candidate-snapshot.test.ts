import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function createSnapshotPath(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-cocos-rc-snapshot-"));
  return path.join(tempDir, "cocos-rc-snapshot.json");
}

function writeLinkedReleaseReadinessSnapshot(status: "pending" | "passed"): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-release-readiness-"));
  const outputPath = path.join(tempDir, "release-readiness.json");
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: "2026-03-29T08:00:00+08:00",
        revision: {
          commit: "abc1234567890",
          shortCommit: "abc1234",
          branch: "main",
          dirty: false
        },
        runner: {
          nodeVersion: process.version,
          platform: process.platform,
          hostname: "localhost",
          cwd: path.resolve(__dirname, "../../..")
        },
        summary: {
          total: 1,
          passed: status === "passed" ? 1 : 0,
          failed: 0,
          pending: status === "pending" ? 1 : 0,
          notApplicable: 0,
          requiredFailed: 0,
          requiredPending: status === "pending" ? 1 : 0,
          status
        },
        checks: [
          {
            id: "runtime-health-review",
            title: "Runtime health review",
            kind: "manual",
            required: true,
            status,
            notes: "",
            evidence: [],
            source: "file"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return outputPath;
}

test("release:cocos-rc:snapshot writes a reusable template", () => {
  const outputPath = createSnapshotPath();

  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/cocos-release-candidate-snapshot.ts",
      "--output",
      outputPath,
      "--candidate",
      "issue-212-sample",
      "--build-surface",
      "creator_preview"
    ],
    {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /Wrote Cocos RC snapshot template/);
  const snapshot = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    schemaVersion: number;
    candidate: { name: string; buildSurface: string };
    execution: { overallStatus: string };
    requiredEvidence: Array<{ id: string; value: string }>;
    journey: Array<{ id: string; status: string }>;
  };
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.candidate.name, "issue-212-sample");
  assert.equal(snapshot.candidate.buildSurface, "creator_preview");
  assert.equal(snapshot.execution.overallStatus, "pending");
  assert.deepEqual(
    snapshot.requiredEvidence.map((entry) => entry.id),
    ["roomId", "reconnectPrompt", "restoredState", "firstBattleResult"]
  );
  assert.deepEqual(
    snapshot.journey.map((entry) => entry.id),
    ["lobby-entry", "room-join", "map-explore", "first-battle", "battle-settlement", "reconnect-restore", "return-to-world"]
  );
  assert.ok(snapshot.journey.every((entry) => entry.status === "pending"));
});

test("release:cocos-rc:snapshot validates a completed report", () => {
  const outputPath = createSnapshotPath();

  execFileSync(
    "node",
    ["--import", "tsx", "./scripts/cocos-release-candidate-snapshot.ts", "--output", outputPath, "--candidate", "issue-212-check"],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe"
    }
  );

  const snapshot = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    execution: { owner: string; executedAt: string; overallStatus: string; summary: string };
    environment: { server: string; cocosCreatorVersion: string; device: string };
    requiredEvidence: Array<{ id: string; value: string; evidence: string[] }>;
    journey: Array<{ id: string; status: string; evidence: string[]; sourceRefs: string[] }>;
  };
  snapshot.execution.owner = "codex";
  snapshot.execution.executedAt = "2026-03-29T08:40:00+08:00";
  snapshot.execution.overallStatus = "passed";
  snapshot.execution.summary = "Creator preview and canonical reconnect path passed.";
  snapshot.environment.server = "ws://127.0.0.1:2567";
  snapshot.environment.cocosCreatorVersion = "3.8.6";
  snapshot.environment.device = "macOS 14 / Creator Preview";

  for (const field of snapshot.requiredEvidence) {
    field.value = `${field.id}-ok`;
    field.evidence = [`artifacts/${field.id}.png`];
  }
  for (const step of snapshot.journey) {
    step.status = "passed";
    step.evidence = [`artifacts/${step.id}.png`];
    step.sourceRefs = ["creator-preview"];
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const output = execFileSync(
    "node",
    ["--import", "tsx", "./scripts/cocos-release-candidate-snapshot.ts", "--output", outputPath, "--check"],
    {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /Validated Cocos RC snapshot/);
  assert.match(output, /Result: passed/);
});

test("release:cocos-rc:snapshot rejects incomplete required evidence", () => {
  const outputPath = createSnapshotPath();

  execFileSync(
    "node",
    ["--import", "tsx", "./scripts/cocos-release-candidate-snapshot.ts", "--output", outputPath, "--candidate", "issue-212-invalid"],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe"
    }
  );

  const snapshot = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    execution: { owner: string; executedAt: string; overallStatus: string; summary: string };
    environment: { server: string };
    requiredEvidence: Array<{ id: string; value: string; evidence: string[] }>;
    journey: Array<{ id: string; status: string; evidence: string[]; sourceRefs: string[] }>;
  };
  snapshot.execution.owner = "codex";
  snapshot.execution.executedAt = "2026-03-29T08:40:00+08:00";
  snapshot.execution.overallStatus = "partial";
  snapshot.execution.summary = "Reconnect evidence missing canonical room id.";
  snapshot.environment.server = "ws://127.0.0.1:2567";

  for (const field of snapshot.requiredEvidence) {
    field.value = field.id === "roomId" ? "" : `${field.id}-ok`;
    field.evidence = ["manual"];
  }
  for (const step of snapshot.journey) {
    step.status = "passed";
    step.evidence = ["manual"];
    step.sourceRefs = ["creator-preview"];
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  assert.throws(
    () =>
      execFileSync(
        "node",
        ["--import", "tsx", "./scripts/cocos-release-candidate-snapshot.ts", "--output", outputPath, "--check"],
        {
          cwd: path.resolve(__dirname, "../../.."),
          encoding: "utf8",
          stdio: "pipe"
        }
      ),
    /requiredEvidence\[roomId\]\.value must be a non-empty string/
  );
});

test("release:cocos-rc:snapshot rejects pending required manual readiness checks during validation", () => {
  const outputPath = createSnapshotPath();
  const readinessSnapshotPath = writeLinkedReleaseReadinessSnapshot("pending");

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/cocos-release-candidate-snapshot.ts",
      "--output",
      outputPath,
      "--candidate",
      "issue-282-pending-manual",
      "--release-readiness-snapshot",
      readinessSnapshotPath
    ],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe"
    }
  );

  const snapshot = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    execution: { owner: string; executedAt: string; overallStatus: string; summary: string };
    environment: { server: string };
    requiredEvidence: Array<{ id: string; value: string; evidence: string[] }>;
    journey: Array<{ id: string; status: string; evidence: string[]; sourceRefs: string[] }>;
  };
  snapshot.execution.owner = "codex";
  snapshot.execution.executedAt = "2026-03-29T08:40:00+08:00";
  snapshot.execution.overallStatus = "passed";
  snapshot.execution.summary = "Candidate flow passed but manual readiness checks are still pending.";
  snapshot.environment.server = "ws://127.0.0.1:2567";

  for (const field of snapshot.requiredEvidence) {
    field.value = `${field.id}-ok`;
    field.evidence = ["manual"];
  }
  for (const step of snapshot.journey) {
    step.status = "passed";
    step.evidence = ["manual"];
    step.sourceRefs = ["creator-preview"];
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  assert.throws(
    () =>
      execFileSync(
        "node",
        ["--import", "tsx", "./scripts/cocos-release-candidate-snapshot.ts", "--output", outputPath, "--check"],
        {
          cwd: path.resolve(__dirname, "../../.."),
          encoding: "utf8",
          stdio: "pipe"
        }
      ),
    /Linked release readiness snapshot still has pending required manual checks: runtime-health-review/
  );
});
