# Candidate Reconnect Soak

- Candidate: `issue-1173-wechat-release-gate`
- Revision: `d96e22a`
- Generated at: `2026-04-10T09:42:08.155Z`
- Verdict: **PASSED**
- Summary: Reconnect soak evidence is present and passing for this candidate revision.
- Duration: `10.00 min`
- Reconnect attempts: `384`
- Invariant checks: `2304`
- World reconnect cycles: `320`
- Battle reconnect cycles: `64`
- Final battle rooms: `4`
- Cleanup healthy: `yes`

## Scenario Matrix

| Scenario | Rooms | Passed | Failed | Duration (min) | Reconnects | Invariants | Cleanup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| reconnect_soak | 48 | 48 | 0 | 10.00 | 384 | 2304 | clean |

## Failures

- None.

## Operator Guidance

- Minimum profile: Use the canonical reconnect soak defaults: 48 rooms, 8 reconnect cycles per room, 12 connect concurrency, 12 action concurrency, 150ms reconnect pause.
- Flakes vs rerun: Treat a one-off infra or port-binding interruption as a rerun candidate only when reconnect invariants and cleanup counters never regressed; otherwise treat the artifact as stale and rerun on the pinned revision.
- Blocking policy: Any invariant failure, cleanup leak, revision mismatch, or zero reconnect/invariant counts is a release blocker until a fresh candidate-scoped soak passes.

## Rerun Triggers

- Candidate revision changes.
- Reconnect, room recovery, battle recovery, world progression, or snapshot persistence code changes.
- Reconnect soak defaults, scenario matrix, or artifact contract changes.
- A prior soak artifact is stale, partial, or failed.
