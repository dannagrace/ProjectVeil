import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../phase1-candidate-rehearsal-markdown.ts";

test("phase1 candidate rehearsal reviewer front door foregrounds the release candidate manifest markdown", () => {
  const markdown = renderMarkdown({
    schemaVersion: 1,
    generatedAt: "2026-04-12T00:00:00.000Z",
    candidate: {
      name: "phase1-mainline",
      revision: "1234567890abcdef1234567890abcdef12345678",
      shortRevision: "1234567",
      branch: "main",
      dirty: false,
      targetSurface: "h5"
    },
    summary: {
      status: "passed",
      stageFailures: [],
      missingArtifacts: [],
      releaseGateStatus: "passed",
      releaseHealthStatus: "healthy",
      phase1CandidateStatus: "passed"
    },
    artifactBundleDir: "artifacts/release-readiness/phase1-candidate-rehearsal-phase1-mainline-1234567",
    artifacts: {
      candidateEvidenceManifestMarkdownPath:
        "artifacts/release-readiness/candidate-evidence-manifest-phase1-mainline-1234567890ab.md",
      candidateEvidenceManifestPath:
        "artifacts/release-readiness/candidate-evidence-manifest-phase1-mainline-1234567890ab.json",
      releaseEvidenceIndexPath: "artifacts/release-readiness/current-release-evidence-index-phase1-mainline-1234567.json",
      releaseGateSummaryPath: "artifacts/release-readiness/release-gate-summary-phase1-mainline-1234567.json"
    },
    stages: []
  });

  const manifestMarkdownIndex = markdown.indexOf(
    "- Release candidate manifest markdown: `artifacts/release-readiness/candidate-evidence-manifest-phase1-mainline-1234567890ab.md`"
  );
  const manifestJsonIndex = markdown.indexOf(
    "- Release candidate manifest JSON: `artifacts/release-readiness/candidate-evidence-manifest-phase1-mainline-1234567890ab.json`"
  );
  const releaseEvidenceIndex = markdown.indexOf(
    "- Current release evidence index: `artifacts/release-readiness/current-release-evidence-index-phase1-mainline-1234567.json`"
  );

  assert.notEqual(manifestMarkdownIndex, -1);
  assert.notEqual(manifestJsonIndex, -1);
  assert.notEqual(releaseEvidenceIndex, -1);
  assert.ok(manifestMarkdownIndex < manifestJsonIndex);
  assert.ok(manifestJsonIndex < releaseEvidenceIndex);
});
