# Same-Revision Release Evidence Runbook

Use this maintainer runbook when one release decision must be backed by one candidate revision, not by the newest mix of artifacts in `artifacts/`.

For the automated candidate-scoped assembly path, start with [`docs/phase1-same-revision-evidence-bundle.md`](./phase1-same-revision-evidence-bundle.md) and `npm run release:phase1:same-revision-evidence-bundle`. The rest of this runbook remains the detailed operator sequence and review checklist behind that command.

It does not redefine release gates. It sequences the existing commands and artifacts already described in:

- [`docs/phase1-maturity-scorecard.md`](./phase1-maturity-scorecard.md)
- [`docs/release-readiness-snapshot.md`](./release-readiness-snapshot.md)
- [`docs/release-gate-summary.md`](./release-gate-summary.md)
- [`docs/release-readiness-dashboard.md`](./release-readiness-dashboard.md)
- [`docs/wechat-minigame-release.md`](./wechat-minigame-release.md)
- [`docs/cocos-release-evidence-template.md`](./cocos-release-evidence-template.md)
- [`docs/release-go-no-go-decision-packet.md`](./release-go-no-go-decision-packet.md)
- [`docs/release-evidence/release-readiness-artifact-index.template.md`](./release-evidence/release-readiness-artifact-index.template.md)

## First Stop: Current Evidence Index

Before a reviewer or release owner opens individual packet artifacts, generate the checked-out revision index:

```bash
npm run release:evidence:index
```

This command scans the current `artifacts/release-readiness/` and `artifacts/wechat-release/` working set, then writes:

- `artifacts/release-readiness/current-release-evidence-index-<short-sha>.json`
- `artifacts/release-readiness/current-release-evidence-index-<short-sha>.md`

Use the index as the release-call front door:

- confirm the checked-out revision and inferred candidate before reviewing deeper evidence
- verify that the required families for the current packet exist in one place
- stop and refresh any artifact family flagged as missing, stale, or revision-mismatched before relying on downstream summaries

## Artifact Retention And Indexing

Treat `artifacts/release-readiness/` as the working set for the current release call, not as an unbounded archive.

- Keep one current packet for the candidate revision under review.
- Keep one previous comparable packet for the same target surface so reviewers can answer "what changed since the last release-ready call?" without scanning the whole directory.
- Keep the candidate-scoped manual evidence ledger and the candidate-scoped artifact index beside the packet while that release call is active.
- When a newer packet replaces an older one, move the superseded packet out of the working set by attaching it to the release PR / CI artifact record or deleting the local copy after handoff. Do not leave multiple stale "latest" files in place.
- Do not edit stale artifacts to make them look current. Regenerate the current packet for the pinned revision and update the index instead.

Use [`docs/release-evidence/release-readiness-artifact-index.template.md`](./release-evidence/release-readiness-artifact-index.template.md) as the maintainer-facing catalog. Copy it into `artifacts/release-readiness/release-readiness-artifact-index-<candidate>-<short-sha>.md` for the active release call. The index is where maintainers record which packet is current, which packet is the last comparable baseline, and which exact artifact paths were used for comparison.

## Same-Revision Rule

Pick these two values first and keep them fixed through the whole pass:

- `<candidate-name>`
- `<git-sha>`

Use the same `<git-sha>` everywhere a command accepts `--candidate-revision`, `--expected-revision`, or `--source-revision`.

If one required artifact points at another commit, treat the packet as stale and regenerate that artifact. Do not waive revision drift by hand.

## Fresh Vs Reusable Evidence

| Evidence | Fresh for this release call | Reusable only when all of this is still true |
| --- | --- | --- |
| Release readiness snapshot | Yes | Never reuse across a new candidate revision. |
| Release gate summary | Yes | Never reuse across a new candidate revision or surface change. |
| Cocos RC bundle, checklist, blockers | Yes for the candidate under review | Reuse only within the same candidate/revision while no linked snapshot or WeChat evidence changed. |
| Runtime observability sign-off | Yes for WeChat release calls | Reuse only for the same candidate/revision, same target environment, and only when no runtime/observability surface changed. |
| WeChat candidate summary, RC validation report, smoke report | Yes when target surface is WeChat | Reuse only for the same candidate/revision while still inside the documented freshness window and with matching manual-review metadata. |
| Manual evidence owner ledger | Yes | Update whenever any manual evidence row changes state. |
| Reconnect soak artifact | Fresh when reconnect / room recovery is in scope or when the release packet requires it | Reuse only for the same candidate/revision while counters, verdict, and timestamps are still within the accepted window. |
| Persistence/content validation artifact | Fresh when persistence, content packs, or map-pack release evidence is in scope | Reuse only for the same candidate/revision when the shipped content and storage mode did not change. |

Rule of thumb: automated summaries may reuse lower-level artifacts from the same candidate revision; they may not mix inputs from different revisions or stale manual sign-offs.

## Required Steps By Release Surface

| Step | H5 target surface | WeChat target surface |
| --- | --- | --- |
| Pin candidate name and revision | Required | Required |
| `npm run release:readiness:snapshot` | Required | Required |
| Manual evidence owner ledger | Required | Required |
| `npm run release:gate:summary -- --target-surface <surface>` | Required | Required |
| `npm run release:candidate:evidence-audit -- --candidate <candidate> --candidate-revision <git-sha> --target-surface <auto\|h5\|wechat>` | Required | Required |
| `npm run release:readiness:dashboard -- --candidate <candidate> --candidate-revision <git-sha>` | Required | Required |
| `npm run release:cocos-rc:bundle` | Required for the primary Cocos client evidence packet | Required |
| `npm run validate:wechat-rc` or `npm run release:wechat:rehearsal` | Optional | Required |
| `npm run smoke:wechat-release -- --check` evidence | Optional | Required |
| Runtime observability sign-off | Optional unless the release owner explicitly requires live runtime review | Required |
| `npm run release:reconnect-soak` | Required when reconnect / room recovery is in scope, or when the release packet expects reconnect evidence | Same rule |
| `npm run test:phase1-release-persistence` and map-pack variants | Required when persistence, storage mode, or shipped Phase 1 packs changed | Same rule |

## Assembly Sequence

1. Record the pinned revision.

```bash
git rev-parse HEAD
git rev-parse --short HEAD
```

2. Generate the baseline automated snapshot for that revision.

```bash
npm run release:readiness:snapshot -- \
  --manual-checks docs/release-readiness-manual-checks.example.json
```

Keep the emitted snapshot path. Confirm:

- `revision.commit == <git-sha>`
- `summary.requiredFailed == 0`
- any remaining `requiredPending` items are manual checks you will complete in this same packet

3. Start or refresh the manual evidence owner ledger for the same candidate.

Copy [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md) into `artifacts/release-readiness/` or mirror the same table in the release PR.

Pre-fill one row per required manual evidence item before continuing. This is the handoff tracker for the rest of the run.

In the same pass, copy [`docs/release-evidence/release-readiness-artifact-index.template.md`](./release-evidence/release-readiness-artifact-index.template.md) into `artifacts/release-readiness/` and fill in the candidate header plus the `Current packet` rows you already know. Keep the `Previous comparable packet` section pointed at the last release-call packet for the same target surface.

At minimum, create rows for:

- runtime observability review
- Cocos / WeChat RC checklist review
- Cocos / WeChat blocker-register review
- Cocos presentation sign-off when presentation review applies
- WeChat package install/launch verification when WeChat is the target surface
- WeChat device/runtime smoke when WeChat is the target surface
- reconnect follow-up when reconnect evidence still needs a human call

4. Refresh scope-specific evidence only when the candidate needs it.

Reconnect / room recovery scope:

```bash
npm run release:reconnect-soak -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha>
```

Persistence / shipped Phase 1 content scope:

```bash
npm run test:phase1-release-persistence -- \
  --output artifacts/release-readiness/phase1-release-persistence-regression.json
```

When the candidate ships `frontier-basin`, `stonewatch-fork`, or `ridgeway-crossing`, also run the matching pack-specific persistence regression or equivalent `--map-pack` form described in [`docs/release-readiness-snapshot.md`](./release-readiness-snapshot.md).

5. Generate the Cocos primary-client candidate bundle for the same revision.

```bash
npm run release:cocos-rc:bundle -- \
  --candidate <candidate-name> \
  --build-surface <creator_preview|wechat_preview> \
  --release-readiness-snapshot <snapshot-json>
```

If the target surface is WeChat, pass the current smoke report path too:

```bash
npm run release:cocos-rc:bundle -- \
  --candidate <candidate-name> \
  --build-surface wechat_preview \
  --wechat-smoke-report artifacts/wechat-release/codex.wechat.smoke-report.json \
  --release-readiness-snapshot <snapshot-json>
```

Confirm the generated bundle, checklist, and blockers files all point at the same candidate and revision.

After reviewing or editing the checklist / blockers files, update the matching rows in the owner ledger before moving on. The ledger is the release-call index; the checklist and blocker files remain the underlying evidence.

6. Refresh the WeChat artifact family when WeChat is the release surface.

If the package/smoke/manual-review artifacts already exist for the same revision, validate them:

```bash
npm run validate:wechat-rc -- \
  --artifacts-dir artifacts/wechat-release \
  --expected-revision <git-sha> \
  --require-smoke-report \
  --manual-checks docs/release-evidence/wechat-release-manual-review.example.json
```

If you need one end-to-end regeneration pass for the same revision, use rehearsal instead:

```bash
npm run release:wechat:rehearsal -- \
  --build-dir <wechatgame-build-dir> \
  --artifacts-dir artifacts/wechat-release \
  --source-revision <git-sha> \
  --expected-revision <git-sha> \
  --require-smoke-report
```

Keep these outputs together:

- `artifacts/wechat-release/codex.wechat.release-candidate-summary.json`
- `artifacts/wechat-release/codex.wechat.rc-validation-report.json`
- `artifacts/wechat-release/codex.wechat.smoke-report.json`
- optional rehearsal summary `.json` and `.md`

7. Complete runtime observability sign-off when WeChat is the release surface.

Use [`docs/wechat-runtime-observability-signoff.md`](./wechat-runtime-observability-signoff.md) and [`docs/release-evidence/wechat-runtime-observability-signoff.template.md`](./release-evidence/wechat-runtime-observability-signoff.template.md) to capture:

- `GET /api/runtime/health`
- `GET /api/runtime/auth-readiness`
- `GET /api/runtime/metrics`

Confirm the sign-off records the same revision, target environment, reviewer, and timestamp, then mirror that state into the owner ledger.

8. Build the release-surface gate summary from the pinned artifact set.

H5 example:

```bash
npm run release:gate:summary -- \
  --target-surface h5 \
  --snapshot <snapshot-json> \
  --manual-evidence-ledger <owner-ledger-md>
```

WeChat example:

```bash
npm run release:gate:summary -- \
  --target-surface wechat \
  --snapshot <snapshot-json> \
  --manual-evidence-ledger <owner-ledger-md> \
  --wechat-artifacts-dir artifacts/wechat-release
```

Add `--reconnect-soak <path>` when reconnect evidence is part of the packet and you want the summary pinned to the exact soak artifact instead of directory discovery.

9. Run the candidate-level evidence audit against the pinned artifact family.

```bash
npm run release:candidate:evidence-audit -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha> \
  --target-surface <h5|wechat> \
  --snapshot <snapshot-json> \
  --release-gate-summary <release-gate-summary-json> \
  --cocos-rc-bundle <cocos-rc-bundle-json> \
  --runtime-observability-evidence <runtime-evidence-json> \
  --runtime-observability-gate <runtime-gate-json> \
  --manual-evidence-ledger <owner-ledger-md>
```

Keep the emitted JSON / Markdown pair with the rest of the packet. This is the explicit same-revision stitch check for the maintainer flow: it should fail closed when required artifacts drift to another revision, candidate name, linked snapshot/evidence path, or freshness window. The report now also separates `blocking` from `warning` findings so H5 review can keep WeChat/runtime drift visible without treating it as a hard stop.

10. Run the candidate-level dashboard as the final reviewer summary.

```bash
npm run release:readiness:dashboard -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha> \
  --wechat-artifacts-dir artifacts/wechat-release
```

11. Run the dedicated Phase 1 dossier freshness gate before attaching the packet to CI or the release PR.

```bash
npm run release:phase1:exit-dossier-freshness-gate -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha> \
  --dossier <phase1-candidate-dossier-json> \
  --exit-audit <phase1-exit-audit-json> \
  --snapshot <snapshot-json> \
  --release-gate-summary <release-gate-summary-json> \
  --manual-evidence-ledger <owner-ledger-md>
```

This step is intentionally narrow and PR-friendly: it checks that the dossier, exit audit, snapshot, gate summary, and owner ledger still form one same-revision packet, and it emits one JSON + Markdown verdict that can be attached directly to CI logs or the review thread.

Add `--server-url <url>` when you want the dashboard to probe the live candidate environment in the same pass.

12. Build the maintainer-facing decision packet when the underlying evidence is coherent.

```bash
npm run release:go-no-go-packet -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha>
```

Use the packet as the final reviewer attachment. If it still reports blockers, fix the upstream artifact set and rerun the packet instead of editing the packet by hand.

13. Refresh the packet index and comparison notes.

Before closing the release call:

- mark the current packet rows with the exact snapshot, gate summary, audit, dashboard, and decision-packet paths that were approved
- keep the immediately previous comparable packet in the index until the new packet is accepted
- record the short comparison outcome, for example `same gates passed`, `wechat evidence refreshed`, or `reconnect soak regressed`
- once the new packet becomes the accepted baseline, update the index so today's `Current packet` becomes the next release call's `Previous comparable packet`

## Minimum Artifact Packet

Before calling release `go`, confirm the packet contains these same-revision artifacts:

- one release readiness snapshot
- one manual evidence owner ledger
- one release gate summary for the selected target surface
- one candidate-level evidence audit report for the pinned candidate/revision pair
- one Cocos RC bundle plus paired checklist and blockers files
- for WeChat releases: one WeChat candidate summary, one RC validation report, one smoke report, and one runtime observability sign-off
- when reconnect scope applies: one reconnect soak artifact
- when persistence or shipped content scope applies: one current persistence/content artifact
- one final release-readiness dashboard
- one go/no-go decision packet
- one candidate-scoped artifact index that points at the current packet and the previous comparable packet

## Go / No-Go Summary

Release is `go` only when all required evidence for the selected surface is true at the same `<git-sha>`:

- no required snapshot check is failed or still pending
- no required gate-summary dimension is failed, blocked, or stale
- the candidate-level evidence audit is present and passing for the pinned artifact family, or only carries warnings that are acceptable for the selected surface
- the owner ledger has no required row left in `pending` or `in-review`
- the artifact index points at the exact current packet and the last comparable packet, so a reviewer can reconstruct both the current decision and the previous baseline without guessing from directory timestamps
- the Cocos RC bundle, checklist, and blockers files match the same candidate revision
- WeChat release calls also have current smoke, manual-review, and runtime observability evidence
- any reconnect or persistence evidence required by the release scope is present and current
- the final dashboard and go/no-go packet agree that the candidate is ready

Release is `no-go` when any required artifact is missing, stale, revision-mismatched, blocked by unresolved manual review, or still needs ad hoc explanation to justify why it belongs to the candidate under review.

This runbook exists to prove the scorecard's same-revision release question for one candidate. If the packet cannot answer that question cleanly, the candidate is still in release hardening.
