# Cocos / WeChat Release-Surface Checklist

Issue `#983` requires this checklist to be filled for the current reviewed RC candidate revision.

## Candidate

- Candidate: `issue-983-presentation`
- Surface: `creator_preview`
- Commit: `742bfcaeb2f57148aa4733f5b686f1dec560411a`
- Owner: `codex`
- Recorded at: `2026-04-07T09:35:00Z`
- Freshness window: `24h for manual/runtime evidence unless a stricter gate says otherwise`
- Device / Client: `Cocos Creator preview evidence set`
- Server / Environment: `repo artifact review`
- Release summary: `artifacts/release-readiness/cocos-rc-evidence-bundle-issue-983-presentation-742bfca.json`
- Related owner ledger: `artifacts/release-readiness/manual-release-evidence-owner-ledger-issue-983-presentation-742bfca.md`

## Release-Surface Contract

- [x] 当前 release decision 明确绑定 `creator_preview`，没有把其他 surface 结果误当成当前放行证据
  Evidence: `artifacts/release-readiness/cocos-rc-evidence-bundle-issue-983-presentation-742bfca.json`
  Notes: The filled checklist is scoped to the current reviewed Cocos creator-preview candidate.
- [x] 所有 presentation evidence 都绑定到同一 reviewed `Commit`
  Evidence: `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md`
  Notes: The RC checklist, blocker register, owner ledger, and presentation sign-off all reference `742bfca`.
- [x] blocker / waiver 已同步写入 sign-off、blocker register、owner ledger
  Evidence: `artifacts/release-readiness/cocos-rc-blockers-issue-983-presentation-742bfca.md`
  Notes: Pixel art and animation are blockers; mixed audio is an accepted controlled-test waiver.

## Linked Evidence

- [x] Candidate-scoped Cocos bundle manifest is attached:
  `artifacts/release-readiness/cocos-rc-evidence-bundle-issue-983-presentation-742bfca.json`
- [x] Completed presentation sign-off is attached:
  `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md`
- [x] Fallback asset inventory is captured in the sign-off JSON:
  `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.json`
- [x] Blocker register is attached:
  `artifacts/release-readiness/cocos-rc-blockers-issue-983-presentation-742bfca.md`
- [x] Manual evidence owner ledger mirrors the checklist state:
  `artifacts/release-readiness/manual-release-evidence-owner-ledger-issue-983-presentation-742bfca.md`

## Presentation Checklist Completion

- [x] Placeholder pixel art received an explicit decision: `BLOCK`
  Evidence: `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md`
- [x] Mixed audio packs received an explicit decision: `ACCEPT`
  Evidence: `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md`
- [x] Animation fallback delivery modes received an explicit decision: `BLOCK`
  Evidence: `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md`
- [x] Fallback inventory lists each item with owner, status, and target resolution phase
  Evidence: `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md`
- [x] Reviewer name and date are recorded on the completed sign-off artifact
  Evidence: `artifacts/release-readiness/cocos-presentation-signoff-issue-983-presentation-742bfca.md`

## Release Decision

- Decision: `hold`
- Summary: The checklist is complete and the remaining presentation debt is now explicit. The candidate remains on hold for Phase 1 exit because placeholder pixel art and animation fallback delivery are still blockers, while mixed audio is accepted only for controlled internal testing.
- Remaining blockers doc: `artifacts/release-readiness/cocos-rc-blockers-issue-983-presentation-742bfca.md`
- Follow-ups / owners: `client-lead` closes placeholder art and animation fallback; `audio-lead` tracks mixed cue replacement.
