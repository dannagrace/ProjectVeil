import test from "node:test";
import assert from "node:assert/strict";

import { renderPrComment } from "../release-pr-comment.ts";

test("renderPrComment combines readiness and non-duplicative health sections", () => {
  const markdown = renderPrComment(
    {
      generatedAt: "2026-03-30T00:00:00.000Z",
      revision: {
        shortCommit: "abc1234",
        branch: "issue-419"
      },
      summary: {
        status: "failed",
        passedGates: 2,
        totalGates: 3
      },
      gates: [
        {
          id: "release-readiness",
          label: "Release readiness snapshot",
          status: "passed",
          summary: "Snapshot passed.",
          failures: []
        },
        {
          id: "h5-release-candidate-smoke",
          label: "H5 packaged RC smoke",
          status: "passed",
          summary: "H5 smoke passed.",
          failures: []
        },
        {
          id: "wechat-release",
          label: "WeChat release validation",
          status: "failed",
          summary: "WeChat validation failed.",
          failures: ["WeChat smoke case is still pending: login-flow."]
        }
      ]
    },
    {
      generatedAt: "2026-03-30T00:02:00.000Z",
      summary: {
        status: "warning",
        blockerCount: 0,
        warningCount: 2,
        infoCount: 3
      },
      signals: [
        {
          id: "release-readiness",
          label: "Release readiness snapshot",
          status: "pass",
          summary: "ready",
          details: []
        },
        {
          id: "release-gate",
          label: "Release gate summary",
          status: "fail",
          summary: "gates failed",
          details: ["wechat pending"]
        },
        {
          id: "ci-trend",
          label: "CI trend summary",
          status: "warn",
          summary: "1 active regression",
          details: ["release-gate:wechat-release remained failing"]
        },
        {
          id: "readiness-trend",
          label: "Candidate readiness trend",
          status: "warn",
          summary: "Candidate readiness regressed from ready at prev9876 to blocked at abc1234.",
          details: [
            "current=abc1234:blocked",
            "previous=prev9876:ready"
          ]
        },
        {
          id: "coverage",
          label: "Coverage summary",
          status: "pass",
          summary: "thresholds passed",
          details: []
        }
      ]
    },
    "https://github.com/example/repo/actions/runs/123"
  );

  assert.match(markdown, /## Release Automation Summary/);
  assert.match(markdown, /Release readiness: \*\*FAILED\*\* \(2\/3 gates passing\)/);
  assert.match(markdown, /### Release Readiness/);
  assert.match(markdown, /WeChat smoke case is still pending: login-flow\./);
  assert.match(markdown, /### Release Health/);
  assert.match(markdown, /\*\*CI trend summary\*\*: `WARN` release-gate:wechat-release remained failing/);
  assert.match(
    markdown,
    /\*\*Candidate readiness trend\*\*: `WARN` Candidate readiness regressed from ready at prev9876 to blocked at abc1234\./
  );
  assert.doesNotMatch(markdown, /\*\*Candidate readiness trend\*\*: `WARN` current=abc1234:blocked/);
  assert.match(markdown, /\*\*Coverage summary\*\*: `PASS` thresholds passed/);
  assert.doesNotMatch(markdown, /\*\*Release gate summary\*\*: `FAIL`/);
});
