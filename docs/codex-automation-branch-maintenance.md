# Codex Branch And Worktree Hygiene Runbook

This runbook is for maintainers auditing and pruning stale `codex/issue-*` branches and attached worktrees in `dannagrace/ProjectVeil`.

`npm run ops:branch-hygiene -- list` is the single entry point. It inspects local refs, `origin/codex/issue-*` refs, and attached Git worktrees in the current repository, then combines Git state with current PR state from `gh`.

The report is machine-readable in JSON mode and safe by default:

- it distinguishes `merged`, `open-pr`, `draft-pr`, and `orphaned` branch hygiene states
- cleanup is dry-run by default
- cleanup refuses to remove anything with an open or draft PR
- cleanup refuses to remove a local branch when its attached worktree has uncommitted changes
- cleanup removes clean attached worktrees before deleting the corresponding merged local branch

## Operator Workflow

Start with a read-only audit:

```bash
npm run ops:branch-hygiene -- list
```

Write a machine-readable report for maintainers or automation:

```bash
npm run ops:branch-hygiene -- list --format json > artifacts/branch-hygiene-report.json
```

Preview cleanup candidates only:

```bash
npm run ops:branch-hygiene -- prune
```

Apply local cleanup for already-merged branches and clean attached worktrees:

```bash
npm run ops:branch-hygiene -- prune --apply
```

Delete merged remote refs too, but only when you explicitly intend to remove `origin/*` branches:

```bash
npm run ops:branch-hygiene -- prune --apply --delete-remote
```

The legacy alias `npm run ops:codex-branches -- ...` still works, but `ops:branch-hygiene` is the canonical command.

## Reading The Report

Each branch entry includes:

- `hygieneState`: `merged`, `open-pr`, `draft-pr`, `orphaned`, `stale`, or `active`
- `classification`: whether the branch is retained, requires manual review, or is safe to delete
- `pullRequestState`: `none`, `open-pr`, or `draft-pr`
- `worktrees`: attached worktree metadata, including `dirty`, `prunable`, and `isCurrent`

The JSON payload also includes a top-level `worktrees` section so maintainers can inspect worktree hygiene directly.

## Guardrails

Confirm all of the following before any applied cleanup:

- you are in the intended `ProjectVeil` repository
- `git fetch --prune origin` has been run recently
- `gh auth status` succeeds for an account that can read PR state for the repo
- you have reviewed the dry-run output from the same repository state you plan to prune

Script-enforced guardrails:

- no deletion happens unless `--apply` is present
- remote branch deletion is disabled unless `--delete-remote` is present
- branches with an open PR or draft PR are never removed
- local branches with dirty attached worktrees are never removed
- the currently checked-out branch or current worktree is never auto-pruned
- orphaned and stale unmerged branches stay in manual review
- only one hygiene run can operate in a repository worktree at a time

## Post-Run Verification

After any applied prune:

- rerun `npm run ops:branch-hygiene -- list`
- confirm expected open and draft PR branches still appear in the report
- confirm any deleted local worktree paths are gone
- if you removed remote refs, verify GitHub no longer shows those merged heads as active branches
