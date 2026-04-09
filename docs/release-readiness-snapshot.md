# Release Readiness Snapshot

`npm run release:readiness:snapshot` generates a machine-readable snapshot for the current revision and records the release gate results in one place.

If reviewers need the short Phase 1 hardening checklist that maps each remaining gap to its closure command, artifact, or manual sign-off, open [`docs/phase1-hardening-reviewer-checklist.md`](./phase1-hardening-reviewer-checklist.md).

If you want a single human-readable Phase 1 dashboard on top of the snapshot plus runtime/WeChat/Cocos evidence, use `npm run release:readiness:dashboard` and see `docs/release-readiness-dashboard.md`.

If you want a CI-oriented pass/fail summary that also folds in packaged H5 smoke and WeChat release evidence, use `npm run release:gate:summary` and see `docs/release-gate-summary.md`.

The default automated checks are:

- `npm test`
- `npm run typecheck:ci`
- `npm run test:e2e:smoke`
- `npm run test:e2e:multiplayer:smoke`
- `npm run test:phase1-release-persistence -- --output artifacts/release-readiness/phase1-release-persistence-regression.json`
- `npm run test:sync-governance:matrix -- --output artifacts/release-readiness/sync-governance-matrix.json`
- `npm run test:multiplayer-protocol-compatibility -- --output artifacts/release-readiness/multiplayer-protocol-compatibility.json`
- `npm run check:cocos-release-readiness`

The Phase 1 persistence regression intentionally keeps config/content validation tied to the same release-hardening story:

- it validates the shipped default `phase1` pack, all 12 additional Phase 1 presets, and both `phase2` validation presets
- it exercises persistence-backed player/account/world carryover with representative resources, hero growth, replay history, and event history

For candidate review of the additional Phase 1 packs:

- in Config Center, apply `layout_frontier_basin` to both `world` and `mapObjects`
- for runtime/manual room checks, join a room whose id includes `[map:frontier_basin]`
- for scripted verification, run `npm run validate:content-pack:all` and `npm run test:phase1-release-persistence:frontier`
- in Config Center, apply `layout_stonewatch_fork` to both `world` and `mapObjects`
- for runtime/manual room checks, join a room whose id includes `[map:stonewatch_fork]`
- for scripted verification, run `npm run validate:content-pack:all` and `npm run test:phase1-release-persistence:stonewatch`

For candidate review of the ridgeway Phase 1 pack:

- in Config Center, apply `layout_ridgeway_crossing` to both `world` and `mapObjects`
- for runtime/manual room checks, join a room whose id includes `[map:ridgeway_crossing]`
- for scripted verification, run `npm run validate:content-pack:all` and `npm run test:phase1-release-persistence:ridgeway`

For candidate review of the highland Phase 1 pack:

- in Config Center, apply `layout_highland_reach` to both `world` and `mapObjects`
- for runtime/manual room checks, join a room whose id includes `[map:highland_reach]`
- for scripted verification, run `npm run validate:content-pack:all` and `npm run test:phase1-release-persistence:highland`
- expect materially different pacing from the baseline pack: `highland-reach` expands to a 10x10 board, mirrors gold pickups across both flanks, and puts four neutral contests around the central dirt corridor so scouting and route commitment matter earlier

When `VEIL_MYSQL_*` is configured, the regression automatically targets MySQL. Without MySQL env it falls back to the in-memory store so contributors can still run the same flow locally, but release verification should expect the generated report to show `Storage: mysql`.

For packaged H5 release-candidate validation, run:

```bash
npm run smoke:client:release-candidate
```

That flow rebuilds `apps/client/dist`, serves the packaged artifact instead of the dev shell, exercises guest login plus cached-session room boot, and writes machine-readable evidence under `artifacts/release-readiness/`. Pass `--output <path>` when CI or a reviewer needs a stable artifact filename.

The snapshot also supports manual gates, so the same file can carry pending or completed human checks such as WeChat package install/launch verification, reconnect evidence, device smoke acceptance, or RC blocker review.

For candidate-scoped target-environment runtime review, prefer the bundle capture flow so reviewers get one environment packet with the staged evidence and gate verdicts:

```bash
npm run release:runtime-observability:bundle -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha> \
  --target-surface <h5|wechat> \
  --target-environment <env-name> \
  --server-url <base-url> \
  [--include-room-lifecycle]
```

That command writes a candidate+revision-scoped bundle directory under `artifacts/release-readiness/`, including `runtime-observability-bundle.json/.md` plus staged runtime evidence and gate artifacts for `/api/runtime/health`, `/api/runtime/auth-readiness`, and `/api/runtime/metrics`. Add `--include-room-lifecycle` when reviewers also need `/api/runtime/room-lifecycle-summary` for battle or reconnect triage. The underlying `release:runtime-observability:evidence` and `release:runtime-observability:gate` commands remain available when downstream tooling needs just the raw capture or just the gate.

When a candidate has more than one manual sign-off in flight, track ownership in [`docs/release-evidence/manual-release-evidence-owner-ledger.template.md`](./release-evidence/manual-release-evidence-owner-ledger.template.md) and keep the candidate copy under `artifacts/release-readiness/manual-release-evidence-owner-ledger-<candidate>-<short-sha>.md`; [`artifacts/release-readiness/manual-release-evidence-owner-ledger-phase1-rc-abc1234.md`](../artifacts/release-readiness/manual-release-evidence-owner-ledger-phase1-rc-abc1234.md) is the reviewer-facing example.

When reviewers need one candidate-scoped freshness verdict across the snapshot, gate summary, Cocos RC bundle, runtime observability packet, owner ledger, and any applicable WeChat release evidence, run:

```bash
npm run release:candidate:evidence-audit -- \
  --candidate <candidate-name> \
  --candidate-revision <git-sha> \
  --target-surface <auto|h5|wechat> \
  --snapshot <snapshot-json> \
  --release-gate-summary <release-gate-summary-json> \
  --cocos-rc-bundle <cocos-rc-bundle-json> \
  --runtime-observability-evidence <runtime-evidence-json> \
  --runtime-observability-gate <runtime-gate-json> \
  --manual-evidence-ledger <owner-ledger-md>
```

The audit writes both JSON and Markdown under `artifacts/release-readiness/`, links back to the underlying artifact paths, emits one reviewer-facing triage split into `blocking` and `warning`, fails closed on revision drift for required families, and now also flags pending ledger rows plus stale or blocked WeChat/runtime-observability evidence when those surfaces are applicable. Use `--target-surface wechat` when the audit is part of a shipping or RC decision for WeChat; use `--target-surface h5` to keep WeChat/runtime drift advisory instead of blocking. `--target-surface auto` keeps the older inference behavior and only escalates WeChat/runtime checks when their artifacts are already present.

If reviewers only need the lightweight Cocos RC packet check before manual checklist or blocker review, run:

```bash
node --import tsx ./scripts/cocos-rc-evidence-consistency-check.ts \
  --candidate <candidate-name> \
  --expected-revision <git-sha>
```

That check stays intentionally narrow: it only reads the latest release-readiness snapshot, release gate summary, primary-journey evidence, Cocos RC snapshot, main-journey manifest, and Cocos RC bundle for the candidate, then flags candidate drift, revision drift, stale timestamps, or linked-artifact mismatches in one JSON + Markdown summary.

## Usage

Run the full automated snapshot and write the result under `artifacts/release-readiness/`:

```bash
npm run release:readiness:snapshot
```

Generate a pending template without executing the automated commands:

```bash
npm run release:readiness:snapshot -- --no-run
```

Merge in manual checks from a JSON file:

```bash
npm run release:readiness:snapshot -- \
  --manual-checks docs/release-readiness-manual-checks.example.json
```

Add a one-off pending manual check from the CLI:

```bash
npm run release:readiness:snapshot -- \
  --manual-check "wechat-device-smoke:WeChat device smoke report"
```

Write to a specific file:

```bash
npm run release:readiness:snapshot -- \
  --output artifacts/release-readiness/rc-2026-03-29.json
```

## Manual Check File

The manual check file can be either an array or an object with a `checks` array. Each entry supports:

- `id`
- `title`
- `status`: `pending`, `passed`, `failed`, or `not_applicable`
- `required`: defaults to `true`
- `notes`
- `evidence`: string array

Example:

```json
[
  {
    "id": "runtime-health-review",
    "title": "Runtime health/auth-readiness/metrics review",
    "status": "pending",
    "required": true,
    "notes": "Capture candidate-environment endpoints before widening playtest.",
    "evidence": [
      "docs/core-gameplay-release-readiness.md"
    ]
  },
  {
    "id": "wechat-device-smoke",
    "title": "WeChat device smoke report",
    "status": "pending",
    "required": true,
    "notes": "Complete npm run smoke:wechat-release against the packaged RC build.",
    "evidence": [
      "docs/wechat-minigame-release.md"
    ]
  },
  {
    "id": "cocos-rc-blocker-review",
    "title": "Cocos/WeChat RC blocker register reviewed",
    "status": "pending",
    "required": true,
    "notes": "Attach the completed RC checklist and blocker template for the candidate before marking release-ready.",
    "evidence": [
      "docs/release-evidence/cocos-wechat-rc-checklist.template.md",
      "docs/release-evidence/cocos-wechat-rc-blockers.template.md"
    ]
  }
]
```

If you are carrying several manual checks for one candidate, keep the JSON file as the machine-readable source of truth for status and mirror the owner, revision, artifact path, and next follow-up in the candidate ledger. Update the matching ledger row immediately when the RC checklist, blocker log, runtime observability sign-off, or WeChat manual review changes. The snapshot answers "which manual checks exist"; the ledger answers "who still owes which sign-off."

## Snapshot Shape

Sample output:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-03-29T08:12:04.512Z",
  "revision": {
    "commit": "abc1234567890",
    "shortCommit": "abc1234",
    "branch": "codex/issue-213-release-readiness-snapshot-0329-0752",
    "dirty": false
  },
  "summary": {
    "total": 8,
    "passed": 6,
    "failed": 0,
    "pending": 2,
    "notApplicable": 0,
    "requiredFailed": 0,
    "requiredPending": 2,
    "status": "pending"
  },
  "checks": [
    {
      "id": "npm-test",
      "kind": "automated",
      "status": "passed",
      "command": "npm test"
    },
    {
      "id": "cocos-primary-journey",
      "kind": "automated",
      "status": "passed",
      "command": "npm run smoke:cocos:canonical-journey"
    },
    {
      "id": "wechat-device-smoke",
      "kind": "manual",
      "status": "pending"
    }
  ]
}
```

Each automated check records the command, timestamps, duration, exit code, and stdout/stderr tail. That keeps the snapshot lightweight while still preserving enough evidence to debug failures.
