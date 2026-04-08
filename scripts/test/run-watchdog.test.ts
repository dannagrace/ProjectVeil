import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRunWatchdogReport,
  detectWatchRule,
  inferProcessIssueNumber
} from "../run-watchdog.ts";

test("detectWatchRule identifies Playwright validation windows", () => {
  const rule = detectWatchRule("npm run test:e2e:smoke");

  assert.deepEqual(rule, {
    id: "playwright-e2e",
    label: "Playwright validation",
    expectedWindowMinutes: 30
  });
});

test("inferProcessIssueNumber prefers branch issue naming and falls back to command hints", () => {
  assert.equal(inferProcessIssueNumber("codex/issue-998-run-watchdog", "npm run validate:content-pack"), 998);
  assert.equal(inferProcessIssueNumber(null, "node ./tools/issue-777-check.js"), 777);
});

test("buildRunWatchdogReport flags jobs beyond their expected window and maps probable PR context", () => {
  const report = buildRunWatchdogReport({
    processes: [
      {
        pid: 1201,
        user: "operator",
        elapsedSeconds: 4_200,
        command: "npm run validate:wechat-rc",
        cwd: "/srv/ProjectVeil/.worktrees/issue-998"
      },
      {
        pid: 1202,
        user: "operator",
        elapsedSeconds: 300,
        command: "npm run validate:content-pack",
        cwd: "/srv/ProjectVeil/.worktrees/issue-999"
      },
      {
        pid: 1203,
        user: "operator",
        elapsedSeconds: 3_600,
        command: "npm run dev:client",
        cwd: "/srv/ProjectVeil"
      }
    ],
    repoContextByPid: new Map([
      [
        1201,
        {
          repoPath: "/srv/ProjectVeil/.worktrees/issue-998",
          commonGitDir: "/srv/ProjectVeil/.git",
          branch: "codex/issue-998-run-watchdog",
          githubRepo: "dannagrace/ProjectVeil"
        }
      ],
      [
        1202,
        {
          repoPath: "/srv/ProjectVeil/.worktrees/issue-999",
          commonGitDir: "/srv/ProjectVeil/.git",
          branch: "codex/issue-999-something-else",
          githubRepo: "dannagrace/ProjectVeil"
        }
      ],
      [
        1203,
        {
          repoPath: "/srv/ProjectVeil",
          commonGitDir: "/srv/ProjectVeil/.git",
          branch: "main",
          githubRepo: "dannagrace/ProjectVeil"
        }
      ]
    ]),
    openPrsByRepo: new Map([
      [
        "dannagrace/ProjectVeil",
        new Map([
          [
            "codex/issue-998-run-watchdog",
            {
              number: 1001,
              url: "https://github.com/dannagrace/ProjectVeil/pull/1001",
              title: "run watchdog",
              headRefName: "codex/issue-998-run-watchdog"
            }
          ]
        ])
      ]
    ]),
    repoCommonDirScope: "/srv/ProjectVeil/.git"
  });

  assert.equal(report.summary.candidateJobs, 2);
  assert.equal(report.summary.suspects, 1);
  assert.equal(report.entries[0]?.pid, 1201);
  assert.equal(report.entries[0]?.status, "suspect");
  assert.equal(report.entries[0]?.probableIssue, 998);
  assert.equal(report.entries[0]?.probablePr?.number, 1001);
  assert.match(report.entries[0]?.nextAction ?? "", /SIGTERM/);
  assert.equal(report.entries[1]?.status, "within-window");
});

test("buildRunWatchdogReport respects repo scope filtering unless all repos is enabled", () => {
  const processes = [
    {
      pid: 2001,
      user: "operator",
      elapsedSeconds: 1_600,
      command: "npm run validate:content-pack",
      cwd: "/srv/ProjectVeil"
    },
    {
      pid: 2002,
      user: "operator",
      elapsedSeconds: 1_600,
      command: "npm run validate:content-pack",
      cwd: "/srv/OtherRepo"
    }
  ];
  const repoContextByPid = new Map([
    [
      2001,
      {
        repoPath: "/srv/ProjectVeil",
        commonGitDir: "/srv/ProjectVeil/.git",
        branch: "codex/issue-998-run-watchdog",
        githubRepo: "dannagrace/ProjectVeil"
      }
    ],
    [
      2002,
      {
        repoPath: "/srv/OtherRepo",
        commonGitDir: "/srv/OtherRepo/.git",
        branch: "claude/issue-22-cleanup",
        githubRepo: "example/OtherRepo"
      }
    ]
  ]);

  const scoped = buildRunWatchdogReport({
    processes,
    repoContextByPid,
    repoCommonDirScope: "/srv/ProjectVeil/.git"
  });
  const allRepos = buildRunWatchdogReport({
    processes,
    repoContextByPid,
    allRepos: true
  });

  assert.equal(scoped.entries.length, 1);
  assert.equal(scoped.entries[0]?.pid, 2001);
  assert.equal(allRepos.entries.length, 2);
});
