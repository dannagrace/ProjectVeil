# Project Veil Alerting Runbook

Use this runbook when Prometheus fires one of the runtime alerts defined in [`docs/alerting-rules.yml`](./alerting-rules.yml).

The commands below assume the runtime is reachable at `http://127.0.0.1:2567`. Override that first when you are targeting another environment:

```bash
export VEIL_RUNTIME_URL="${VEIL_RUNTIME_URL:-http://127.0.0.1:2567}"
```

MySQL replication alerts also need an exporter or Prometheus target that exposes the database metrics:

```bash
export VEIL_MYSQL_EXPORTER_METRICS_URL="${VEIL_MYSQL_EXPORTER_METRICS_URL:-http://127.0.0.1:9104/metrics}"
export VEIL_MYSQL_REPLICA_HOST="${VEIL_MYSQL_REPLICA_HOST:-127.0.0.1}"
export VEIL_MYSQL_REPLICA_PORT="${VEIL_MYSQL_REPLICA_PORT:-3306}"
export VEIL_MYSQL_REPLICA_USER="${VEIL_MYSQL_REPLICA_USER:-root}"
export VEIL_MYSQL_REPLICA_PASSWORD="${VEIL_MYSQL_REPLICA_PASSWORD:-change_me}"
```

## Shared Triage Commands

Start every incident with the same four snapshots so the alert has current context:

```bash
curl -fsS "$VEIL_RUNTIME_URL/metrics" > /tmp/project-veil.metrics
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/auth-readiness" | jq .
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

## Alert: VeilMySqlPoolPressureHigh

Likely causes:

- the `room_snapshot` pool is saturated by a persistence backlog or slow MySQL response times
- the `config_center` pool is backing up on exports or config write bursts
- pool sizing is too small for the current room count, or MySQL itself is slow enough that callers stack up behind a healthy-looking app runtime

Immediate triage commands:

```bash
grep '^veil_mysql_pool_' /tmp/project-veil.metrics | sort
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq '{activeRoomCount: .runtime.activeRoomCount, connectionCount: .runtime.connectionCount, activeBattleCount: .runtime.activeBattleCount}'
```

Mitigation steps:

1. Check whether `veil_mysql_pool_queue_depth` is non-zero or whether utilization is simply hovering near the configured cap. Queue depth means callers are already waiting.
2. If the queue is growing, inspect recent MySQL latency, lock contention, and replication health before only increasing pool limits.
3. If MySQL is healthy but utilization is consistently above `0.8`, raise `VEIL_MYSQL_POOL_CONNECTION_LIMIT` conservatively and keep `maxIdle` aligned with the new steady-state expectation.
4. If pressure is isolated to one pool label, treat that subsystem first: snapshot pressure points to persistence/save load, while config-center pressure points to operator workflows or config churn.

Escalation thresholds:

- escalate if queue depth stays above `0` for 20 minutes after load reduction or pool tuning
- escalate immediately if utilization reaches `1.0`, if HTTP latency is also elevated, or if persistence-related error logs begin surfacing

## Alert: VeilMySqlReplicationLagHigh

Likely causes:

- replica IO or SQL threads are stalled
- the primary is producing writes faster than the replica can apply them
- storage, network, or long-running queries are blocking replica catch-up

Immediate triage commands:

```bash
curl -fsS "$VEIL_MYSQL_EXPORTER_METRICS_URL" > /tmp/project-veil.mysql-exporter.metrics
grep '^mysql_slave_status_seconds_behind_master' /tmp/project-veil.mysql-exporter.metrics
mysql --host="$VEIL_MYSQL_REPLICA_HOST" --port="$VEIL_MYSQL_REPLICA_PORT" --user="$VEIL_MYSQL_REPLICA_USER" --password="$VEIL_MYSQL_REPLICA_PASSWORD" -e "SHOW REPLICA STATUS\\G"
```

Mitigation steps:

1. Confirm the lag is real and not an exporter scrape anomaly. Compare Prometheus values with `SHOW REPLICA STATUS`.
2. Pause failover, backup-promotion, or restore cutover decisions while lag exceeds the RPO threshold.
3. If the replica threads are stopped or erroring, fix that first before evaluating whether a new replica or restore target is needed.
4. If lag is caused by sustained write pressure, reduce nonessential write traffic and re-check the relay/apply backlog before promoting any recovery workflow.

Escalation thresholds:

- escalate if lag remains above `30s` for another 15 minutes after replica recovery work starts
- escalate immediately if lag exceeds `300s`, if replica threads stop, or if a restore/failover incident is active at the same time

## Closeout Checklist

- capture the alert name, environment, and exact trigger window in the incident notes or PR comments
- record which commands were run and whether the runtime endpoints were reachable
- link any follow-up fix, rollback, or evidence refresh task before closing the incident
