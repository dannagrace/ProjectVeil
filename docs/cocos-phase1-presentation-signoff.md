# Cocos Phase 1 Presentation Placeholder Sign-Off

This checklist is the canonical reviewer-facing record for the remaining Cocos presentation debt that is still allowed to exist during Phase 1 hardening. Use it to make placeholder and fallback behavior explicit before declaring a release candidate fit for Phase 1 exit.

It does not replace the broader RC snapshot, checklist, or blocker log. It narrows one specific question that already appears across the maturity scorecard and release-readiness docs:

`Which placeholder, fallback, or substituted presentation items still exist, and has each one been explicitly closed or accepted before Phase 1 exit?`

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

## Sign-Off Rules

- Every known placeholder, fallback, or substitution item must have one row in the checklist below.
- `Status` must be one of `closed`, `accepted-non-blocking`, or `blocking`.
- `accepted-non-blocking` requires an owner, explicit rationale, and a linked follow-up issue or blocker record.
- Phase 1 exit is not signed off until no row remains ambiguous or undocumented.
- If `cocos-presentation-readiness` or RC evidence reports a new substitution, add it here rather than burying it in free-form notes.

## Candidate Header

Copy this section into the active candidate record and fill it before review:

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
| Pixel art / scene visuals | Placeholder tiles, sprites, portraits, icons, temporary VFX, mismatched atlas content | `cocos-presentation-readiness`, RC screenshots/video, Creator preview, WeChat smoke | `closed | accepted-non-blocking | blocking` | `<name>` | What was fixed, or why Phase 1 can ship with this exact gap | Issue / blocker / artifact |
| Audio | Mixed packs, missing cues, temporary BGM/SFX, abrupt silence or fallback clips | RC video, device smoke notes, audio audit notes | `closed | accepted-non-blocking | blocking` | `<name>` | What remains, player impact, and why it is or is not acceptable | Issue / blocker / artifact |
| Animation / transitions | Fallback transition modes, missing hit reactions, temporary motion states, abrupt battle entry/exit | RC video, diagnostics markdown, reviewer notes | `closed | accepted-non-blocking | blocking` | `<name>` | What behavior is still fallback and whether it affects the production-intent journey | Issue / blocker / artifact |
| HUD / copy / readability | Temporary labels, unclear badges, weak state messaging, unresolved placeholder strings | RC screenshots, Cocos journey evidence, manual review notes | `closed | accepted-non-blocking | blocking` | `<name>` | Why the current wording is acceptable or what must change before sign-off | Issue / blocker / artifact |
| Asset substitutions from automation | Any remaining substitution already reported by validation or presentation-readiness output | Validation artifact, release bundle summary, CI artifact | `closed | accepted-non-blocking | blocking` | `<name>` | Explicitly acknowledge each reported substitution instead of assuming it is understood | Issue / blocker / artifact |

## Reviewer Decision

- Phase 1 presentation sign-off: `approved | hold`
- Summary:
- Blocking items, if any:
- Accepted non-blocking items, if any:

## Exit Standard

For Phase 1 exit, this checklist should end in one of two states:

1. All rows are `closed`.
2. Some rows are `accepted-non-blocking`, but each one has explicit owner, rationale, and linked follow-up, and none of them undermines the canonical journey `Lobby -> world -> battle -> settlement -> reconnect`.

If a reviewer cannot tell which remaining fallback items are intentional, Phase 1 exit is not yet signed off.
