import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutomatedCheckStatus,
  buildReleaseReadinessSnapshot,
  parseManualCheckArg
} from "../../../scripts/release-readiness-snapshot.ts";

function createRevision() {
  return {
    commit: "abcdef1234567890",
    shortCommit: "abcdef1",
    branch: "test-branch",
    dirty: false
  };
}

function createRunner() {
  return {
    nodeVersion: "v22.0.0",
    platform: "linux 6.0.0 (x64)",
    hostname: "test-host",
    cwd: "/tmp/project-veil"
  };
}

test("buildReleaseReadinessSnapshot reports pending when required automated checks are skipped", () => {
  const checks = [
    buildAutomatedCheckStatus(
      {
        id: "npm-test",
        title: "Unit and integration regression",
        command: "npm test",
        required: true
      },
      true
    ),
    buildAutomatedCheckStatus(
      {
        id: "typecheck-ci",
        title: "TypeScript CI typecheck",
        command: "npm run typecheck:ci",
        required: true
      },
      true
    ),
    parseManualCheckArg("release-notes:Release notes prepared")
  ];

  const snapshot = buildReleaseReadinessSnapshot({
    generatedAt: "2026-03-30T00:00:00.000Z",
    revision: createRevision(),
    runner: createRunner(),
    checks
  });

  assert.equal(snapshot.summary.status, "pending");
  assert.equal(snapshot.summary.pending, 3);
  assert.equal(snapshot.summary.requiredPending, 3);
  assert.equal(snapshot.checks[0]?.notes, "Skipped command execution via --no-run.");
  assert.equal(snapshot.checks[0]?.startedAt, undefined);
  assert.equal(snapshot.checks[0]?.finishedAt, undefined);
});

test("buildReleaseReadinessSnapshot keeps optional failures partial when required checks passed", () => {
  const checks = [
    {
      id: "npm-test",
      title: "Unit and integration regression",
      kind: "automated" as const,
      required: true,
      status: "passed" as const,
      notes: "",
      evidence: [],
      source: "default" as const
    },
    {
      id: "release-notes",
      title: "Release notes prepared",
      kind: "manual" as const,
      required: false,
      status: "failed" as const,
      notes: "Draft still blocked on product copy.",
      evidence: [],
      source: "file" as const
    }
  ];

  const snapshot = buildReleaseReadinessSnapshot({
    generatedAt: "2026-03-30T00:00:00.000Z",
    revision: createRevision(),
    runner: createRunner(),
    checks
  });

  assert.equal(snapshot.summary.status, "partial");
  assert.equal(snapshot.summary.failed, 1);
  assert.equal(snapshot.summary.requiredFailed, 0);
  assert.equal(snapshot.summary.passed, 1);
});
