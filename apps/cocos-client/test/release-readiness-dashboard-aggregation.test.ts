import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBuildPackageGate,
  buildCriticalEvidenceGate,
  summarizeCocosRc,
  summarizeSnapshot,
  summarizeWechatPackage,
  summarizeWechatSmoke
} from "../../../scripts/release-readiness-dashboard.ts";

test("summarizeSnapshot fails when a required release-readiness check is missing from an otherwise passed snapshot", () => {
  const summary = summarizeSnapshot("/tmp/release-readiness.json", {
    generatedAt: "2026-03-30T00:00:00.000Z",
    summary: {
      status: "passed"
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
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
    generatedAt: "2026-03-30T00:00:00.000Z",
    summary: {
      status: "partial"
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "pending", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });
  const packageSummary = summarizeWechatPackage(undefined, undefined);
  const smokeSummary = summarizeWechatSmoke("/tmp/codex.wechat.smoke-report.json", {
    execution: {
      result: "failed",
      executedAt: "2026-03-30T00:05:00.000Z"
    },
    cases: [{ id: "login-lobby", status: "failed" }]
  });

  const gate = buildBuildPackageGate(snapshotSummary, packageSummary, smokeSummary);

  assert.equal(gate.status, "fail");
  assert.match(gate.summary, /failed/i);
  assert.deepEqual(gate.failReasons, ["wechat_package_metadata_missing", "wechat_smoke_failed"]);
  assert.deepEqual(gate.warnReasons, ["release_readiness_snapshot_pending", "release_readiness_required_checks_pending"]);
  assert.deepEqual(gate.details, [
    "snapshot=partial | pending=e2e-multiplayer-smoke",
    "WeChat package metadata missing.",
    "result=failed | failed=login-lobby"
  ]);
});

test("buildCriticalEvidenceGate downgrades stale evidence to warn and preserves fresh failures", () => {
  const snapshotSummary = summarizeSnapshot("/tmp/release-readiness.json", {
    generatedAt: "2026-03-01T00:00:00.000Z",
    summary: {
      status: "passed"
    },
    checks: [
      { id: "npm-test", status: "passed", required: true },
      { id: "typecheck-ci", status: "passed", required: true },
      { id: "e2e-smoke", status: "passed", required: true },
      { id: "e2e-multiplayer-smoke", status: "passed", required: true },
      { id: "wechat-build-check", status: "passed", required: true }
    ]
  });
  const smokeSummary = summarizeWechatSmoke("/tmp/codex.wechat.smoke-report.json", {
    execution: {
      result: "failed",
      executedAt: "2026-03-30T00:05:00.000Z"
    },
    cases: [{ id: "login-lobby", status: "failed" }]
  });
  const cocosSummary = summarizeCocosRc("/tmp/cocos-rc.json", {
    execution: {
      overallStatus: "passed",
      executedAt: "2026-03-30T00:10:00.000Z",
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
  assert.match(gate.details[1] ?? "", /2026-03-30T00:05:00.000Z/);
  assert.deepEqual(gate.failReasons, ["wechat_smoke_failed"]);
  assert.deepEqual(gate.warnReasons, ["evidence_stale"]);
  assert.equal(gate.evidence[0]?.freshness, "stale");
  assert.equal(gate.evidence[1]?.freshness, "fresh");
});

test("buildCriticalEvidenceGate fails when a critical artifact is missing and exposes machine-readable evidence fields", () => {
  const gate = buildCriticalEvidenceGate(14, [
    summarizeSnapshot(undefined, undefined).evidence,
    summarizeWechatPackage(undefined, undefined).evidence,
    summarizeWechatSmoke(undefined, undefined).evidence
  ]);

  assert.equal(gate.status, "fail");
  assert.deepEqual(gate.failReasons, [
    "release_readiness_snapshot_missing",
    "wechat_package_metadata_missing",
    "wechat_smoke_report_missing"
  ]);
  assert.deepEqual(gate.warnReasons, []);
  assert.equal(gate.evidence.every((entry) => entry.availability === "missing"), true);
  assert.equal(gate.details.every((detail) => detail.endsWith("missing artifact")), true);
});
