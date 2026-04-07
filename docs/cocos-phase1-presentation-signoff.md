# Cocos Phase 1 Presentation Placeholder Sign-Off

This checklist is the canonical reviewer-facing process for the remaining Cocos presentation debt that is still allowed to exist during Phase 1 hardening. Use it to make placeholder and fallback behavior explicit before declaring a release candidate fit for Phase 1 exit.

It does not replace the broader RC snapshot, checklist, or blocker log. It narrows one specific question that already appears across the maturity scorecard and release-readiness docs:

`Which placeholder, fallback, or substituted presentation items still exist, and has each one been explicitly closed or accepted before Phase 1 exit?`

For the primary-client battle path, reviewers should treat `encounter entry -> command/impact feedback -> result settlement` as one continuous presentation surface. Evidence is incomplete if it only shows the map shell or only the final settlement shell.

The maintained baseline for current in-repo debt lives in the inventory below. Candidate-scoped `cocos-presentation-signoff-<candidate>-<short-sha>.json/.md` artifacts should start from this baseline, then tighten each row to the exact status for that candidate instead of inventing a fresh checklist each time.

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

When the sign-off conclusion changes, mirror the same owner, revision, timestamp, artifact path, and follow-up summary into the manual evidence owner ledger. The ledger should show whether `cocos-presentation-signoff` is still pending or stale without reopening the full artifact. Start from the maintained inventory in this doc, then record any candidate-specific deviation or closure in the generated artifact and ledger.

## Sign-Off Rules

- Every known placeholder, fallback, or substitution item must have one row in the candidate artifact checklist below.
- `Status` must be one of `pass`, `waived-controlled-test`, or `fail`.
- Every candidate artifact row should also record an explicit disposition of `CLOSE`, `ACCEPT`, or `BLOCK` so reviewers can tell whether the item was resolved, consciously accepted, or remains a release blocker.
- `waived-controlled-test` means the candidate may be used only for controlled internal testing. It requires an owner, explicit rationale, and a linked follow-up issue or blocker record.
- `fail` means the candidate is not presentation-ready for wider external evaluation.
- Phase 1 exit is not signed off until no row remains ambiguous or undocumented.
- If `cocos-presentation-readiness` or RC evidence reports a new substitution, add it to the candidate artifact rather than burying it in free-form notes.

## Maintained Phase 1 Fallback Inventory

This table is the single maintained inventory of Cocos presentation fallbacks still allowed during Phase 1 hardening. The current repo-backed baseline remains:

- `cocos-presentation-readiness`: `像素 占位`, `音频 混合 2/8`, `动画 回退 2/2`
- `cocos-presentation-readiness`: `战斗流程 正式 4/4`，表示 battle journey 的 `进场 / 指令 / 受击 / 结算` 已在状态/copy 层正式化，剩余 debt 继续按资产 fallback 管理
- `configs/cocos-presentation.json`: `explore` / `battle` music plus `attack` / `skill` / `hit` / `level_up` cues are still `placeholder`, while `hero_guard_basic` and `wolf_pack` still ship as `deliveryMode: fallback`

Unless a candidate-specific artifact proves otherwise, treat every row below as `waived-controlled-test`.

| Surface | Current allowed fallback item | Current status | Default decision | Owner | Target resolution phase | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| Battle entry / transition | `VeilBattleTransition` still uses the lightweight overlay shell with retained placeholder terrain preview assets instead of final authored transition art/motion. Keep encounter identity, terrain/context, and chips visible in RC capture. | `waived-controlled-test` | `ACCEPT` | `client-lead` | `Phase 1 controlled-test only` | Refresh the battle-entry capture in the candidate sign-off artifact and replace the overlay chrome/terrain preview when production transition art is ready. |
| Impact / resolution feedback | Battle command, hit, skill, and resolution beats are copy-first badge/label feedback from `cocos-battle-feedback` and diagnostics, not a final authored VFX-heavy impact pass. | `waived-controlled-test` | `ACCEPT` | `client-lead` | `Phase 1 controlled-test only` | Keep one command/impact capture in the candidate bundle and upgrade the impact pass only when it can preserve the same readable command/result summary. |
| Settlement shell / authoritative handoff | The pending handoff shell (`结果回写中` / `PVP 结果回写中`) is intentionally kept as a neutral fallback state while authority resolves the final result; it is acceptable only if the same review also captures the final victory/defeat settlement. | `waived-controlled-test` | `ACCEPT` | `client-lead` | `Phase 1 controlled-test only` | Keep paired pending-handoff and final-settlement evidence in the candidate artifact; do not sign off a candidate that only shows the neutral shell. |
| Placeholder art | `cocos-presentation-readiness` still reports pixel art as `placeholder`, so terrain / hero / unit / building presentation remains a controlled-test placeholder surface rather than production art. | `waived-controlled-test` | `BLOCK` | `client-lead` | `Before Phase 1 exit` | Re-run `npm run check:cocos-release-readiness`, attach the updated readiness summary, and only close this row when the readiness output is no longer placeholder. |
| Audio substitutions | Audio remains mixed: `victory` and `defeat` are production, while `explore`, `battle`, `attack`, `skill`, `hit`, and `level_up` still use placeholder asset/synth substitution paths. | `waived-controlled-test` | `ACCEPT` | `client-lead` | `Phase 1 controlled-test follow-up` | Keep device or preview notes on audible substitutions in the candidate sign-off and update `configs/cocos-presentation.json` as cues are replaced with production assets. |
| Animation fallback modes | Animation delivery is still fallback-only for `hero_guard_basic` and `wolf_pack`; no current profile ships as `clip` or `spine`. | `waived-controlled-test` | `BLOCK` | `client-lead` | `Before Phase 1 exit` | Track each template conversion in the candidate sign-off and only close this row after the config moves the shipped profiles off `deliveryMode: fallback`. |

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
