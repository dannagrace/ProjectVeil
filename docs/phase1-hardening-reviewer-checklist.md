# Phase 1 Hardening Reviewer Checklist

Use this when a reviewer needs one concise end-to-end checklist for the remaining Phase 1 hardening gaps without re-reading every release doc. This page does not replace the existing gates. It points each remaining gap at the command, artifact, issue, or manual sign-off that closes it.

For the detailed release assembly order, keep [`docs/same-revision-release-evidence-runbook.md`](./same-revision-release-evidence-runbook.md) as the operator runbook. For the explicit eight Phase 1 exit criteria, keep [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md) and [`docs/phase1-exit-audit.md`](./phase1-exit-audit.md) as the source of truth.

## Blocking

These items block Phase 1 exit for the candidate revision under review.

| Remaining gap | Closure path | Reviewer should look for |
| --- | --- | --- |
| Phase 1 exit evidence is still fragmented unless one candidate/revision packet is assembled and audited together. | Run `npm run release -- phase1:exit-audit -- --candidate <candidate-name> --candidate-revision <git-sha> --target-surface <h5\|wechat>` and keep the emitted JSON + Markdown. | `artifacts/release-readiness/phase1-exit-audit-<candidate>-<short-sha>.json` and `.md` report `pass` for all required criteria, with no required row left `fail` or `pending`. |
| Same-revision release evidence can drift across snapshot, gate summary, Cocos bundle, runtime evidence, and manual ledger. | Run `npm run release -- candidate:evidence-audit -- --candidate <candidate-name> --candidate-revision <git-sha> --target-surface <auto\|h5\|wechat>`. | `artifacts/release-readiness/candidate-evidence-audit-<candidate>-<short-sha>.json` and `.md` contain no `blocking` findings. |
| The final Phase 1 dossier packet can still drift after the dossier and exit audit are generated. | Run `npm run release -- phase1:exit-dossier-freshness-gate -- --candidate <candidate-name> --candidate-revision <git-sha> --dossier <phase1-candidate-dossier-json> --exit-audit <phase1-exit-audit-json> --snapshot <snapshot-json> --release-gate-summary <release-gate-summary-json> --manual-evidence-ledger <owner-ledger-md>`. | `artifacts/release-readiness/phase1-exit-dossier-freshness-gate-<candidate>-<short-sha>.json` and `.md` report `passed` with zero findings. |
| Cocos is the shipped Phase 1 client, so the main journey must be proven on the same candidate revision instead of inferred from H5-only evidence. | Run `npm run release -- cocos-rc:bundle -- --candidate <candidate-name> --build-surface <creator_preview\|wechat_preview\|wechat_upload_candidate>`. | The bundle, checklist, blocker log, and journey evidence all point at the same candidate/revision and cover `Lobby -> world -> battle -> settlement -> reconnect`. |
| Runtime observability and human sign-offs still need current reviewer ownership instead of ad hoc PR comments. | Capture `npm run release -- runtime-observability:evidence`, evaluate `npm run release -- runtime-observability:gate`, and update the candidate owner ledger from [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md). | Runtime gate artifact is current for the candidate revision, and the ledger no longer shows required rows as `pending` or `in-review`. |
| Persistence and shipped Phase 1 content still require release-time proof on the intended storage path. | Run `npm test -- phase1-release-persistence -- --output artifacts/release-readiness/phase1-release-persistence-regression.json` plus `npm run validate -- content-pack:all` when shipped content changed. | The persistence artifact passes for the candidate revision, records the intended storage mode, and does not leave shipped content validation unresolved. |

## Conditional Fallback

These items become blocking only when the stated condition is true.

| Condition | Remaining gap | Closure path | Reviewer should look for |
| --- | --- | --- | --- |
| Target surface is `wechat`. | WeChat package, smoke, and manual-review proof is missing or stale. | Run `npm run validate -- wechat-rc -- --artifacts-dir artifacts/wechat-release --expected-revision <git-sha>` or `npm run release -- wechat:rehearsal -- --build-dir <wechatgame-build-dir> --artifacts-dir artifacts/wechat-release --source-revision <git-sha> --expected-revision <git-sha>`. | `artifacts/wechat-release/codex.wechat.release-candidate-summary.json` is current, required manual review is not pending, and linked smoke/report artifacts match the candidate revision. |
| Reconnect, room recovery, or multiplayer teardown is in scope. | Reconnect evidence is absent, stale, or leaves cleanup risk unresolved. | Run `npm run release -- reconnect-soak -- --candidate <candidate-name> --candidate-revision <git-sha>`. | The reconnect soak summary is current, passed, and cleanup counters return to zero. |
| The candidate ships `frontier-basin`, `stonewatch-fork`, `ridgeway-crossing`, or `highland-reach`. | Pack-specific persistence coverage has not been refreshed for the shipped Phase 1 map pack. | Run `npm test -- phase1-release-persistence:frontier`, `npm test -- phase1-release-persistence:stonewatch`, `npm test -- phase1-release-persistence:ridgeway`, or `npm test -- phase1-release-persistence:highland` as applicable. | The pack-specific regression artifact for the shipped map pack is present and passing for the candidate revision. |
| Presentation placeholders or fallback delivery modes remain in the candidate. | Reviewers need an explicit accept/reject call instead of leaving presentation debt implicit. | Complete the generated Cocos presentation checklist and blocker log from `npm run release -- cocos-rc:bundle`, then record the result in the owner ledger. | Remaining presentation debt is either closed in the RC evidence bundle or manually signed off as non-blocking with owner and rationale. |

## Informational

These items should stay visible to reviewers, but they do not close Phase 1 by themselves.

| Item | Closure path | Reviewer should look for |
| --- | --- | --- |
| H5 remains a regression surface, not the shipped Phase 1 client. | Treat `npm run smoke -- client:release-candidate` and H5 smoke as supporting evidence, not as a substitute for the Cocos RC bundle. | H5 smoke stays green, but the final Phase 1 call still relies on the Cocos/WeChat evidence path. |
| The top-level reviewer packet should be generated after the blocking evidence is current, not edited by hand. | Run `npm run release -- phase1:candidate-dossier` for the section-by-section packet and `npm run release -- go-no-go-packet` for the final operator packet. | The packet artifacts only summarize already-current evidence and do not hide unresolved blockers or pending sign-offs. |
| The maturity scorecard remains the canonical statement of what "Phase 1 complete" means. | When the exit call changes, update [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md) instead of growing a parallel checklist. | This checklist stays a routing layer for reviewers, while the scorecard continues to define the exit criteria. |
