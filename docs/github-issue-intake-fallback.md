# GitHub Issue Intake Fallback Runbook

Use this runbook when the normal Claude-led issue creation or routing flow is unavailable or degraded, but issue intake still needs to continue in `dannagrace/ProjectVeil`.

For outage drills or live verification, use the companion checklist in [GitHub Issue Intake Fallback Smoke Checklist](./github-issue-intake-fallback-smoke-checklist.md).

The fallback path is intentionally simple:

- GPT creates the GitHub issue directly with `gh issue create`
- the issue body follows the repo's `ProjectVeil Ops Intake` template
- the issue explicitly records that Claude was unavailable so the fallback is auditable later

## When To Use It

Use this runbook when any of the following is true:

- Claude cannot create or route the issue
- Claude is degraded enough that issue intake is blocked
- the team needs to continue issue intake immediately and GPT is available

Do not wait for Claude recovery if the work is otherwise ready to be captured as a GitHub issue.

## Required Intake Fields

Every fallback-created issue must preserve the same minimum metadata:

- `Summary`: one or two sentences stating the request or defect
- `Problem`: the current blocker, gap, or failure mode
- `Proposed change`: the smallest credible change set to resolve the problem
- `Acceptance criteria`: concrete checks that define done
- `Context`: trigger source, affected area, environment or branch, and links/evidence when available
- `Fallback / operator notes`: whether Claude was unavailable and whether GPT created the issue directly

If any field is unknown, write `unknown` rather than omitting it.

## GPT Fallback Workflow

1. Confirm the repository and auth context:

```bash
git remote get-url origin
gh auth status
```

2. Start from the repo template so the body structure stays consistent:

```bash
gh issue create --template "ProjectVeil Ops Intake"
```

3. If GPT is creating the issue non-interactively, provide the title and body directly with the same headings as the template:

```bash
gh issue create \
  --title "ops: <short issue title>" \
  --body "$(cat <<'EOF'
## Summary
<one or two sentence summary>

## Problem
<what is blocked, broken, or missing>

## Proposed change
- <smallest credible change>

## Acceptance criteria
- <observable done condition>

## Context
- Trigger or request source: <source>
- Affected area: <area>
- Environment or branch: <branch or environment>
- Evidence or links: <links or unknown>

## Fallback / operator notes
- Claude availability: unavailable | degraded | unknown
- Created by: GPT direct fallback via gh
EOF
)"
```

4. Verify the posted issue still contains all required headings before treating intake as complete.

## Smoke Verification Checklist

When the team needs to prove the fallback path still works end to end, run [GitHub Issue Intake Fallback Smoke Checklist](./github-issue-intake-fallback-smoke-checklist.md). The checklist is intentionally small and focuses on three things:

- issue creation succeeds without Claude
- the resulting issue preserves the required metadata quality bar
- follow-up routing is explicit for drills and real outages

## Quality Bar

The fallback issue should be as actionable as the primary Claude path:

- title is specific enough to triage without opening the full thread
- acceptance criteria are testable
- evidence links are attached when they exist
- the fallback note makes it clear why GPT created the issue directly

## Recovery Back To The Primary Path

When Claude is healthy again, no issue rewrite is required. Continue using the primary flow for new intake, and only edit a fallback-created issue if important context was missing at creation time.
