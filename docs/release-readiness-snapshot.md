# Release Readiness Snapshot

`npm run release:readiness:snapshot` generates a machine-readable snapshot for the current revision and records the release gate results in one place.

If you want a single human-readable Phase 1 dashboard on top of the snapshot plus runtime/WeChat/Cocos evidence, use `npm run release:readiness:dashboard` and see `docs/release-readiness-dashboard.md`.

The default automated checks are:

- `npm test`
- `npm run typecheck:ci`
- `npm run test:e2e:smoke`
- `npm run test:e2e:multiplayer:smoke`
- `npm run check:wechat-build`

The snapshot also supports manual gates, so the same file can carry pending or completed human checks such as runtime endpoint review, reconnect evidence, device smoke acceptance, or RC blocker review.

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
    "total": 7,
    "passed": 5,
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
      "id": "wechat-device-smoke",
      "kind": "manual",
      "status": "pending"
    }
  ]
}
```

Each automated check records the command, timestamps, duration, exit code, and stdout/stderr tail. That keeps the snapshot lightweight while still preserving enough evidence to debug failures.
