# Repository Maturity Baseline

_Repository snapshot assessed on 2026-04-02 for issue [#611](https://github.com/dannagrace/ProjectVeil/issues/611)._

This note captures the current repository maturity in one place so future issue creation can start from the current state instead of rediscovering it from several release-readiness documents.

## Current Baseline

ProjectVeil is no longer in an early scaffold stage. The repository already shows a `late Phase 1 / release-hardening` posture:

- the core Phase 1 gameplay loop is implemented across `packages/shared`, `apps/server`, and `apps/cocos-client`
- the H5 shell remains available as a debug and regression surface rather than the shipping runtime
- release-readiness, release-health, sync-governance, persistence, and WeChat/Cocos evidence tooling already exist as first-class scripts and docs
- contributor onboarding and local quickstart are documented in `README.md`, with verification expectations further bounded by `docs/verification-matrix.md`

The maturity picture is therefore not "can this repo support Phase 1 work at all?" but "which operational gaps still prevent the repo from feeling routine and low-friction to ship from?"

## Assessment Summary

| Area | Maturity call | Why this is the current baseline | Primary gap still open |
| --- | --- | --- | --- |
| Gameplay implementation | `Established` | Shared gameplay rules, server authority, battle settlement, and primary Cocos runtime are already documented and present in code. | Remaining risk is not missing core systems, but keeping release evidence aligned with the same candidate revision. |
| Verification and gate automation | `Strong` | The repo has targeted test, smoke, typecheck, release snapshot, dashboard, health summary, and sync-governance entry points in `package.json`. | The verification surface is wide, so contributors still need help selecting the minimum correct evidence set for a given change or release question. |
| Release operations | `Partial but structured` | Readiness dashboards, gate summaries, WeChat packaging flows, runtime observability review, and RC evidence templates already exist. | Manual checks and artifact freshness still have to be coordinated across several docs and artifact families. |
| Contributor discoverability | `Partial` | `README.md` and multiple docs contain strong detail. | Repo maturity, remaining ops gaps, and next issue-sized follow-ups were not previously captured in one short maintainer-facing document. |

## Highest-Value Operational Gaps

1. `The maturity story is fragmented across multiple release docs.`
Maintainers can prove readiness, but the path to that proof is spread across scorecards, dashboards, sign-off checklists, and artifact templates.

2. `Manual evidence is structured, but still not easy to audit as one checklist.`
The repo already tracks runtime health, WeChat release validation, reconnect soak, persistence evidence, and Cocos RC bundles, yet contributors still need to manually stitch them into one same-revision release call.

3. `Issue seeding lags behind the actual maturity picture.`
There are enough docs to identify follow-up work, but not one repo-level artifact that turns those findings into small, low-dependency backlog slices.

4. `Contributor routing is better for verification than for ownership.`
`docs/verification-matrix.md` helps choose commands, but the repo still benefits from a clearer list of independent operational improvements that can be picked up without extra discovery.

## Next Independent Follow-Up Slices

These slices are intentionally small and low-dependency so they can become follow-up issues directly.

| Slice | Why it matters | Suggested artifact or endpoint |
| --- | --- | --- |
| Add one maintainer runbook for same-revision release evidence assembly | Reduces drift between readiness snapshot, dashboard, RC bundle, runtime review, and WeChat smoke artifacts. | New doc that sequences `release:readiness:snapshot`, `release:readiness:dashboard`, `release:cocos-rc:bundle`, `smoke:wechat-release`, and runtime observability review into one candidate checklist. |
| Add a single backlog ledger for manual-release evidence owners | Makes pending manual checks visible without opening several templates or JSON examples. | Markdown tracker or JSON schema that records owner, revision, timestamp, and follow-up for runtime, WeChat, and presentation sign-off evidence. |
| Document the minimum verification sets for common issue types | Helps contributors choose the smallest sufficient validation path before opening PRs. | Expand `docs/verification-matrix.md` or add a companion quick-reference for docs-only, runtime, release-tooling, and Cocos delivery changes. |
| Add a repo map for operational entry points | Makes it faster to discover which scripts/docs correspond to release, readiness, persistence, and client delivery concerns. | Lightweight doc that groups the existing `package.json` commands and key docs by operational function. |
| Add one issue template or checklist for ops/readiness follow-ups | Keeps future maturity-gap issues consistent and immediately actionable. | `.github/ISSUE_TEMPLATE` entry or Markdown template that requires current evidence, observed gap, owner, and smallest next slice. |

## Recommended Backlog Order

1. Same-revision release evidence assembly runbook
2. Manual evidence owner ledger
3. Verification quick-reference for common issue types
4. Operational entry-point repo map
5. Ops/readiness issue template

This order keeps the first slices focused on reducing release ambiguity, then improves discoverability and issue quality once the operational path is clearer.

## Boundaries

This baseline intentionally does not redefine Phase 1 exit criteria. For that, keep `docs/phase1-maturity-scorecard.md` as the authoritative scorecard. This document exists to summarize the current repo maturity and point to the next independent operational slices that remain worthwhile.
