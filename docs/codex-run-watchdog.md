# Codex/Claude Validation Run Watchdog

Use `npm run ops:run-watchdog -- list` to detect long-running Codex or Claude validation jobs in the current `ProjectVeil` repo, including sibling Git worktrees that share the same common `.git` directory.

The watchdog is intentionally read-only. It inspects live processes, maps each candidate job back to its repo/worktree path and branch when possible, and surfaces probable issue or PR context so an operator can decide whether to wait, investigate, or terminate.

## What It Detects

The command scans live processes and keeps only candidate validation or operator-inspection jobs such as:

- `npm run validate:*`
- `npm run test:e2e*` and raw `playwright test`
- `npm run release:*` evidence-generation and soak commands
- `npm run doctor` and `npm run validate:quickstart`
- Codex or Claude sessions whose command line still contains validation/test intent

Each job is matched to an expected window. A job that exceeds its window is marked `suspect`.

Current default windows:

- Playwright validation: 30 minutes
- Reconnect soak validation: 90 minutes
- WeChat RC validation and smoke: 45 minutes
- Release evidence generation: 60 minutes
- Generic validation scripts: 20 minutes
- Repo inspection / quickstart validation: 15 minutes
- Codex/Claude validation sessions: 120 minutes

## Basic Usage

List all candidate jobs for the current repo:

```bash
npm run ops:run-watchdog -- list
```

Only show suspect jobs:

```bash
npm run ops:run-watchdog -- list --suspect-only
```

Emit structured JSON:

```bash
npm run ops:run-watchdog -- list --format json
```

Return a non-zero exit code when any suspect job is present:

```bash
npm run ops:run-watchdog -- list --suspect-only --fail-on-suspect
```

Inspect candidate jobs across every detected repo on the host instead of only the current repo family:

```bash
npm run ops:run-watchdog -- list --all-repos
```

## Report Fields

The table and JSON output include:

- `pid`
- `user`
- `elapsed`
- expected window
- job class
- `cwd`
- repo/worktree path
- likely branch
- probable issue or PR context
- suggested next action

Probable issue context is inferred from branch names like `codex/issue-998-*` or `claude/issue-998-*`. Probable PR context is added when the repo remote is GitHub and `gh` can read open pull requests.

## Safe Escalation Workflow

Treat `suspect` as "needs human review", not "kill immediately".

1. Re-run the watchdog to confirm the process is still over the window and not already exiting.
2. Inspect the process directly: `ps -fp <pid>`.
3. Check the working directory and branch in the report, then review the linked issue or open PR context before touching the job.
4. Confirm whether the job is still producing useful output in its terminal, log file, CI artifact, or `tmux`/`screen` session.
5. If it is clearly hung or orphaned, send `SIGTERM`: `kill -TERM <pid>`.
6. Wait for a graceful shutdown, then re-run `npm run ops:run-watchdog -- list --suspect-only`.
7. Only use `SIGKILL` when the process ignores `SIGTERM`, no cleanup is still in flight, and you have already captured enough context for follow-up.

Avoid terminating:

- a process that is still actively producing validation output
- a run attached to the branch you are currently editing without first checking its terminal/session owner
- a release or soak command unless the related issue/PR owner agrees it is safe to stop

## Cron Integration

The watchdog does not install a scheduler. Use it as an input to existing cron-based repo inspections.

See [`ops/codex-run-watchdog.cron.example`](../ops/codex-run-watchdog.cron.example) for a minimal pattern that logs suspect jobs and exits non-zero so cron mail or a wrapper can alert an operator.

Recommended pairing:

- `npm run ops:run-watchdog -- list --suspect-only --fail-on-suspect`
- `npm run ops:codex-branches -- list`

Use the watchdog to answer "which live jobs look stuck?" and the branch audit to answer "which automation branches are still active or safe to prune?"
