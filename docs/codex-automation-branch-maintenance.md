# Codex Automation Branch Maintenance

`npm run ops:codex-branches` audits stale `codex/issue-*` automation branches in this repo without touching unrelated worktrees or files. The command inspects both local refs and `origin/codex/issue-*` refs, then combines Git state with current open-PR state from `gh` for the same repository.

## Audit Usage

```bash
npm run ops:codex-branches -- list
npm run ops:codex-branches -- list --format json
```

Each branch row includes:

- age in days since the latest commit
- upstream tracking status for local branches
- whether the branch tip is already merged into `main`
- whether an open PR still exists for that branch name
- a classification of `active`, `safe-to-delete`, or `manual-review`

## Retention Policy

- Active branches: keep any branch with an open PR, the currently checked-out branch, or unmerged work updated within the last 30 days.
- Merged branches: keep merged branches for 7 days after their latest commit so recent automation work remains visible while PR review and post-merge checks settle.
- Abandoned branches: treat unmerged branches older than 30 days and branches whose tracked upstream is already gone as manual-review candidates. They are stale enough to investigate, but not safe for automatic deletion.

Only one class is auto-prunable:

- Safe-to-delete: merged into `main`, no open PR, older than the 7-day merged retention window, and not the currently checked-out branch.

## Guarded Cleanup

`prune` is dry-run by default and only targets `safe-to-delete` rows.

```bash
npm run ops:codex-branches -- prune
npm run ops:codex-branches -- prune --apply
npm run ops:codex-branches -- prune --apply --delete-remote
```

Cleanup safeguards:

- No deletion happens unless `--apply` is present.
- Remote branch deletion is disabled unless `--delete-remote` is present.
- Branches with open PRs are never pruned.
- Unmerged stale branches stay in `manual-review`; the tool does not auto-delete them.
- The currently checked-out branch is never pruned, even if it would otherwise qualify.
