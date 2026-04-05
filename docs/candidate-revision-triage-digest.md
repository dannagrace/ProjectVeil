# Candidate Revision Triage Digest

`npm run release:candidate-triage:digest` builds a candidate-scoped error aggregation digest from runtime diagnostics snapshots or raw error-event bundles. The script writes both JSON and Markdown artifacts so release review and on-call can read the same summary.

## Inputs

- Server example: `/api/runtime/diagnostic-snapshot` exports now include `diagnostics.errorEvents` and `diagnostics.errorSummary`.
- Client example: H5 runtime diagnostics exports now include the same error event envelope, including `errorCode`, `featureArea`, `candidateRevision`, and `room/request` context.
- Raw bundle fallback: any JSON payload with `{ "errorEvents": [...] }`.

## Release Review

Use the digest when a candidate is blocked by crash spikes, repeated runtime exceptions, or unclear owner routing.

```bash
npm run release:candidate-triage:digest -- \
  --candidate phase1-rc \
  --candidate-revision "$(git rev-parse HEAD)" \
  --input artifacts/runtime/server-diagnostic-snapshot.json \
  --input artifacts/runtime/h5-diagnostic-snapshot.json
```

Expected outputs land under `artifacts/release-readiness/` by default:

- `candidate-revision-triage-digest-<candidate>-<revision>.json`
- `candidate-revision-triage-digest-<candidate>-<revision>.md`

Review the Markdown first:

- Confirm the top fingerprints actually match the pinned candidate revision.
- Check `featureArea` and `suggested owner` before escalating.
- Compare `last reproduced` against the latest smoke/release evidence to decide whether the issue is still active.

## On-Call Triage

Use the JSON artifact when you need stable machine-readable context for handoff or incident notes.

- `topFingerprints[*].fingerprint` is stable enough for paging, issue updates, and PR validation notes.
- `firstSeenRevision` shows whether the fingerprint predates the current candidate or was introduced here.
- `sampleContext` carries the minimal room/request/action metadata needed to route the issue without digging through raw logs first.

## Minimum Classification Dictionary

The digest keeps the owner routing intentionally small:

- `login` -> `account`
- `payment` -> `commerce`
- `room_sync` -> `multiplayer`
- `rewards`, `season`, `quests` -> `progression`
- `share`, `guild` -> `social`
- `battle` -> `combat`
- `runtime`, `shop`, `unknown` -> `platform` unless an event already provides a more specific owner

If a producer already knows the real owner area, set `ownerArea` on the event and the digest will preserve it.
