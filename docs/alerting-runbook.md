# Project Veil Alerting Runbook

Use this runbook when Prometheus fires one of the runtime alerts defined in [`docs/alerting-rules.yml`](./alerting-rules.yml).

The commands below assume the runtime is reachable at `http://127.0.0.1:2567`. Override that first when you are targeting another environment:

```bash
export VEIL_RUNTIME_URL="${VEIL_RUNTIME_URL:-http://127.0.0.1:2567}"
```

## Shared Triage Commands

Start every incident with the same four snapshots so the alert has current context:

```bash
curl -fsS "$VEIL_RUNTIME_URL/metrics" > /tmp/project-veil.metrics
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/auth-readiness" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/analytics-pipeline" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/slo-summary?format=text"
```

If one of those probes fails, treat that as a runtime availability incident before focusing on the individual alert threshold.

## Alert: VeilConnectedPlayersHigh

Likely causes:

- legitimate playtest or load-test traffic exceeded the current room/capacity plan
- reconnect backlog or stale sessions kept connections open after players should have drained
- room growth lagged new joins, so one runtime is absorbing too much candidate traffic

Immediate triage commands:

```bash
grep -E '^(veil_connected_players|veil_active_rooms) ' /tmp/project-veil.metrics
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq '{activeRoomCount: .runtime.activeRoomCount, connectionCount: .runtime.connectionCount, activeBattleCount: .runtime.activeBattleCount, heroCount: .runtime.heroCount}'
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/diagnostic-snapshot" | jq '.runtime.roomSummaries | sort_by(-.connectedPlayers)[:10]'
```

Mitigation steps:

1. Confirm whether the traffic is expected. If this is a scheduled stress event, keep the alert open but avoid emergency scaling until room density or latency also degrades.
2. If the traffic is unexpected, shed synthetic/test traffic first and pause any active load generator.
3. If the environment should sustain the current player count, add runtime capacity or bring another shard online before room density rises further.
4. If connections are not draining, inspect reconnect backlog and stale-session behavior from `auth-readiness`; recycle the affected runtime only after confirming players can reconnect cleanly.

Escalation thresholds:

- escalate to the runtime owner if `veil_connected_players` stays above `150` for another 15 minutes after load shedding
- escalate immediately if it rises above `200`, or if room density and HTTP latency alerts fire at the same time

## Alert: VeilRoomsHot

Likely causes:

- uneven room placement left one or more rooms significantly hotter than the rest
- room creation/disposal drift kept the active-room count artificially low
- matchmaking or shard routing kept sending new joins into an already saturated slice

Immediate triage commands:

```bash
grep -E '^(veil_connected_players|veil_active_rooms) ' /tmp/project-veil.metrics
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq '{activeRoomCount: .runtime.activeRoomCount, connectionCount: .runtime.connectionCount}'
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/room-lifecycle-summary?format=text"
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/diagnostic-snapshot" | jq '.runtime.roomSummaries | sort_by(-.connectedPlayers)[:10] | map({roomId, day, connectedPlayers, activeBattles, updatedAt})'
```

Mitigation steps:

1. Identify whether the ratio is global growth or a small set of hot rooms.
2. If only a few rooms are overloaded, stop routing fresh joins into the hot shard and encourage new room creation.
3. If room disposal is stuck or room count is clearly wrong, restart the affected runtime after capturing diagnostics so stale room state does not hide the root cause.
4. If the ratio is cluster-wide, scale out capacity and review matchmaking/placement settings before the next playtest wave.

Escalation thresholds:

- escalate if average players per room stays above `12` for 20 minutes after routing or scaling changes
- escalate immediately if any single room is carrying `>= 16` connected players or if battle-duration alerts are firing in the same window

## Alert: VeilBattleDurationP95High

Likely causes:

- turn processing stalled and battles are not resolving on schedule
- players are trapped in combat loops or waiting on invalid state transitions
- one or more overloaded rooms are stretching battle completion time under load

Immediate triage commands:

```bash
grep '^veil_battle_duration_seconds_' /tmp/project-veil.metrics | tail -n 20
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq '{activeBattleCount: .runtime.activeBattleCount, actionMessagesTotal: .runtime.gameplayTraffic.actionMessagesTotal, battleActionsTotal: .runtime.gameplayTraffic.battleActionsTotal}'
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/diagnostic-snapshot" | jq '.runtime.roomSummaries | map(select(.activeBattles > 0)) | sort_by(-.activeBattles)[:10]'
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/slo-summary" | jq .
```

Mitigation steps:

1. Confirm whether the slowdown is isolated to one room or visible across most active battles.
2. If a small number of rooms are stuck, capture the diagnostic snapshot and remove those rooms from player traffic before restarting that runtime.
3. If the issue is widespread, halt new playtest sessions and inspect the most recent gameplay/server deploy for battle-loop regressions before resuming traffic.
4. Keep the incident open until p95 falls back under threshold and active battles begin draining at a normal rate.

Escalation thresholds:

- escalate to the gameplay owner if p95 stays above `180s` for 30 minutes
- escalate immediately if p95 exceeds `240s`, if active battles keep increasing without draining, or if action-validation failures spike at the same time

## Alert: VeilActionValidationFailuresHigh

Likely causes:

- client/server protocol drift after a deploy or mixed candidate revision
- gameplay desync causing the client to submit actions the authoritative server rejects
- spam, exploit traffic, or a broken automation client hammering invalid actions

Immediate triage commands:

```bash
grep '^veil_action_validation_failures_total' /tmp/project-veil.metrics | sort
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq '{connectionCount: .runtime.connectionCount, gameplayTraffic: .runtime.gameplayTraffic}'
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/diagnostic-snapshot" | jq '.diagnostics.errorSummary'
```

Mitigation steps:

1. Check the metric labels first. A single `reason` or `scope` usually points to one broken interaction rather than general load.
2. If the failures started right after a deploy, stop the rollout or revert the mixed client/server revision before chasing individual rooms.
3. If one automation client or shard is responsible, remove that traffic source and confirm the counter slope drops.
4. If the spike is player-facing, capture a diagnostic snapshot and hand the reason labels to the gameplay owner for a targeted fix.

Escalation thresholds:

- escalate if the alert survives one full extra 15-minute window after the suspect deploy or traffic source is removed
- escalate immediately if the rate exceeds `1.0` failures per second, or if the top reason label indicates a broad protocol/state mismatch rather than one invalid action family

## Alert: VeilHttpRequestLatencyP95High

Likely causes:

- runtime CPU or event-loop saturation from gameplay load
- downstream auth/config dependencies are slow and are backing up request handling
- operators or automation are polling expensive endpoints too aggressively

Immediate triage commands:

```bash
grep '^veil_http_request_duration_seconds_' /tmp/project-veil.metrics | tail -n 20
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/auth-readiness" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/slo-summary" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq '{connectionCount: .runtime.connectionCount, activeRoomCount: .runtime.activeRoomCount, auth: .runtime.auth}'
```

Mitigation steps:

1. Confirm whether the latency spike lines up with high connection count, reconnect backlog, or token-delivery queue growth.
2. If auth-readiness shows queue or dependency trouble, treat the downstream auth path as the likely bottleneck and stabilize that first.
3. If the spike matches operator or automation polling, reduce the polling rate for `/api/runtime/*` diagnostics until latency recovers.
4. If the whole runtime is saturated, shed nonessential traffic or scale out before resuming diagnostics-heavy workflows.

Escalation thresholds:

- escalate if p95 stays above `750ms` for 20 minutes after traffic reduction or dependency recovery work
- escalate immediately if p95 exceeds `1.5s`, if auth-readiness is degraded, or if connected-player and room-density alerts are firing concurrently

## Alert: VeilAnalyticsFlushFailuresHigh

Likely causes:

- `ANALYTICS_ENDPOINT` is unavailable or returning non-2xx responses
- the runtime drifted back to `stdout` because production sink config is incomplete
- the analytics gateway is healthy but backpressure is preventing the local buffer from draining

Immediate triage commands:

```bash
grep '^veil_analytics_' /tmp/project-veil.metrics | sort
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/analytics-pipeline" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/analytics-pipeline?format=text"
```

Mitigation steps:

1. Confirm the sink mode first. If it shows `stdout` in production, restore `ANALYTICS_SINK=http` and `ANALYTICS_ENDPOINT` before chasing downstream delivery.
2. If the sink is already `http`, check whether `veil_analytics_events_buffered` is rising. A rising buffer with new failures means the gateway path is degraded.
3. If the gateway is failing, pause dashboards and alerts that depend on freshness, then route traffic recovery through the analytics/on-call owner.
4. Do not clear or restart the runtime blindly while buffered events are still draining unless the buffer itself is causing broader runtime instability.

Escalation thresholds:

- escalate immediately if failures persist for two consecutive alert windows or if `veil_analytics_events_buffered` continues to rise
- escalate immediately if payment-fraud analytics or session-start drop alerts fire at the same time, because business visibility is already impaired

## Alert: VeilAnalyticsPaymentFraudSignalsHigh

Likely causes:

- duplicate or replayed WeChat callbacks are reaching the payment pipeline
- payer or product mismatches are increasing after a payment-related deploy
- a real fraud/exploit attempt is generating repeated integrity anomalies

Immediate triage commands:

```bash
grep 'veil_analytics_events_flushed_total{name="payment_fraud_signal"' /tmp/project-veil.metrics
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/analytics-pipeline" | jq '.delivery.events[] | select(.name=="payment_fraud_signal")'
```

Mitigation steps:

1. Freeze risky compensation, refund, and rollout actions that depend on payment integrity.
2. Compare the Prometheus spike with the warehouse query in [`docs/analytics-pipeline-runbook.md`](./analytics-pipeline-runbook.md) so you know whether this is isolated or broad.
3. Inspect recent payment callback / verify traffic and confirm whether order ids or payer identifiers repeat.
4. Keep the incident open until the spike subsides and the root cause is documented in the payment or analytics runbook.

Escalation thresholds:

- escalate immediately on first fire during a live payment rollout or candidate promotion
- escalate to payments risk if the alert remains active for more than 15 minutes or warehouse counts keep climbing

## Alert: VeilAnalyticsSessionStartsDropped

Likely causes:

- real player/session starts dropped because login, matchmaking, or room admission is broken
- analytics delivery is degraded, so healthy player traffic is no longer reaching the sink
- routing, release, or regional config changes shifted traffic away from the monitored environment

Immediate triage commands:

```bash
grep 'veil_analytics_events_flushed_total{name="session_start"' /tmp/project-veil.metrics
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq '{connectionCount: .runtime.connectionCount, activeRoomCount: .runtime.activeRoomCount}'
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/analytics-pipeline" | jq .
```

Mitigation steps:

1. Determine whether gameplay traffic and room counts also dropped. If they did, treat this as a player-traffic incident first.
2. If room/player counts look normal but session-start analytics dropped, treat the sink as suspect and inspect `veil_analytics_flush_failures_total` plus `veil_analytics_events_buffered`.
3. Compare the runtime signal with the warehouse DAU/session query before making business-facing claims about the size of the drop.
4. If the issue started with a release or config change, halt rollout promotion until both traffic and analytics freshness are explained.

Escalation thresholds:

- escalate if the drop lasts longer than one additional 30-minute comparison window
- escalate immediately if session-start drop, auth failures, or analytics flush failures are all firing together

## Closeout Checklist

- capture the alert name, environment, and exact trigger window in the incident notes or PR comments
- record which commands were run and whether the runtime endpoints were reachable
- link any follow-up fix, rollback, or evidence refresh task before closing the incident
