# Cocos Phase 1 Presentation Placeholder Sign-Off

This checklist is the canonical reviewer-facing process for the remaining Cocos presentation debt that is still allowed to exist during Phase 1 hardening. Use it to make placeholder and fallback behavior explicit before declaring a release candidate fit for Phase 1 exit.

It does not replace the broader RC snapshot, checklist, or blocker log. It narrows one specific question that already appears across the maturity scorecard and release-readiness docs:

`Which placeholder, fallback, or substituted presentation items still exist, and has each one been explicitly closed or accepted before Phase 1 exit?`

For the primary-client battle path, reviewers should treat `encounter entry -> command/impact feedback -> result settlement` as one continuous presentation surface. Evidence is incomplete if it only shows the map shell or only the final settlement shell.

## When To Use This

Use this checklist whenever a candidate is being reviewed for:

- Phase 1 exit readiness
- Cocos primary-client release sign-off
- WeChat release-candidate review

For the same candidate revision, keep this checklist next to the existing RC evidence bundle:

- [`docs/cocos-primary-client-delivery.md`](./cocos-primary-client-delivery.md)
- [`docs/cocos-release-evidence-template.md`](./cocos-release-evidence-template.md)
- [`docs/release-evidence/cocos-wechat-rc-checklist.template.md`](./release-evidence/cocos-wechat-rc-checklist.template.md)
- [`docs/release-evidence/cocos-wechat-rc-blockers.template.md`](./release-evidence/cocos-wechat-rc-blockers.template.md)
- [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md)

Generate the candidate-scoped artifact with:

```bash
npm run release:cocos-rc:bundle -- --candidate <candidate-name> --build-surface <surface>
```

That command now emits:

- `artifacts/release-readiness/cocos-presentation-signoff-<candidate>-<short-sha>.json`
- `artifacts/release-readiness/cocos-presentation-signoff-<candidate>-<short-sha>.md`

Those files are the attachable per-candidate sign-off record. This doc defines how to review and, if needed, edit the generated checklist before the candidate is widened beyond controlled internal testing.

When the sign-off conclusion changes, mirror the same owner, revision, timestamp, artifact path, and follow-up summary into the manual evidence owner ledger. The ledger should show whether `cocos-presentation-signoff` is still pending or stale without reopening the full artifact.

## Sign-Off Rules

- Every known placeholder, fallback, or substitution item must have one row in the candidate artifact checklist below.
- `Status` must be one of `pass`, `waived-controlled-test`, or `fail`.
- `waived-controlled-test` means the candidate may be used only for controlled internal testing. It requires an owner, explicit rationale, and a linked follow-up issue or blocker record.
- `fail` means the candidate is not presentation-ready for wider external evaluation.
- Phase 1 exit is not signed off until no row remains ambiguous or undocumented.
- If `cocos-presentation-readiness` or RC evidence reports a new substitution, add it to the candidate artifact rather than burying it in free-form notes.

## Blocking Vs Controlled-Test Gaps

Treat a presentation item as `fail` when any of the following is true:

- it makes the first-session journey look materially incomplete for wider external review
- it is already reported as blocking by `cocos-presentation-readiness`
- it hides release-required evidence such as room identity, reconnect state, or battle result

Treat a presentation item as `waived-controlled-test` only when all of the following are true:

- the candidate is still functionally passed by the RC snapshot / main journey evidence
- the gap is acceptable for controlled internal testing only
- the artifact names an owner, rationale, and follow-up slice
- the same gap is not being silently widened to broader external review

## Candidate Header

The generated candidate artifact already fills this header. Review and correct it before sign-off:

- Candidate: `rc-YYYY-MM-DD`
- Commit: `<git-sha>`
- Surface: `creator_preview | wechat_preview | wechat_upload_candidate`
- Owner: `<name>`
- Review date: `<YYYY-MM-DD>`
- Linked RC snapshot:
- Linked blocker log:

## Canonical Checklist

| Area | Example debt to review | Evidence source | Status | Owner | Resolution or acceptance rationale | Follow-up / blocker link |
| --- | --- | --- | --- | --- | --- | --- |
| Pixel art / scene visuals | Placeholder tiles, sprites, portraits, icons, temporary VFX, mismatched atlas content | `cocos-presentation-readiness`, RC screenshots/video, Creator preview, WeChat smoke | `pass | waived-controlled-test | fail` | `<name>` | What was fixed, or why only controlled internal testing is acceptable | Issue / blocker / artifact |
| Audio | Mixed packs, missing cues, temporary BGM/SFX, abrupt silence or fallback clips | RC video, device smoke notes, audio audit notes | `pass | waived-controlled-test | fail` | `<name>` | What remains, player impact, and why it is or is not acceptable | Issue / blocker / artifact |
| Animation / transitions | Fallback transition modes, missing hit reactions, temporary motion states, abrupt battle entry/exit | RC video, diagnostics markdown, reviewer notes | `pass | waived-controlled-test | fail` | `<name>` | What behavior is still fallback and whether it affects the production-intent journey | Issue / blocker / artifact |
| HUD / copy / readability | Temporary labels, unclear badges, weak state messaging, unresolved placeholder strings, ambiguous battle win/loss settlement copy | RC screenshots, Cocos journey evidence, manual review notes | `pass | waived-controlled-test | fail` | `<name>` | Why the current wording is acceptable or what must change before sign-off | Issue / blocker / artifact |
| Asset substitutions from automation | Any remaining substitution already reported by validation or presentation-readiness output | Validation artifact, release bundle summary, CI artifact | `pass | waived-controlled-test | fail` | `<name>` | Explicitly acknowledge each reported substitution instead of assuming it is understood | Issue / blocker / artifact |

## Reviewer Decision

- Functional evidence status: `passed | partial | blocked | failed`
- Phase 1 presentation sign-off: `approved | approved-for-controlled-test | hold`
- Summary:
- Blocking items, if any:
- Controlled-test gaps, if any:

## Battle Journey Manual Verification

Use this short path when reviewing the battle presentation slice for a candidate:

1. Start from the same candidate revision used for the RC snapshot and launch the main Cocos client flow.
2. Enter one encounter from the world map and capture the battle-entry overlay showing terrain/context plus encounter identity.
3. Execute at least one command that produces visible impact feedback, then capture the battle panel while the command/impact labels and badges are on screen.
4. Finish the encounter and capture the settlement shell twice if possible:
   first on the pending handoff state (`结果回写中` or `PVP 结果回写中`), then on the final victory/defeat result once the authoritative event arrives.
5. Confirm the settlement copy makes the world handoff explicit without looking at logs:
   `等待世界地图确认奖励、占位与结算结果` for PVE, or `等待房间确认胜负并回写 PVP 世界态` for PVP.
6. Attach the screenshots/video to the candidate RC bundle and classify any remaining placeholder or fallback item in the generated sign-off artifact.

## Exit Standard

For Phase 1 exit, this checklist should end in one of two states:

1. All rows are `pass`.
2. Some rows are `waived-controlled-test`, but each one has explicit owner, rationale, and linked follow-up, and none of them undermines the canonical journey `Lobby -> world -> battle -> settlement -> reconnect`.

If a reviewer cannot tell which remaining fallback items are intentional, Phase 1 exit is not yet signed off.
