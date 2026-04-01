# Codex Automation Branch Maintenance Runbook

This runbook is for operators auditing and pruning stale `codex/issue-*` automation branches in `dannagrace/ProjectVeil`.

`npm run ops:codex-branches` inspects local refs and `origin/codex/issue-*` refs in the current repository, then combines Git state with current open-PR data from `gh`. It does not touch unrelated files or worktrees, and `prune` is dry-run by default.

## When To Run It

Run this workflow when codex automation branches have accumulated and you need to confirm which ones are still active, which need manual follow-up, and which merged branches are old enough to prune.

Use it before doing any manual branch cleanup in GitHub or locally. The script is the source of truth for the audit classification.

## Safety Checks Before Any Cleanup

Confirm all of the following before acting on a prune result:

- You are in the `ProjectVeil` repo and have fetched the latest remote refs.
- Your local `main` is current with `origin/main`.
- `gh auth status` succeeds for the GitHub account that can read PR state for this repo.
- You are not currently checked out on a branch you expect to prune.
- You have reviewed the dry-run output from `prune` in the same repo state you plan to act on.

Recommended prep:

```bash
git checkout main
git pull --ff-only origin main
git fetch --prune origin
gh auth status
```

## Audit Workflow

Start with a read-only audit:

```bash
npm run ops:codex-branches -- list
```

Use JSON output if you want to save or diff the report:

```bash
npm run ops:codex-branches -- list --format json
```

Each row reports:

- age in days since the latest commit
- upstream tracking status for local branches
- whether the branch tip is already merged into `main`
- whether an open PR still exists for that branch name
- a classification of `active`, `safe-to-delete`, or `manual-review`
- the suggested next action for that branch

## Classification And Explicit Exclusions

The audit intentionally excludes the following branches from automatic pruning:

- Open PR branches: any branch with an open pull request stays `active`, even if already merged.
- Active branches: the currently checked-out branch and recent unmerged work stay out of automatic deletion.
- Manual-review branches: stale unmerged branches and branches whose tracked upstream is already gone require human review and are never auto-pruned.

Retention policy:

- Active branches: keep any branch with an open PR, the currently checked-out branch, or unmerged work updated within the last 30 days.
- Merged branches: keep merged branches for 7 days after their latest commit so recent automation work remains visible while review and post-merge checks settle.
- Abandoned branches: treat unmerged branches older than 30 days and branches whose tracked upstream is already gone as `manual-review`.

Only one class is eligible for automatic pruning:

- Safe-to-delete: merged into `main`, no open PR, older than the 7-day merged retention window, and not the currently checked-out branch.

## Dry-Run-First Prune Workflow

Always preview prune candidates before deletion:

```bash
npm run ops:codex-branches -- prune
```

That command only prints `safe-to-delete` rows. It does not delete anything until `--apply` is present.

If the dry run looks correct, delete eligible local branches:

```bash
npm run ops:codex-branches -- prune --apply
```

Delete remote branches only after confirming the dry-run set still looks correct and you explicitly want to remove `origin/*` refs too:

```bash
npm run ops:codex-branches -- prune --apply --delete-remote
```

## Post-Run Verification

After any applied prune:

- Re-run `npm run ops:codex-branches -- list` to confirm the remaining branch set.
- Check that any expected open PR branches still appear as `active`.
- If you deleted remote refs, verify GitHub no longer shows those fully merged, no-PR branches as active heads.

## Guardrails Enforced By The Script

- No deletion happens unless `--apply` is present.
- Remote branch deletion is disabled unless `--delete-remote` is present.
- Branches with open PRs are never pruned.
- Unmerged stale branches stay in `manual-review`; the tool does not auto-delete them.
- The currently checked-out branch is never pruned, even if it would otherwise qualify.
