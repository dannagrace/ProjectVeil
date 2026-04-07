# Cocos / WeChat Release-Surface Blockers

## Candidate

- Candidate: `issue-983-presentation`
- Surface: `creator_preview`
- Commit: `742bfcaeb2f57148aa4733f5b686f1dec560411a`
- Owner: `codex`
- Last updated: `2026-04-07T09:36:00Z`
- Release decision: `hold`
- Release summary: `artifacts/release-readiness/cocos-rc-evidence-bundle-issue-983-presentation-742bfca.json`

## Current Blockers

| ID | Severity | Area | Summary | Evidence | Owner | Exit criteria | Next update | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `presentation-placeholder-art` | `P0` | `presentation` | Placeholder pixel art is still mixed into the reviewed RC candidate, so the candidate is not ready for broader external evaluation. | `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md` | `client-lead` | `cocos-presentation-readiness` no longer reports placeholder terrain / hero / unit / building art for the reviewed candidate. | `Next art refresh` | `open` |
| `presentation-animation-fallback` | `P0` | `presentation` | Animation delivery remains fallback-only for shipped profiles, so motion delivery is still non-final on the main client path. | `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md` | `client-lead` | Shipped battle-path profiles move off `deliveryMode: fallback` and the sign-off is updated to `CLOSE`. | `Next animation profile update` | `open` |
| `presentation-audio-mix` | `P1` | `presentation` | Mixed audio packs are accepted for controlled internal testing only and must stay called out as debt until cues are unified. | `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md` | `audio-lead` | Replace the remaining placeholder/synth cues or explicitly renew the controlled-test acceptance on the next candidate review. | `Next audio asset review` | `mitigated` |

## Release Owner Notes

- Hold Phase 1 exit while the two `P0` presentation blockers remain open.
- Do not widen the candidate beyond controlled internal testing while `presentation-audio-mix` remains a waiver.
