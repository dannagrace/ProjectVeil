import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";

import {
  buildBranchAuditReport,
  selectPruneCandidates,
  withSerializedWorktreeExecution,
  type BranchAuditEntry
} from "../audit-codex-automation-branches.ts";

const NOW = Date.parse("2026-04-02T00:00:00.000Z");
const repoRoot = path.resolve(__dirname, "../..");
const auditScriptPath = path.join(repoRoot, "scripts", "audit-codex-automation-branches.ts");
const require = createRequire(import.meta.url);
const tsxLoaderPath = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "loader.mjs");

interface BranchFixture {
  workspace: string;
  repoDir: string;
  branches: {
    safeLocal: string;
    current: string;
    safeRemote: string;
    openPrRemote: string;
    draftPrRemote: string;
    staleLocal: string;
    dirtyMerged: string;
  };
  worktrees: {
    safeLocalPath: string;
    dirtyMergedPath: string;
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
    pullRequestState: "none",
    openPr: null,
    hygieneState: "merged",
    classification: "safe-to-delete",
    nextAction: "eligible for local prune",
    reasons: ["merged into main"],
    worktrees: [],
    hasDirtyWorktree: false,
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
  const safeLocalPath = path.join(workspace, "wt-safe-local");
  const dirtyMergedPath = path.join(workspace, "wt-dirty-merged");
  const branches = {
    safeLocal: "codex/issue-200-safe-local",
    current: "codex/issue-201-current-branch",
    safeRemote: "codex/issue-202-safe-remote",
    openPrRemote: "codex/issue-203-open-pr",
    draftPrRemote: "codex/issue-205-draft-pr",
    staleLocal: "codex/issue-204-stale-local",
    dirtyMerged: "codex/issue-206-dirty-merged"
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
  git(repoDir, ["worktree", "add", safeLocalPath, branches.safeLocal]);

  git(repoDir, ["checkout", "-b", branches.safeRemote, "main"]);
  git(repoDir, ["push", "-u", "origin", branches.safeRemote]);
  git(repoDir, ["checkout", "main"]);
  git(repoDir, ["branch", "-D", branches.safeRemote]);

  git(repoDir, ["checkout", "-b", branches.openPrRemote, "main"]);
  git(repoDir, ["push", "-u", "origin", branches.openPrRemote]);
  git(repoDir, ["checkout", "main"]);
  git(repoDir, ["branch", "-D", branches.openPrRemote]);

  git(repoDir, ["checkout", "-b", branches.draftPrRemote, "main"]);
  git(repoDir, ["push", "-u", "origin", branches.draftPrRemote]);
  git(repoDir, ["checkout", "main"]);
  git(repoDir, ["branch", "-D", branches.draftPrRemote]);

  git(repoDir, ["checkout", "-b", branches.staleLocal, "main"]);
  commitFile(repoDir, "stale-local.txt", "stale local commit", "2024-01-15T00:00:00.000Z");
  git(repoDir, ["checkout", "main"]);

  git(repoDir, ["checkout", "-b", branches.dirtyMerged, "main"]);
  commitFile(repoDir, "dirty-merged.txt", "dirty merged commit", "2024-02-02T00:00:00.000Z");
  git(repoDir, ["checkout", "main"]);
  git(repoDir, ["merge", "--ff-only", branches.dirtyMerged]);
  git(repoDir, ["push", "origin", "main"]);
  git(repoDir, ["worktree", "add", dirtyMergedPath, branches.dirtyMerged]);
  fs.writeFileSync(path.join(dirtyMergedPath, "dirty-merged.txt"), "dirty change\n", "utf8");

  git(repoDir, ["checkout", "-b", branches.current, "main"]);
  git(repoDir, ["fetch", "origin"]);

  return {
    workspace,
    repoDir,
    branches,
    worktrees: {
      safeLocalPath,
      dirtyMergedPath
    }
  };
}

function runAudit(
  repoDir: string,
  args: string[],
  openPrBranches: Array<{ branch: string; isDraft?: boolean }>
): SpawnSyncReturns<string> {
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
          headRefName: branch.branch,
          isDraft: Boolean(branch.isDraft)
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

test("buildBranchAuditReport marks merged branches without PRs as cleanup candidates after retention", () => {
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
    worktrees: [
      {
        path: "/tmp/veil-cleanup",
        head: "1111111",
        branchRef: "refs/heads/codex/issue-100-cleanup",
        lockedReason: null,
        prunableReason: null,
        isCurrent: false,
        dirty: false
      }
    ],
    base: "main",
    currentBranch: "codex/issue-576-prune-stale-automation-branches",
    nowMs: NOW,
    mergedRetentionDays: 7,
    abandonedReviewDays: 30
  });

  assert.equal(report[0]?.hygieneState, "merged");
  assert.equal(report[0]?.classification, "safe-to-delete");
  assert.equal(report[0]?.nextAction, "eligible for worktree + local prune");
});

test("buildBranchAuditReport distinguishes draft PR branches from open PR branches", () => {
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
      },
      {
        scope: "remote",
        refName: "refs/remotes/origin/codex/issue-102-pr-draft",
        shortName: "codex/issue-102-pr-draft",
        sha: "3333333",
        updatedAt: "2026-03-01T00:00:00.000Z",
        upstream: null,
        upstreamTrack: null
      }
    ],
    mergedRefs: new Set(),
    openPrsByBranch: new Map([
      [
        "codex/issue-101-pr-open",
        {
          number: 901,
          url: "https://example.test/pr/901",
          headRefName: "codex/issue-101-pr-open",
          isDraft: false
        }
      ],
      [
        "codex/issue-102-pr-draft",
        {
          number: 902,
          url: "https://example.test/pr/902",
          headRefName: "codex/issue-102-pr-draft",
          isDraft: true
        }
      ]
    ]),
    worktrees: [],
    base: "main",
    currentBranch: "codex/issue-576-prune-stale-automation-branches",
    nowMs: NOW,
    mergedRetentionDays: 7,
    abandonedReviewDays: 30
  });

  assert.equal(report[0]?.hygieneState, "open-pr");
  assert.equal(report[0]?.pullRequestState, "open-pr");
  assert.equal(report[1]?.hygieneState, "draft-pr");
  assert.equal(report[1]?.pullRequestState, "draft-pr");
});

test("buildBranchAuditReport sends orphaned branches to manual review", () => {
  const report = buildBranchAuditReport({
    branches: [
      {
        scope: "local",
        refName: "refs/heads/codex/issue-103-orphaned",
        shortName: "codex/issue-103-orphaned",
        sha: "4444444",
        updatedAt: "2026-02-01T00:00:00.000Z",
        upstream: "origin/codex/issue-103-orphaned",
        upstreamTrack: "[gone]"
      }
    ],
    mergedRefs: new Set(),
    openPrsByBranch: new Map(),
    worktrees: [],
    base: "main",
    currentBranch: "codex/issue-576-prune-stale-automation-branches",
    nowMs: NOW,
    mergedRetentionDays: 7,
    abandonedReviewDays: 30
  });

  assert.equal(report[0]?.hygieneState, "orphaned");
  assert.equal(report[0]?.classification, "manual-review");
  assert.match((report[0]?.reasons ?? []).join("\n"), /tracked remote branch is gone/);
});

test("selectPruneCandidates refuses merged local branches with dirty attached worktrees", () => {
  const entries = [
    makeEntry({
      branch: "codex/issue-103-dirty",
      refName: "refs/heads/codex/issue-103-dirty",
      worktrees: [
        {
          path: "/tmp/veil-dirty",
          dirty: true,
          isCurrent: false,
          locked: false,
          lockedReason: null,
          prunable: false,
          prunableReason: null
        }
      ],
      hasDirtyWorktree: true
    }),
    makeEntry({ scope: "remote", branch: "codex/issue-103-remote", refName: "refs/remotes/origin/codex/issue-103-remote" })
  ];

  assert.deepEqual(
    selectPruneCandidates(entries, true).map((entry) => `${entry.scope}:${entry.branch}`),
    ["remote:codex/issue-103-remote"]
  );
});

test("withSerializedWorktreeExecution serializes concurrent runs within the same worktree git dir", async () => {
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-codex-lock-"));
  const events: string[] = [];

  const firstRun = withSerializedWorktreeExecution(gitDir, async () => {
    events.push("first:start");
    await delay(150);
    events.push("first:end");
  });

  await delay(25);

  const secondRun = withSerializedWorktreeExecution(
    gitDir,
    async () => {
      events.push("second:start");
      events.push("second:end");
    },
    {
      pollIntervalMs: 10,
      timeoutMs: 1_000
    }
  );

  await Promise.all([firstRun, secondRun]);

  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("withSerializedWorktreeExecution times out with owner details when the worktree lock stays held", async () => {
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-codex-lock-timeout-"));
  const lockDir = path.join(gitDir, "codex-automation-run.lock");
  fs.mkdirSync(lockDir);
  fs.writeFileSync(
    path.join(lockDir, "owner.json"),
    `${JSON.stringify(
      {
        pid: 4321,
        acquiredAt: "2026-04-02T00:00:00.000Z",
        cwd: "/tmp/example-worktree",
        argv: ["prune", "--apply"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await assert.rejects(
    () =>
      withSerializedWorktreeExecution(
        gitDir,
        async () => {
          throw new Error("unreachable");
        },
        {
          pollIntervalMs: 10,
          timeoutMs: 40
        }
      ),
    /Another codex automation run is still active for this repository worktree \(pid 4321, acquired 2026-04-02T00:00:00.000Z, cwd \/tmp\/example-worktree, args prune --apply\)\./
  );
});

test("ops:branch-hygiene fixture dry-run only lists explicit cleanup candidates", () => {
  const fixture = createBranchFixture();

  const result = runAudit(fixture.repoDir, ["prune", "--format", "json"], [
    { branch: fixture.branches.openPrRemote },
    { branch: fixture.branches.draftPrRemote, isDraft: true }
  ]);

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  const payload = parseJsonOutput(result.stdout) as {
    entries: Array<{ scope: string; branch: string }>;
    summary: { merged: number; openPr: number; draftPr: number };
    worktrees: Array<{ path: string; state: string }>;
  };
  assert.deepEqual(
    payload.entries.map((entry) => ({ scope: entry.scope, branch: entry.branch })),
    [{ scope: "local", branch: fixture.branches.safeLocal }]
  );
  assert.equal(payload.summary.openPr, 1);
  assert.equal(payload.summary.draftPr, 1);
  assert.ok(
    payload.worktrees.some(
      (worktree) => path.basename(worktree.path) === path.basename(fixture.worktrees.safeLocalPath) && worktree.state === "merged"
    )
  );
  assert.ok(
    payload.worktrees.some(
      (worktree) => path.basename(worktree.path) === path.basename(fixture.worktrees.dirtyMergedPath) && worktree.state === "dirty"
    )
  );

  const remoteEnabledResult = runAudit(fixture.repoDir, ["prune", "--format", "json", "--delete-remote"], [
    { branch: fixture.branches.openPrRemote },
    { branch: fixture.branches.draftPrRemote, isDraft: true }
  ]);

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

test("ops:branch-hygiene apply mode removes clean merged worktrees and preserves blocked refs", () => {
  const fixture = createBranchFixture();

  const localApplyResult = runAudit(fixture.repoDir, ["prune", "--apply"], [
    { branch: fixture.branches.openPrRemote },
    { branch: fixture.branches.draftPrRemote, isDraft: true }
  ]);

  assert.equal(localApplyResult.status, 0, `stdout=${localApplyResult.stdout}\nstderr=${localApplyResult.stderr}`);
  assert.match(
    localApplyResult.stdout,
    new RegExp(`Removed worktree .*${path.basename(fixture.worktrees.safeLocalPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  );
  assert.match(
    localApplyResult.stdout,
    new RegExp(`Deleted local branch ${fixture.branches.safeLocal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  );
  assert.match(localApplyResult.stdout, /Pruned 1 branch ref\(s\)\./);
  assert.equal(branchExists(fixture.repoDir, `refs/heads/${fixture.branches.safeLocal}`), false);
  assert.equal(fs.existsSync(fixture.worktrees.safeLocalPath), false);
  assert.equal(branchExists(fixture.repoDir, `refs/heads/${fixture.branches.current}`), true);
  assert.equal(branchExists(fixture.repoDir, `refs/heads/${fixture.branches.staleLocal}`), true);
  assert.equal(branchExists(fixture.repoDir, `refs/heads/${fixture.branches.dirtyMerged}`), true);
  assert.equal(fs.existsSync(fixture.worktrees.dirtyMergedPath), true);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.safeRemote), true);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.openPrRemote), true);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.draftPrRemote), true);

  const remoteApplyResult = runAudit(fixture.repoDir, ["prune", "--apply", "--delete-remote"], [
    { branch: fixture.branches.openPrRemote },
    { branch: fixture.branches.draftPrRemote, isDraft: true }
  ]);

  assert.equal(remoteApplyResult.status, 0, `stdout=${remoteApplyResult.stdout}\nstderr=${remoteApplyResult.stderr}`);
  assert.match(
    remoteApplyResult.stdout,
    new RegExp(`Deleted remote branch origin/${fixture.branches.safeRemote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  );
  assert.match(remoteApplyResult.stdout, /Pruned 1 branch ref\(s\)\./);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.safeRemote), false);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.openPrRemote), true);
  assert.equal(remoteBranchExists(fixture.repoDir, fixture.branches.draftPrRemote), true);
});
