# Phase 1 Release Readiness Dashboard

`npm run release:readiness:dashboard` generates a single local report for the current Phase 1 gameplay release gates. It reuses existing evidence instead of redefining the workflow:

- `npm run release:readiness:snapshot` for automated regression/build gates
- `GET /api/runtime/health`, `GET /api/runtime/auth-readiness`, `GET /api/runtime/metrics` for live server/auth posture
- `npm run package:wechat-release` sidecar metadata for package validation
- `npm run smoke:wechat-release` for device/quasi-device smoke evidence
- `npm run release:cocos-rc:snapshot` for recent Cocos RC journey evidence

The dashboard writes both JSON and Markdown so it works as a quick terminal summary and as a review artifact.

## Usage

Generate a report from the latest local evidence already under `artifacts/`:

```bash
npm run release:readiness:dashboard
```

Probe a live local server and point the report at a specific WeChat artifact directory:

```bash
npm run release:readiness:dashboard -- \
  --server-url http://127.0.0.1:2567 \
  --snapshot artifacts/release-readiness/rc-2026-03-29.json \
  --cocos-rc artifacts/release-evidence/phase1-wechat-rc.json \
  --wechat-artifacts-dir artifacts/wechat-release
```

Write to explicit output files:

```bash
npm run release:readiness:dashboard -- \
  --output artifacts/release-readiness/phase1-dashboard.json \
  --markdown-output artifacts/release-readiness/phase1-dashboard.md
```

If your evidence freshness window should be stricter or looser than the default 14 days:

```bash
npm run release:readiness:dashboard -- --max-evidence-age-days 7
```

## Gate Mapping

The report summarizes four bounded gates:

- `Server health`
  - `pass` when `/api/runtime/health` is reachable and `/api/runtime/metrics` exposes the expected gameplay/auth counters.
  - `fail` when the live health probe fails or required metrics are missing.
  - `warn` when no `--server-url` is supplied.
- `Auth readiness`
  - `pass` when `/api/runtime/auth-readiness` returns `status: ok`.
  - `warn` when the endpoint reports `status: warn` or no server URL is supplied.
  - `fail` when the endpoint cannot be read.
- `Smoke/build/package validation`
  - Reuses the structured `release:readiness:snapshot` check results.
  - Confirms a `*.package.json` WeChat sidecar exists alongside its archive.
  - Reads `codex.wechat.smoke-report.json` and flags `pending` as `warn`, `failed` as `fail`.
- `Critical readiness evidence`
  - Lists the latest linked evidence with exact timestamps.
  - Warns when evidence is missing or older than the configured freshness window.

## Recommended Local Flow

1. Refresh the automated gate evidence:

```bash
npm run release:readiness:snapshot -- \
  --manual-checks docs/release-readiness-manual-checks.example.json
```

2. If validating a WeChat candidate, refresh artifact evidence:

```bash
npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir artifacts/wechat-release --expect-exported-runtime
npm run smoke:wechat-release -- --artifacts-dir artifacts/wechat-release
```

3. If validating a Cocos RC, refresh the RC journey snapshot:

```bash
npm run release:cocos-rc:snapshot -- --candidate <candidate-name> --build-surface wechat_preview --output artifacts/release-evidence/<candidate-name>.json
```

4. Start the local server if you want live runtime/auth evidence in the same report:

```bash
npm run dev:server
```

5. Generate the dashboard:

```bash
npm run release:readiness:dashboard -- \
  --server-url http://127.0.0.1:2567 \
  --wechat-artifacts-dir artifacts/wechat-release
```

The Markdown output is intended to be attachable to issue/PR discussion, while the JSON output is intended for automation or later aggregation.
