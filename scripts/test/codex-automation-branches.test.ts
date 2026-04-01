import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBranchAuditReport,
  selectPruneCandidates,
  type BranchAuditEntry
} from "../audit-codex-automation-branches.ts";

const NOW = Date.parse("2026-04-02T00:00:00.000Z");

function makeEntry(overrides: Partial<BranchAuditEntry>): BranchAuditEntry {
  return {
    scope: "local",
    branch: "codex/issue-1-sample",
    refName: "refs/heads/codex/issue-1-sample",
    sha: "abc123",
    updatedAt: "2026-03-20T00:00:00.000Z",
    ageDays: 13,
    upstream: "origin/codex/issue-1-sample",
    upstreamStatus: "up-to-date",
    merged: true,
    openPr: null,
    classification: "safe-to-delete",
    nextAction: "eligible for local prune",
    reasons: ["merged into main"],
    ...overrides
  };
}

test("buildBranchAuditReport marks merged branches without open PRs as safe prune candidates after retention", () => {
  const report = buildBranchAuditReport({
    branches: [
      {
        scope: "local",
        refName: "refs/heads/codex/issue-100-cleanup",
        shortName: "codex/issue-100-cleanup",
        sha: "1111111",
        updatedAt: "2026-03-20T00:00:00.000Z",
        upstream: "origin/codex/issue-100-cleanup",
        upstreamTrack: null
      }
    ],
    mergedRefs: new Set(["refs/heads/codex/issue-100-cleanup"]),
    openPrsByBranch: new Map(),
    base: "main",
    currentBranch: "codex/issue-576-prune-stale-automation-branches",
    nowMs: NOW,
    mergedRetentionDays: 7,
    abandonedReviewDays: 30
  });

  assert.equal(report[0]?.classification, "safe-to-delete");
  assert.equal(report[0]?.nextAction, "eligible for local prune");
});

test("buildBranchAuditReport keeps branches with open PRs active even when merged", () => {
  const report = buildBranchAuditReport({
    branches: [
      {
        scope: "remote",
        refName: "refs/remotes/origin/codex/issue-101-pr-open",
        shortName: "codex/issue-101-pr-open",
        sha: "2222222",
        updatedAt: "2026-03-01T00:00:00.000Z",
        upstream: null,
        upstreamTrack: null
      }
    ],
    mergedRefs: new Set(["refs/remotes/origin/codex/issue-101-pr-open"]),
    openPrsByBranch: new Map([
      [
        "codex/issue-101-pr-open",
        {
          number: 901,
          url: "https://example.test/pr/901",
          headRefName: "codex/issue-101-pr-open"
        }
      ]
    ]),
    base: "main",
    currentBranch: "codex/issue-576-prune-stale-automation-branches",
    nowMs: NOW,
    mergedRetentionDays: 7,
    abandonedReviewDays: 30
  });

  assert.equal(report[0]?.classification, "active");
  assert.match(report[0]?.nextAction ?? "", /PR #901/);
});

test("buildBranchAuditReport sends old unmerged branches to manual review instead of auto prune", () => {
  const report = buildBranchAuditReport({
    branches: [
      {
        scope: "local",
        refName: "refs/heads/codex/issue-102-stale",
        shortName: "codex/issue-102-stale",
        sha: "3333333",
        updatedAt: "2026-02-01T00:00:00.000Z",
        upstream: "origin/codex/issue-102-stale",
        upstreamTrack: "[gone]"
      }
    ],
    mergedRefs: new Set(),
    openPrsByBranch: new Map(),
    base: "main",
    currentBranch: "codex/issue-576-prune-stale-automation-branches",
    nowMs: NOW,
    mergedRetentionDays: 7,
    abandonedReviewDays: 30
  });

  assert.equal(report[0]?.classification, "manual-review");
  assert.match((report[0]?.reasons ?? []).join("\n"), /tracked remote branch is gone/);
});

test("selectPruneCandidates leaves remote refs alone unless remote deletion is explicitly enabled", () => {
  const entries = [
    makeEntry({ scope: "local", branch: "codex/issue-103-local", refName: "refs/heads/codex/issue-103-local" }),
    makeEntry({
      scope: "remote",
      branch: "codex/issue-103-remote",
      refName: "refs/remotes/origin/codex/issue-103-remote",
      nextAction: "eligible for remote prune"
    })
  ];

  assert.deepEqual(
    selectPruneCandidates(entries, false).map((entry) => `${entry.scope}:${entry.branch}`),
    ["local:codex/issue-103-local"]
  );
  assert.deepEqual(
    selectPruneCandidates(entries, true).map((entry) => `${entry.scope}:${entry.branch}`),
    ["local:codex/issue-103-local", "remote:codex/issue-103-remote"]
  );
});
