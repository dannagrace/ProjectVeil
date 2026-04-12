# Project Veil Capacity Planning

This page publishes the current single-node room capacity envelope from the in-repo concurrent-room sweep in [`artifacts/release-readiness/capacity-planning-summary.json`](../../artifacts/release-readiness/capacity-planning-summary.json) and [`artifacts/release-readiness/capacity-planning-summary.md`](../../artifacts/release-readiness/capacity-planning-summary.md).

The current evidence was generated on `2026-04-11` from branch `codex/issue-1304-load-test-capacity-thresholds-0412-0019` with:

```bash
npm run stress:rooms:capacity-plan
```

The sweep runs the existing room stress harness at `10/50/100/200` concurrent rooms against a production-shaped single-node runtime and measures:

- world-action p95 latency against the hard limit of `100ms`
- CPU utilization, RSS, and heap high-water marks
- reconnect throughput under the same room counts

## Current Limits

- Safe limit per server instance: `10 concurrent rooms`
- First sampled latency breach: `50 concurrent rooms`
- Prometheus warning / scale-out trigger: `8 active rooms` (`SAFE_LIMIT * 0.8`)
- Matchmaking queue alert: `veil_matchmaking_queue_depth > 50 for 30s`

Why the limit is this low:

- `10 rooms`: world-action p95 landed at `100.03ms`, effectively right on the hard ceiling.
- `50 rooms`: world-action p95 climbed to `153.76ms`.
- `100 rooms`: world-action p95 climbed to `333.16ms`.
- `200 rooms`: world-action p95 climbed to `553.99ms`.

Observed resource profile from the same sweep:

| Rooms | Worst-case p95 latency | Peak CPU core utilization | Peak RSS | Peak heap |
| --- | --- | --- | --- | --- |
| 10 | `100.03ms` | `68.53%` | `242.6 MB` | `77.26 MB` |
| 50 | `153.76ms` | `59.12%` | `249.29 MB` | `104.59 MB` |
| 100 | `333.16ms` | `57.98%` | `318.45 MB` | `128.71 MB` |
| 200 | `553.99ms` | `56.50%` | `358.6 MB` | `156.46 MB` |

The limiting factor in this environment is action latency, not raw CPU saturation.

## Horizontal Scale Threshold

Add another server instance when either of these becomes true on a node:

1. `veil_active_rooms_total > 8` for 5 minutes.
2. `veil_matchmaking_queue_depth > 50` for 30 seconds.

Operationally:

- `8 rooms/node` is the early-warning threshold.
- `10 rooms/node` is the current published ceiling.
- Do not wait for `10` rooms to be sustained before scaling; the 10-room sample is already at the latency limit.

## Cost Estimate Per 1000 DAU

Planning assumptions used in the artifact:

- Peak concurrent users = `10%` of DAU
- `2 players` per room
- Server instance cost = `$48/month`

That gives:

- `1000 DAU -> 100 peak CCU -> 50 peak rooms`
- `50 peak rooms / 10 safe rooms per node = 5 instances`
- Estimated server cost per `1000 DAU`: `$240/month`

This is intentionally a room-server estimate only. It excludes MySQL, Redis, bandwidth, logging, and CDN spend.

## Notes

- The published sweep currently uses the stable `world_progression` and `reconnect` scenarios from `scripts/stress-concurrent-rooms.ts`. Those are the scenarios that cleanly expose room admission pressure and action-latency degradation in the current harness.
- If the runtime, message model, room lifecycle, or node size changes, rerun `npm run stress:rooms:capacity-plan` and update this page plus `docs/alerting-rules.yml` in the same change.
