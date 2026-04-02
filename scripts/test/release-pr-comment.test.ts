import test from "node:test";
import assert from "node:assert/strict";

import { renderPrComment } from "../release-pr-comment.ts";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createReleaseGateReport() {
  return {
    generatedAt: "2026-03-30T00:00:00.000Z",
    revision: {
      shortCommit: "abc1234",
      branch: "issue-419"
    },
    summary: {
      status: "failed" as const,
      passedGates: 2,
      totalGates: 3
    },
    gates: [
      {
        id: "release-readiness",
        label: "Release readiness snapshot",
        status: "passed" as const,
        summary: "Snapshot passed.",
        failures: []
      },
      {
        id: "h5-release-candidate-smoke",
        label: "H5 packaged RC smoke",
        status: "passed" as const,
        summary: "H5 smoke passed.",
        failures: []
      },
      {
        id: "wechat-release",
        label: "WeChat release validation",
        status: "failed" as const,
        summary: "WeChat validation failed.",
        failures: ["WeChat smoke case is still pending: login-flow."]
      }
    ],
    triage: {
      blockers: [
        {
          title: "WeChat release validation",
          impactedSurface: "wechat" as const,
          summary: "WeChat release validation blocked wechat: WeChat smoke case is still pending: login-flow.",
          nextStep:
            "Open `artifacts/wechat-release/codex.wechat.smoke-report.json`, rerun `npm run smoke:wechat-release -- --check` to refresh the WeChat evidence, then rerun `npm run release:gate:summary -- --target-surface wechat`.",
          artifacts: [{ path: "artifacts/wechat-release/codex.wechat.smoke-report.json" }]
        }
      ],
      warnings: [
        {
          title: "Config change risk summary",
          impactedSurface: "wechat" as const,
          summary:
            "Config changes are HIGH risk for wechat and stay advisory until the suggested validation is complete.",
          nextStep:
            "Open `configs/.config-center-library.json` and run `npm run release:readiness:snapshot`, `npm run smoke:client:release-candidate`, `npm run validate:battle` before promotion.",
          artifacts: [{ path: "configs/.config-center-library.json" }]
        }
      ]
    }
  };
}

function createReleaseHealthReport(
  readinessTrendSignal?: {
    status: "pass" | "warn" | "fail";
    summary: string;
    details: string[];
  }
) {
  return {
    generatedAt: "2026-03-30T00:02:00.000Z",
    summary: {
      status: "warning" as const,
      blockerCount: 0,
      warningCount: 2,
      infoCount: 3
    },
    signals: [
      {
        id: "release-readiness",
        label: "Release readiness snapshot",
        status: "pass" as const,
        summary: "ready",
        details: []
      },
      {
        id: "release-gate",
        label: "Release gate summary",
        status: "fail" as const,
        summary: "gates failed",
        details: ["wechat pending"]
      },
      {
        id: "ci-trend",
        label: "CI trend summary",
        status: "warn" as const,
        summary: "1 active regression",
        details: ["release-gate:wechat-release remained failing"]
      },
      ...(readinessTrendSignal
        ? [
            {
              id: "readiness-trend",
              label: "Candidate readiness trend",
              ...readinessTrendSignal
            }
          ]
        : []),
      {
        id: "coverage",
        label: "Coverage summary",
        status: "pass" as const,
        summary: "thresholds passed",
        details: []
      }
    ],
    triage: {
      blockers: [],
      warnings: [
        {
          signalId: "ci-trend",
          summary: "release-gate:wechat-release remained failing",
          nextStep:
            "Open `artifacts/release-readiness/ci-trend-summary.json` and compare the new or ongoing regressions against the current runtime and release-gate artifacts before retrying the affected job."
        },
        ...(readinessTrendSignal
          ? [
              {
                signalId: "readiness-trend",
                summary: readinessTrendSignal.summary,
                nextStep:
                  "Open `artifacts/release-readiness/release-readiness-dashboard.json` and `artifacts/release-readiness/release-readiness-dashboard-prev.json` to compare the candidate blockers or pending checks before advancing the next revision."
              }
            ]
          : [])
      ]
    }
  };
}

test("renderPrComment combines readiness and non-duplicative health sections", () => {
  const markdown = renderPrComment(
    createReleaseGateReport(),
    createReleaseHealthReport({
      status: "warn",
      summary: "Candidate readiness regressed from ready at prev9876 to blocked at abc1234.",
      details: [
        "current=abc1234:blocked",
        "previous=prev9876:ready"
      ]
    }),
    "https://github.com/example/repo/actions/runs/123"
  );

  assert.match(markdown, /## Release Automation Summary/);
  assert.match(markdown, /### Triage/);
  assert.match(markdown, /\*\*Release blockers\*\*: `FAIL` 1 blocking release-gate item\(s\) need operator follow-up\./);
  assert.match(
    markdown,
    /Next step: Open `artifacts\/wechat-release\/codex\.wechat\.smoke-report\.json`, rerun `npm run smoke:wechat-release -- --check` to refresh the WeChat evidence, then rerun `npm run release:gate:summary -- --target-surface wechat`\./
  );
  assert.match(markdown, /Artifacts: `artifacts\/wechat-release\/codex\.wechat\.smoke-report\.json`/);
  assert.match(markdown, /\*\*WeChat release validation\*\* \(wechat\): WeChat release validation blocked wechat/);
  assert.match(markdown, /\*\*Release warnings\*\*: `WARN` 1 advisory release-gate warning\(s\) are worth checking before promotion\./);
  assert.match(markdown, /Release readiness: \*\*FAILED\*\* \(2\/3 gates passing\)/);
  assert.match(markdown, /### Release Readiness/);
  assert.match(markdown, /WeChat smoke case is still pending: login-flow\./);
  assert.match(markdown, /### Release Health/);
  assert.match(markdown, /\*\*CI trend summary\*\*: `WARN` release-gate:wechat-release remained failing/);
  assert.match(
    markdown,
    /Next step: Open `artifacts\/release-readiness\/ci-trend-summary\.json` and compare the new or ongoing regressions against the current runtime and release-gate artifacts before retrying the affected job\./
  );
  assert.match(
    markdown,
    /\*\*Candidate readiness trend\*\*: `WARN` Candidate readiness regressed from ready at prev9876 to blocked at abc1234\./
  );
  assert.match(
    markdown,
    /Next step: Open `artifacts\/release-readiness\/release-readiness-dashboard\.json` and `artifacts\/release-readiness\/release-readiness-dashboard-prev\.json` to compare the candidate blockers or pending checks before advancing the next revision\./
  );
  assert.match(markdown, /\*\*Coverage summary\*\*: `PASS` thresholds passed/);
  assert.doesNotMatch(markdown, /\*\*Release gate summary\*\*: `FAIL`/);
});

test("renderPrComment keeps readiness-trend markdown stable for edge-case summaries", () => {
  const scenarios = [
    {
      name: "improved readiness delta",
      signal: {
        status: "pass" as const,
        summary: "Candidate readiness improved from blocked at prev9876 to ready at abc1234.",
        details: [
          "delta=+1 readiness rank",
          "pending_checks_delta=-2"
        ]
      },
      expectedLine:
        /\*\*Candidate readiness trend\*\*: `PASS` Candidate readiness improved from blocked at prev9876 to ready at abc1234\./,
      omittedLines: [/delta=\+1 readiness rank/, /pending_checks_delta=-2/]
    },
    {
      name: "unchanged unready delta",
      signal: {
        status: "warn" as const,
        summary: "Candidate readiness remains blocked across prev9876 and abc1234.",
        details: [
          "delta=0 readiness rank",
          "blocking_checks_delta=0"
        ]
      },
      expectedLine:
        /\*\*Candidate readiness trend\*\*: `WARN` Candidate readiness remains blocked across prev9876 and abc1234\./,
      omittedLines: [/delta=0 readiness rank/, /blocking_checks_delta=0/]
    },
    {
      name: "missing baseline labels unavailable history in summary only",
      signal: {
        status: "warn" as const,
        summary: "No previous candidate dashboard was available; current candidate abc1234 is blocked.",
        details: [
          "current summary: Manual checks still pending.",
          "previous=unavailable"
        ]
      },
      expectedLine:
        /\*\*Candidate readiness trend\*\*: `WARN` No previous candidate dashboard was available; current candidate abc1234 is blocked\./,
      omittedLines: [/current summary: Manual checks still pending\./, /previous=unavailable/]
    }
  ];

  for (const scenario of scenarios) {
    const markdown = renderPrComment(createReleaseGateReport(), createReleaseHealthReport(scenario.signal));
    assert.match(markdown, scenario.expectedLine, scenario.name);
    for (const omittedLine of scenario.omittedLines) {
      assert.doesNotMatch(markdown, omittedLine, scenario.name);
    }
  }
});

test("renderPrComment and release-health triage share the same readiness-trend reviewer contract", () => {
  const report = createReleaseHealthReport({
    status: "warn",
    summary: "Candidate readiness regressed from ready at prev9876 to blocked at abc1234.",
    details: ["current=abc1234:blocked", "previous=prev9876:ready"]
  });

  const markdown = renderPrComment(createReleaseGateReport(), report);
  const readinessTriage = report.triage.warnings.find((entry) => entry.signalId === "readiness-trend");

  assert.ok(readinessTriage);
  assert.match(
    markdown,
    new RegExp(
      escapeRegExp(
        `- **Candidate readiness trend**: \`WARN\` ${readinessTriage.summary}\n  Next step: ${readinessTriage.nextStep}`
      )
    )
  );
});
