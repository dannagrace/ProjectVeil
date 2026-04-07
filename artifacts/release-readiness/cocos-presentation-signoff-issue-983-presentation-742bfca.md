# Cocos Presentation Sign-Off

This candidate-scoped artifact records the explicit fallback decisions required for issue `#983`.

## Candidate Header

- Candidate: `issue-983-presentation`
- Commit: `742bfcaeb2f57148aa4733f5b686f1dec560411a`
- Surface: `creator_preview`
- Owner: `codex`
- Review date: `2026-04-07`
- Linked RC snapshot: `artifacts/release-readiness/cocos-rc-snapshot-issue-696-proof-a12008a.json`
- Linked blocker log: `artifacts/release-readiness/cocos-rc-blockers-issue-983-presentation-742bfca.md`
- Canonical process doc: `docs/cocos-phase1-presentation-signoff.md`

## Explicit Fallback Decisions

| Item | Decision | Status | Owner | Target resolution phase | Rationale | Evidence | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Placeholder pixel art mixed with formal assets | `BLOCK` | `fail` | `client-lead` | `Before Phase 1 exit` | `cocos-presentation-readiness` still reports placeholder terrain, hero, unit, and building art, so the candidate is not presentation-ready for broader external review. | `artifacts/release-readiness/cocos-presentation-signoff-issue-696-proof-a12008a.json` | `artifacts/release-readiness/cocos-rc-blockers-issue-983-presentation-742bfca.md#current-blockers` |
| Mixed audio packs | `ACCEPT` | `waived-controlled-test` | `audio-lead` | `Phase 1 controlled-test follow-up` | Production `victory` / `defeat` cues already exist and the remaining mixed cues do not hide room, battle, settlement, or reconnect evidence. The debt is acceptable only for controlled internal review. | `docs/cocos-phase1-presentation-signoff.md` | `#983` |
| Animation fallback delivery modes | `BLOCK` | `fail` | `client-lead` | `Before Phase 1 exit` | `hero_guard_basic` and `wolf_pack` still rely on `deliveryMode: fallback`, so the candidate still carries non-final motion delivery on the primary-client battle path. | `docs/cocos-phase1-presentation-signoff.md` | `artifacts/release-readiness/cocos-rc-blockers-issue-983-presentation-742bfca.md#current-blockers` |

## Fallback Asset Inventory

| Item | Current surface | Owner | Status | Target resolution phase | Notes |
| --- | --- | --- | --- | --- | --- |
| Placeholder pixel art | World map terrain, heroes, units, buildings, and battle-adjacent preview art | `client-lead` | `open-blocker` | `Before Phase 1 exit` | Keep the item visible in the RC checklist and blocker register until `cocos-presentation-readiness` no longer reports placeholder art. |
| Mixed audio packs | Explore/battle BGM plus `attack`, `skill`, `hit`, and `level_up` cues | `audio-lead` | `accepted-controlled-test-debt` | `Phase 1 controlled-test follow-up` | Acceptance is limited to controlled internal testing and must stay mirrored in the checklist and owner ledger. |
| Animation fallback delivery modes | `hero_guard_basic`, `wolf_pack`, and any other shipped `deliveryMode: fallback` profile | `client-lead` | `open-blocker` | `Before Phase 1 exit` | Keep each fallback template conversion tied to a named follow-up before widening external review. |

## Reviewer Decision

- Functional evidence status: `passed`
- Phase 1 presentation sign-off: `hold`
- Summary: Presentation sign-off remains on hold for candidate `issue-983-presentation` because placeholder pixel art and animation fallback delivery both remain explicit Phase 1 blockers. Mixed audio packs are accepted only for controlled internal testing with owner-tracked follow-up.
- Blocking items, if any: Placeholder pixel art, Animation fallback delivery modes.
- Controlled-test gaps, if any: Mixed audio packs.

## Review Sign-Off

- Reviewer: `codex`
- Recorded at: `2026-04-07T09:30:00Z`
- Attach this markdown plus `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.json` with the RC checklist, blocker log, and Phase 1 exit audit.
