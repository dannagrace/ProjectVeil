import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../phase1-candidate-rehearsal-markdown.ts";

test("phase1 candidate rehearsal reviewer front door foregrounds the same-candidate audit markdown", () => {
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
      candidateEvidenceAuditMarkdownPath:
        "artifacts/release-readiness/candidate-evidence-audit-phase1-mainline-1234567.md",
      candidateEvidenceManifestPath:
        "artifacts/release-readiness/candidate-evidence-manifest-phase1-mainline-1234567890ab.json",
      candidateEvidenceAuditPath: "artifacts/release-readiness/candidate-evidence-audit-phase1-mainline-1234567.json",
      releaseEvidenceIndexPath: "artifacts/release-readiness/current-release-evidence-index-phase1-mainline-1234567.json",
      releaseGateSummaryPath: "artifacts/release-readiness/release-gate-summary-phase1-mainline-1234567.json",
      runtimeSloSummaryMarkdownPath: "artifacts/release-readiness/runtime-slo-summary-phase1-mainline-1234567.md"
    },
    stages: []
  });

  const manifestMarkdownIndex = markdown.indexOf(
    "- Release candidate manifest markdown: `artifacts/release-readiness/candidate-evidence-manifest-phase1-mainline-1234567890ab.md`"
  );
  const sameCandidateAuditMarkdownIndex = markdown.indexOf(
    "- Same-candidate evidence audit markdown: `artifacts/release-readiness/candidate-evidence-audit-phase1-mainline-1234567.md`"
  );
  const manifestJsonIndex = markdown.indexOf(
    "- Release candidate manifest JSON: `artifacts/release-readiness/candidate-evidence-manifest-phase1-mainline-1234567890ab.json`"
  );
  const candidateEvidenceAuditIndex = markdown.indexOf(
    "- Candidate evidence audit: `artifacts/release-readiness/candidate-evidence-audit-phase1-mainline-1234567.json`"
  );
  const releaseEvidenceIndex = markdown.indexOf(
    "- Current release evidence index: `artifacts/release-readiness/current-release-evidence-index-phase1-mainline-1234567.json`"
  );
  const runtimeSloSummaryMarkdownIndex = markdown.indexOf(
    "- Runtime SLO summary markdown: `artifacts/release-readiness/runtime-slo-summary-phase1-mainline-1234567.md`"
  );

  assert.notEqual(manifestMarkdownIndex, -1);
  assert.notEqual(sameCandidateAuditMarkdownIndex, -1);
  assert.notEqual(manifestJsonIndex, -1);
  assert.notEqual(candidateEvidenceAuditIndex, -1);
  assert.notEqual(releaseEvidenceIndex, -1);
  assert.notEqual(runtimeSloSummaryMarkdownIndex, -1);
  assert.ok(manifestMarkdownIndex < manifestJsonIndex);
  assert.ok(manifestMarkdownIndex < sameCandidateAuditMarkdownIndex);
  assert.ok(sameCandidateAuditMarkdownIndex < manifestJsonIndex);
  assert.ok(sameCandidateAuditMarkdownIndex < candidateEvidenceAuditIndex);
  assert.ok(manifestJsonIndex < releaseEvidenceIndex);
  assert.ok(releaseEvidenceIndex < runtimeSloSummaryMarkdownIndex);
});
