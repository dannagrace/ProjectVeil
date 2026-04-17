import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBuildPackageGate,
  buildCriticalEvidenceGate,
  buildGoNoGoReport,
  summarizeSameCandidateAudit,
  summarizeCocosRc,
  summarizePrimaryClientDiagnostics,
  summarizeSnapshot,
  summarizeWechatPackage,
  summarizeWechatSmoke
} from "../../../scripts/release-readiness-dashboard.ts";

function isoNowMinus(parts: { days?: number; minutes?: number } = {}): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - (parts.days ?? 0));
  date.setUTCMinutes(date.getUTCMinutes() - (parts.minutes ?? 0));
  return date.toISOString();
}

test("summarizeSnapshot fails when a required release-readiness check is missing from an otherwise passed snapshot", () => {
  const summary = summarizeSnapshot("/tmp/release-readiness.json", {
    generatedAt: isoNowMinus({ days: 1 }),
    revision: {
      shortCommit: "abc1234"
    },
    summary: {
      status: "passed"
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "cocos-primary-journey", status: "passed", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });

  assert.equal(summary.status, "fail");
  assert.match(summary.detail, /missing=e2e-multiplayer-smoke/);
  assert.equal(summary.evidence.status, "fail");
  assert.deepEqual(summary.failReasons, ["release_readiness_required_checks_missing"]);
  assert.equal(summary.evidence.availability, "present");
});

test("buildBuildPackageGate aggregates snapshot, package, and smoke evidence into a failing gate", () => {
  const snapshotSummary = summarizeSnapshot("/tmp/release-readiness.json", {
    generatedAt: isoNowMinus({ days: 1 }),
    revision: {
      shortCommit: "abc1234"
    },
    summary: {
      status: "partial"
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "pending", required: true },
      { id: "cocos-primary-journey", status: "passed", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });
  const packageSummary = summarizeWechatPackage(undefined, undefined);
  const smokeSummary = summarizeWechatSmoke("/tmp/codex.wechat.smoke-report.json", {
    execution: {
      result: "failed",
      executedAt: isoNowMinus({ minutes: 30 })
    },
    cases: [{ id: "login-lobby", status: "failed" }]
  });

  const gate = buildBuildPackageGate(snapshotSummary, packageSummary, smokeSummary);

  assert.equal(gate.status, "fail");
  assert.match(gate.summary, /failed/i);
  assert.deepEqual(gate.failReasons, ["wechat_package_metadata_missing", "wechat_smoke_failed"]);
  assert.deepEqual(gate.warnReasons, ["release_readiness_snapshot_pending", "release_readiness_required_checks_pending"]);
  assert.deepEqual(gate.details, [
    "snapshot=partial | multiplayerSmoke=pending | cocosPrimaryJourney=passed | wechatBuild=passed | pending=e2e-multiplayer-smoke",
    "WeChat package metadata missing.",
    "result=failed | failed=login-lobby"
  ]);
});

test("buildCriticalEvidenceGate downgrades stale evidence to warn and preserves fresh failures", () => {
  const staleSnapshotAt = isoNowMinus({ days: 30 });
  const recentSmokeAt = isoNowMinus({ days: 1, minutes: 5 });
  const recentCocosAt = isoNowMinus({ days: 1 });
  const snapshotSummary = summarizeSnapshot("/tmp/release-readiness.json", {
    generatedAt: staleSnapshotAt,
    revision: {
      shortCommit: "abc1234"
    },
    summary: {
      status: "passed"
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "passed", required: true },
      { id: "cocos-primary-journey", status: "passed", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });
  const smokeSummary = summarizeWechatSmoke("/tmp/codex.wechat.smoke-report.json", {
    execution: {
      result: "failed",
      executedAt: recentSmokeAt
    },
    cases: [{ id: "login-lobby", status: "failed" }]
  });
  const cocosSummary = summarizeCocosRc("/tmp/cocos-rc.json", {
    execution: {
      overallStatus: "passed",
      executedAt: recentCocosAt,
      summary: "RC journey passed."
    }
  });

  const gate = buildCriticalEvidenceGate(14, [
    snapshotSummary.evidence,
    smokeSummary.evidence,
    cocosSummary.evidence
  ]);

  assert.equal(gate.status, "fail");
  assert.match(gate.summary, /missing or includes failing signals/i);
  assert.match(gate.details[0] ?? "", /older than 14 day\(s\)/);
  assert.match(gate.details[1] ?? "", new RegExp(recentSmokeAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(gate.failReasons, ["wechat_smoke_failed"]);
  assert.deepEqual(gate.warnReasons, ["evidence_stale"]);
  assert.equal(gate.evidence[0]?.freshness, "stale");
  assert.equal(gate.evidence[1]?.freshness, "fresh");
});

test("buildCriticalEvidenceGate fails when a critical artifact is missing and exposes machine-readable evidence fields", () => {
  const gate = buildCriticalEvidenceGate(14, [
    summarizeSnapshot(undefined, undefined).evidence,
    summarizeWechatPackage(undefined, undefined).evidence,
    summarizeWechatSmoke(undefined, undefined).evidence,
    summarizePrimaryClientDiagnostics(undefined, undefined).evidence
  ]);

  assert.equal(gate.status, "fail");
  assert.deepEqual(gate.failReasons, [
    "release_readiness_snapshot_missing",
    "wechat_package_metadata_missing",
    "wechat_smoke_report_missing",
    "primary_client_diagnostic_snapshots_missing"
  ]);
  assert.deepEqual(gate.warnReasons, []);
  assert.equal(gate.evidence.every((entry) => entry.availability === "missing"), true);
  assert.equal(gate.details.every((detail) => detail.endsWith("missing artifact")), true);
});

test("summarizePrimaryClientDiagnostics fails incomplete checkpoint coverage", () => {
  const summary = summarizePrimaryClientDiagnostics("/tmp/cocos-primary-diagnostics.json", {
    generatedAt: isoNowMinus({ days: 1 }),
    revision: {
      shortCommit: "abc1234"
    },
    summary: {
      status: "passed",
      checkpointCount: 2,
      categoryIds: ["progression", "combat"],
      checkpointIds: ["progression-review", "combat-loop"]
    },
    checkpoints: []
  });

  assert.equal(summary.status, "fail");
  assert.match(summary.detail, /missingCheckpointIds=inventory-overflow,reconnect-cached-replay,reconnect-recovery/);
  assert.match(summary.detail, /missingCategoryIds=inventory,reconnect/);
  assert.deepEqual(summary.failReasons, ["primary_client_diagnostic_snapshots_incomplete"]);
});

test("summarizeSameCandidateAudit warns when the dashboard was not run as a candidate pair", () => {
  const summary = summarizeSameCandidateAudit(undefined, undefined, {
    candidateRevision: "abc1234",
    maxEvidenceAgeDays: 14
  });

  assert.equal(summary.status, "warn");
  assert.deepEqual(summary.warnReasons, ["same_candidate_evidence_audit_not_checked"]);
  assert.equal(summary.evidence.availability, "missing");
});

test("buildGoNoGoReport marks a candidate blocked when linked evidence revisions disagree", () => {
  const recentSnapshotAt = isoNowMinus({ days: 1, minutes: 20 });
  const recentSmokeAt = isoNowMinus({ days: 1, minutes: 5 });
  const snapshotSummary = summarizeSnapshot("/tmp/release-readiness.json", {
    generatedAt: recentSnapshotAt,
    revision: {
      shortCommit: "abc1234"
    },
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "passed", required: true },
      { id: "cocos-primary-journey", status: "passed", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });
  const smokeSummary = summarizeWechatSmoke("/tmp/codex.wechat.smoke-report.json", {
    artifact: {
      sourceRevision: "def5678"
    },
    execution: {
      result: "passed",
      executedAt: recentSmokeAt
    },
    cases: [{ id: "login-lobby", status: "passed" }]
  });
  const criticalEvidenceGate = buildCriticalEvidenceGate(14, [snapshotSummary.evidence, smokeSummary.evidence]);
  const goNoGo = buildGoNoGoReport({
    candidateRevision: "abc1234",
    maxEvidenceAgeDays: 14,
    snapshot: {
      summary: {
        requiredFailed: 0,
        requiredPending: 0
      }
    },
    gates: [],
    evidence: criticalEvidenceGate.evidence
  });

  assert.equal(goNoGo.decision, "blocked");
  assert.equal(goNoGo.revisionStatus, "mismatch");
  assert.deepEqual(goNoGo.blockers, ["candidate_revision_mismatch"]);
  assert.equal(goNoGo.candidateConsistencyFindings[0]?.path, "/tmp/codex.wechat.smoke-report.json");
  assert.match(goNoGo.candidateConsistencyFindings[0]?.summary ?? "", /Expected candidate revision abc1234/);
  assert.equal(goNoGo.evidence[0]?.matchesCandidate, true);
  assert.equal(goNoGo.evidence[1]?.matchesCandidate, false);
});

test("buildGoNoGoReport blocks explicit candidate pinning when evidence metadata is missing or stale", () => {
  const staleSnapshotAt = isoNowMinus({ days: 30 });
  const recentSmokeAt = isoNowMinus({ days: 1, minutes: 5 });
  const snapshotSummary = summarizeSnapshot("/tmp/release-readiness.json", {
    generatedAt: staleSnapshotAt,
    revision: {
      shortCommit: "abc1234"
    },
    summary: {
      status: "passed",
      requiredFailed: 0,
      requiredPending: 0
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "passed", required: true },
      { id: "cocos-primary-journey", status: "passed", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });
  const smokeSummary = summarizeWechatSmoke("/tmp/codex.wechat.smoke-report.json", {
    execution: {
      result: "passed",
      executedAt: recentSmokeAt
    },
    cases: [{ id: "login-lobby", status: "passed" }]
  });
  const criticalEvidenceGate = buildCriticalEvidenceGate(14, [snapshotSummary.evidence, smokeSummary.evidence]);

  const goNoGo = buildGoNoGoReport({
    candidateRevision: "abc1234",
    maxEvidenceAgeDays: 14,
    snapshot: {
      summary: {
        requiredFailed: 0,
        requiredPending: 0
      }
    },
    gates: [],
    evidence: criticalEvidenceGate.evidence
  });

  assert.equal(goNoGo.decision, "blocked");
  assert.deepEqual(goNoGo.blockers, [
    "candidate_revision_metadata_missing",
    "candidate_evidence_stale"
  ]);
  assert.deepEqual(
    goNoGo.candidateConsistencyFindings.map((finding) => finding.code),
    ["candidate_revision_metadata_missing", "candidate_evidence_stale"]
  );
  assert.match(goNoGo.candidateConsistencyFindings[0]?.summary ?? "", /missing revision metadata/);
  assert.match(goNoGo.candidateConsistencyFindings[1]?.summary ?? "", /older than the 14-day freshness window/);
});
