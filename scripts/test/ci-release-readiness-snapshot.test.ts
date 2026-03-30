import test from "node:test";
import assert from "node:assert/strict";

import { buildCiReleaseReadinessSnapshot, mapWorkflowResultToCheckStatus } from "../ci-release-readiness-snapshot.ts";

const revision = {
  commit: "abc1234567890",
  shortCommit: "abc1234",
  branch: "test/branch",
  dirty: false
};

test("mapWorkflowResultToCheckStatus normalizes GitHub job conclusions", () => {
  assert.equal(mapWorkflowResultToCheckStatus("success"), "passed");
  assert.equal(mapWorkflowResultToCheckStatus("failure"), "failed");
  assert.equal(mapWorkflowResultToCheckStatus("cancelled"), "failed");
  assert.equal(mapWorkflowResultToCheckStatus("skipped"), "not_applicable");
  assert.equal(mapWorkflowResultToCheckStatus(undefined), "pending");
});

test("buildCiReleaseReadinessSnapshot marks passing CI jobs as release-ready", () => {
  const snapshot = buildCiReleaseReadinessSnapshot(
    {
      validateStatus: "success",
      wechatBuildStatus: "success",
      clientRcSmokeStatus: "success"
    },
    revision
  );

  assert.equal(snapshot.summary.status, "passed");
  assert.equal(snapshot.summary.passed, 3);
  assert.equal(snapshot.summary.failed, 0);
  assert.equal(snapshot.summary.requiredFailed, 0);
  assert.equal(snapshot.checks.map((check) => check.id).join(","), "validate,wechat-build-validation,client-release-candidate-smoke");
});

test("buildCiReleaseReadinessSnapshot fails when any required CI job fails", () => {
  const snapshot = buildCiReleaseReadinessSnapshot(
    {
      validateStatus: "failure",
      wechatBuildStatus: "success",
      clientRcSmokeStatus: "success"
    },
    revision
  );

  assert.equal(snapshot.summary.status, "failed");
  assert.equal(snapshot.summary.failed, 1);
  assert.equal(snapshot.summary.requiredFailed, 1);
  assert.deepEqual(
    snapshot.checks.map((check) => [check.id, check.status]),
    [
      ["validate", "failed"],
      ["wechat-build-validation", "passed"],
      ["client-release-candidate-smoke", "passed"]
    ]
  );
});
