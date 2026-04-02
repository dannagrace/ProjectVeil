import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildBranchAuditReport,
  selectPruneCandidates,
  type BranchAuditEntry
} from "../audit-codex-automation-branches.ts";

const NOW = Date.parse("2026-04-02T00:00:00.000Z");
const repoRoot = path.resolve(__dirname, "../..");
const auditScriptPath = path.join(repoRoot, "scripts", "audit-codex-automation-branches.ts");
const tsxLoaderPath = path.join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

interface BranchFixture {
  workspace: string;
  repoDir: string;
  branches: {
    safeLocal: string;
    current: string;
    safeRemote: string;
    openPrRemote: string;
    staleLocal: string;
  };
}

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

function runGit(
  cwd: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    allowFailure?: boolean;
  } = {}
): SpawnSyncReturns<string> {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env
    }
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  return result;
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return runGit(cwd, args, env ? { env } : {}).stdout.trim();
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o755 });
}

function commitFile(cwd: string, filePath: string, message: string, when: string, content?: string): string {
  const absolutePath = path.join(cwd, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content ?? `${message}\n`, "utf8");
  git(cwd, ["add", filePath]);
  git(cwd, ["commit", "-m", message], {
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_DATE: when
  });
  return git(cwd, ["rev-parse", "HEAD"]);
}

function createBranchFixture(): BranchFixture {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-codex-branches-"));
  const remoteDir = path.join(workspace, "origin.git");
  const repoDir = path.join(workspace, "repo");
  const branches = {
    safeLocal: "codex/issue-200-safe-local",
    current: "codex/issue-201-current-branch",
    safeRemote: "codex/issue-202-safe-remote",
    openPrRemote: "codex/issue-203-open-pr",
    staleLocal: "codex/issue-204-stale-local"
  };

  git(workspace, ["init", "--bare", remoteDir]);
  git(workspace, ["clone", remoteDir, repoDir]);
  git(repoDir, ["config", "user.name", "Project Veil Test"]);
  git(repoDir, ["config", "user.email", "projectveil@example.test"]);
  git(repoDir, ["checkout", "-b", "main"]);

  commitFile(repoDir, "README.md", "initial main commit", "2024-01-01T00:00:00.000Z", "# fixture\n");
  git(repoDir, ["push", "-u", "origin", "main"]);

  git(repoDir, ["checkout", "-b", branches.safeLocal, "main"]);
  commitFile(repoDir, "safe-local.txt", "safe local commit", "2024-02-01T00:00:00.000Z");
  git(repoDir, ["checkout", "main"]);
  git(repoDir, ["merge", "--ff-only", branches.safeLocal]);
  git(repoDir, ["push", "origin", "main"]);

  git(repoDir, ["checkout", "-b", branches.safeRemote, "main"]);
  git(repoDir, ["push", "-u", "origin", branches.safeRemote]);
  git(repoDir, ["checkout", "main"]);
  git(repoDir, ["branch", "-D", branches.safeRemote]);

  git(repoDir, ["checkout", "-b", branches.openPrRemote, "main"]);
  git(repoDir, ["push", "-u", "origin", branches.openPrRemote]);
  git(repoDir, ["checkout", "main"]);
  git(repoDir, ["branch", "-D", branches.openPrRemote]);

  git(repoDir, ["checkout", "-b", branches.staleLocal, "main"]);
  commitFile(repoDir, "stale-local.txt", "stale local commit", "2024-01-15T00:00:00.000Z");
  git(repoDir, ["checkout", "main"]);

  git(repoDir, ["checkout", "-b", branches.current, "main"]);
  git(repoDir, ["fetch", "origin"]);

  return {
    workspace,
    repoDir,
    branches
  };
}

function runAudit(repoDir: string, args: string[], openPrBranches: string[]): SpawnSyncReturns<string> {
  const toolsDir = path.join(path.dirname(repoDir), "tools");
  fs.mkdirSync(toolsDir, { recursive: true });
  writeExecutable(
    path.join(toolsDir, "gh"),
    `#!/usr/bin/env node
const openPrs = JSON.parse(process.env.VEIL_TEST_OPEN_PRS ?? "[]");
const args = process.argv.slice(2);
if (args[0] === "pr" && args[1] === "list") {
  process.stdout.write(JSON.stringify(openPrs));
  process.exit(0);
}
process.stderr.write(\`Unexpected gh invocation: \${args.join(" ")}\\n\`);
process.exit(1);
`
  );

  return spawnSync("node", ["--import", tsxLoaderPath, auditScriptPath, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${toolsDir}:${process.env.PATH ?? ""}`,
      VEIL_TEST_OPEN_PRS: JSON.stringify(
        openPrBranches.map((branch, index) => ({
          number: 900 + index,
          url: `https://example.test/pr/${900 + index}`,
          headRefName: branch
        }))
      )
    }
  });
}

function branchExists(repoDir: string, ref: string): boolean {
  return runGit(repoDir, ["rev-parse", "--verify", ref], { allowFailure: true }).status === 0;
}

function remoteBranchExists(repoDir: string, branch: string): boolean {
  const output = git(repoDir, ["ls-remote", "--heads", "origin", branch]);
  return output.length > 0;
}

function parseJsonOutput(stdout: string): unknown {
  const json = stdout.split("\nDry run only.")[0];
  if (!json) {
    throw new Error(`Expected JSON output, received:\n${stdout}`);
  }
  return JSON.parse(json.trim());
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

test("ops:codex-branches fixture dry-run only lists explicit prune candidates", () => {
  const fixture = createBranchFixture();

  const result = runAudit(fixture.repoDir, ["prune", "--format", "json"], [fixture.branches.openPrRemote]);

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  const payload = parseJsonOutput(result.stdout) as {
    entries: Array<{ scope: string; branch: string }>;
  };
  assert.deepEqual(
    payload.entries.map((entry) => ({ scope: entry.scope, branch: entry.branch })),
    [{ scope: "local", branch: fixture.branches.safeLocal }]
  );

  const remoteEnabledResult = runAudit(
    fixture.repoDir,
    ["prune", "--format", "json", "--delete-remote"],
    [fixture.branches.openPrRemote]
  );

  assert.equal(remoteEnabledResult.status, 0, `stdout=${remoteEnabledResult.stdout}\nstderr=${remoteEnabledResult.stderr}`);
  const remoteEnabledPayload = parseJsonOutput(remoteEnabledResult.stdout) as {
    entries: Array<{ scope: string; branch: string }>;
  };
  assert.deepEqual(
    remoteEnabledPayload.entries.map((entry) => ({ scope: entry.scope, branch: entry.branch })),
    [
      { scope: "local", branch: fixture.branches.safeLocal },
      { scope: "remote", branch: fixture.branches.safeRemote }
    ]
  );
});

test("ops:codex-branches fixture apply mode preserves safety rails while pruning eligible refs", () => {
  const fixture = createBranchFixture();

  const localApplyResult = runAudit(fixture.repoDir, ["prune", "--apply"], [fixture.branches.openPrRemote]);

  assert.equal(localApplyResult.status, 0, `stdout=${localApplyResult.stdout}\nstderr=${localApplyResult.stderr}`);
  assert.match(localApplyResult.stdout, new RegExp(`Deleted local branch ${fixture.branches.safeLocal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(localApplyResult.stdout, /Pruned 1 branch ref\(s\)\./);
  assert.equal(branchExists(fixture.repoDir, `refs/heads/${fixture.branches.safeLocal}`), false);
  assert.equal(branchExists(fixture.repoDir, `refs/heads/${fixture.branches.current}`), true);
  assert.equal(branchExists(fixture.repoDir, `refs/heads/${fixture.branches.staleLocal}`), true);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.safeRemote), true);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.openPrRemote), true);

  const remoteApplyResult = runAudit(
    fixture.repoDir,
    ["prune", "--apply", "--delete-remote"],
    [fixture.branches.openPrRemote]
  );

  assert.equal(remoteApplyResult.status, 0, `stdout=${remoteApplyResult.stdout}\nstderr=${remoteApplyResult.stderr}`);
  assert.match(
    remoteApplyResult.stdout,
    new RegExp(`Deleted remote branch origin/${fixture.branches.safeRemote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  );
  assert.match(remoteApplyResult.stdout, /Pruned 1 branch ref\(s\)\./);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.safeRemote), false);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.openPrRemote), true);
});
