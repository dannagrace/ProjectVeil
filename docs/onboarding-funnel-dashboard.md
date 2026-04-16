# Onboarding Funnel Dashboard

`npm run analytics:onboarding:funnel` turns onboarding analytics envelopes plus optional diagnostics evidence into a stable JSON artifact and a PM-friendly Markdown summary.

The report is intentionally pragmatic:

- it reuses the current `session_start` and `tutorial_step` analytics events
- it does not require a separate database or admin UI before the team can inspect onboarding health
- it accepts optional diagnostics files so explicit abandonment reasons show up when the evidence exists

## Canonical Funnel

The report keeps the shared onboarding stage contract from [`packages/shared/src/onboarding-funnel.ts`](../packages/shared/src/onboarding-funnel.ts) and merges in the post-tutorial focus stages used for V0.6 closeout:

- `onboarding_session_started`
- `tutorial_step_1_seen`
- `tutorial_step_2_seen`
- `tutorial_step_3_seen`
- `onboarding_completed`
- `first_campaign_mission_started`
- `first_battle_settled`
- `first_reward_claimed`

Stage semantics:

- `onboarding_session_started`
  A new-player session entered the onboarding evidence set.
- `tutorial_step_1_seen`
  The player reached the first onboarding prompt. Today this is usually inferred from the onboarding session start because the live telemetry emits step transitions after step 1.
- `tutorial_step_2_seen`
  The player advanced to the second guided step.
- `tutorial_step_3_seen`
  The player advanced to the final guided step before completion.
- `onboarding_completed`
  The player finished onboarding and unlocked normal progression.
- `first_campaign_mission_started`
  The player was handed into the first campaign mission after tutorial completion.
- `first_battle_settled`
  The first chapter battle resolved and the settlement state became visible.
- `first_reward_claimed`
  The first post-battle reward was claimed and visible to review.

## Usage

Generate a report from one or more analytics envelope files:

```bash
npm run analytics:onboarding:funnel -- \
  --input artifacts/analytics/onboarding-events.json \
  --output artifacts/analytics/onboarding-funnel-report.json \
  --markdown-output artifacts/analytics/onboarding-funnel-report.md
```

Include diagnostics when you want explicit failure reasons in the artifact:

```bash
npm run analytics:onboarding:funnel -- \
  --input artifacts/analytics/onboarding-events.json \
  --diagnostics artifacts/analytics/onboarding-diagnostics.json
```

The CLI also accepts directories for `--input` and `--diagnostics`; it will recurse through `*.json` files.

For a deterministic local or CI smoke run, reuse the checked-in fixtures:

```bash
npm run analytics:onboarding:funnel -- \
  --input scripts/test/fixtures/onboarding-funnel-events.json \
  --diagnostics scripts/test/fixtures/onboarding-funnel-diagnostics.json
```

## Artifact Shape

The JSON report includes:

- `summary`
  entrant count, full-chain completion count, completion rate, and median time from onboarding start to first reward claim
- `pmSummary`
  a PM-facing narrative plus the post-tutorial focus chain with reach and drop-off counts
- `canonicalStages`
  the stable stage contract with success criteria and evidence notes
- `stageReports`
  per-stage reach counts and drop-off counts/rates across both the shared and supplemental funnel stages
- `topFailureReasons`
  the most common explicit failure reasons when the source evidence contains them
- `regressions`
  threshold-based flags for quick triage
- `observability`
  how many entrants had explicit failure evidence versus silent abandonment

The Markdown artifact mirrors the same data in a short review format.

## How To Read It

Start in this order:

1. Completion rate
2. Median completion time
3. The PM summary focus chain
4. The first stage with a large drop-off count
5. Top failure reasons if present

Pragmatic default thresholds are built into the script and emitted into the artifact:

- completion rate below `70%`
- median completion time above `300s`
- any stage drop-off rate above `35%`

Treat these as regression flags, not hard product truth. Tighten them once a healthier branch baseline exists.

## Evidence Limitations

- If the evidence only contains tutorial-step events, the report infers `tutorial_step_1_seen` from the onboarding session start.
- The report accepts explicit `stageId` markers in fixtures for the post-tutorial focus chain, which is how we keep the dashboard deterministic while the shared telemetry contract is still expanding.
- If no diagnostics or failure-coded events are supplied, abandonment still appears in stage drop-off counts but the failure reason section will stay empty.
- The current report is player-level and de-duplicates by `playerId`. It is designed for onboarding health snapshots, not retry-cohort analysis.
