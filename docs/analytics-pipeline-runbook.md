# Analytics Pipeline Runbook

Issue #1202 promotes the existing analytics contract into an explicit production pipeline. The server now exposes the active sink and delivery counters at `/api/runtime/analytics-pipeline`, and both server-emitted events plus batches accepted on `/api/analytics/events` flow through the same buffered delivery path.

## Production Topology

Production sink target:

1. Game server and Cocos client emit versioned events from [`packages/shared/src/analytics-events.ts`](/home/gpt/project/ProjectVeil/packages/shared/src/analytics-events.ts).
2. The Project Veil server buffers those events and flushes them to `ANALYTICS_ENDPOINT` when `ANALYTICS_SINK=http`.
3. The HTTP analytics gateway persists the raw envelope into object storage at `ANALYTICS_RAW_BUCKET`, then writes flattened rows into ClickHouse table `${ANALYTICS_WAREHOUSE_DATASET}.${ANALYTICS_WAREHOUSE_EVENTS_TABLE}`.
4. Ops, growth, and payments query the curated ClickHouse table for live KPI checks and alert investigations.

Issue #1227 adds the client-side `client_perf_degraded` event for WeChat/Cocos runtime degradation. The Cocos client emits it only in production analytics mode when either FPS stays below `20` for `5s` or heap usage rises above `80%`, and it is throttled to at most one event per minute per running client session.

Local/dev fallback:

- If `ANALYTICS_SINK` is unset and no endpoint is configured, the runtime falls back to `stdout` and still exposes the same counters through `/api/runtime/analytics-pipeline` and `/metrics`.

## Required Runtime Config

| Variable | Required in prod | Default | Purpose |
| --- | --- | --- | --- |
| `ANALYTICS_SINK` | Yes | `stdout` unless endpoint is present | `http` for production delivery, `stdout` for local smoke |
| `ANALYTICS_ENDPOINT` | Yes when `ANALYTICS_SINK=http` | - | Analytics gateway ingest URL |
| `ANALYTICS_WAREHOUSE_DATASET` | Yes | `analytics_prod` | Curated warehouse dataset/database name surfaced in runtime status |
| `ANALYTICS_WAREHOUSE_EVENTS_TABLE` | Yes | `veil_analytics_events` | Curated events table surfaced in runtime status |
| `ANALYTICS_RAW_BUCKET` | Yes | `s3://project-veil-analytics-prod/raw` | Raw envelope/object archive location |
| `ANALYTICS_RETENTION_DAYS` | Yes | `400` | Retention window for curated event rows |
| `ANALYTICS_DELETION_WORKFLOW` | Yes | `dsr-player-delete` | Human-readable DSR/delete workflow id shown in runtime status |

Production bootstrap example:

```bash
export ANALYTICS_SINK=http
export ANALYTICS_ENDPOINT=https://analytics.projectveil.example/ingest
export ANALYTICS_WAREHOUSE_DATASET=analytics_prod
export ANALYTICS_WAREHOUSE_EVENTS_TABLE=veil_analytics_events
export ANALYTICS_RAW_BUCKET=s3://project-veil-analytics-prod/raw
export ANALYTICS_RETENTION_DAYS=400
export ANALYTICS_DELETION_WORKFLOW=dsr-player-delete
```

Operator verification:

```bash
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/analytics-pipeline" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/analytics-pipeline?format=text"
curl -fsS "$VEIL_RUNTIME_URL/metrics" | grep '^veil_analytics_'
```

## Warehouse Schema

Curated ClickHouse table shape:

```sql
CREATE TABLE analytics_prod.veil_analytics_events (
  event_at DateTime64(3, 'UTC'),
  event_date Date MATERIALIZED toDate(event_at),
  name LowCardinality(String),
  version UInt16,
  source LowCardinality(String),
  player_id String,
  session_id Nullable(String),
  platform Nullable(String),
  room_id Nullable(String),
  payload_json String,
  ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, name, player_id, event_at);
```

Notes:

- `payload_json` stores the exact event payload; flatten hot fields in materialized views only when a dashboard needs them.
- Prefer `source='server'` for KPI queries that should not double-count matching client events.
- Keep the raw object archive for replay/audit, but drive dashboards and alerts from the curated table.

## Event Payload Reference

| Event | Payload fields | Notes |
| --- | --- | --- |
| `session_end` | `roomId`, `disconnectReason`, `sessionDurationMs` | Emitted when a room transport closes or the room disposes. |
| `purchase_completed` | `purchaseId`, `productId`, `paymentMethod`, `quantity`, `totalPrice` | Emitted only after rewards are granted successfully. |
| `purchase_failed` | `purchaseId`, `productId`, `paymentMethod`, `failureReason`, `orderStatus` | Emitted when a purchase cannot grant rewards or fails before completion. |
| `tutorial_step` | `stepId`, `status` | Tutorial completion remains `tutorial_step` with `stepId = tutorial_completed`; no standalone `tutorial_completed` event is introduced in this change. |

## Core KPI Queries

### DAU

```sql
SELECT
  toDate(event_at) AS day,
  uniqExact(player_id) AS dau
FROM analytics_prod.veil_analytics_events
WHERE name = 'session_start'
  AND source = 'server'
  AND event_at >= today() - 7
GROUP BY day
ORDER BY day DESC;
```

### Tutorial Completion Rate

```sql
WITH
  started AS (
    SELECT uniqExact(player_id) AS players
    FROM analytics_prod.veil_analytics_events
    WHERE name = 'session_start'
      AND source = 'server'
      AND event_at >= toStartOfDay(now())
  ),
  completed AS (
    SELECT uniqExact(player_id) AS players
    FROM analytics_prod.veil_analytics_events
    WHERE name = 'tutorial_step'
      AND JSONExtractString(payload_json, 'stepId') = 'tutorial_completed'
      AND JSONExtractString(payload_json, 'status') = 'completed'
      AND event_at >= toStartOfDay(now())
  )
SELECT
  started.players AS started_players,
  completed.players AS completed_players,
  round(completed.players / greatest(started.players, 1), 4) AS tutorial_completion_rate
FROM started, completed;
```

### Purchase Conversion

```sql
WITH
  dau AS (
    SELECT uniqExact(player_id) AS players
    FROM analytics_prod.veil_analytics_events
    WHERE name = 'session_start'
      AND source = 'server'
      AND event_at >= toStartOfDay(now())
  ),
  purchasers AS (
    SELECT uniqExact(player_id) AS players
    FROM analytics_prod.veil_analytics_events
    WHERE name = 'purchase_completed'
      AND source = 'server'
      AND event_at >= toStartOfDay(now())
  )
SELECT
  dau.players AS dau,
  purchasers.players AS purchasers,
  round(purchasers.players / greatest(dau.players, 1), 4) AS purchase_conversion_rate
FROM dau, purchasers;
```

### Session Duration

```sql
SELECT
  toDate(event_at) AS day,
  round(avg(JSONExtractFloat(payload_json, 'sessionDurationMs')) / 1000, 2) AS avg_session_duration_seconds,
  count() AS sessions_ended
FROM analytics_prod.veil_analytics_events
WHERE name = 'session_end'
  AND source = 'server'
  AND event_at >= today() - 7
GROUP BY day
ORDER BY day DESC;
```

### Purchase Failures

```sql
SELECT
  toDate(event_at) AS day,
  JSONExtractString(payload_json, 'failureReason') AS failure_reason,
  count() AS failures
FROM analytics_prod.veil_analytics_events
WHERE name = 'purchase_failed'
  AND source = 'server'
  AND event_at >= today() - 7
GROUP BY day, failure_reason
ORDER BY day DESC, failures DESC;
```

## Payment Fraud And Session Drop Monitoring

Prometheus now exposes:

- `veil_analytics_ingested_events_total{name,source}`
- `veil_analytics_events_flushed_total{name,source}`
- `veil_analytics_flush_failures_total`
- `veil_analytics_events_buffered`
- `veil_analytics_sink_configured{sink}`

Use those signals for near-real-time operational alerting. Warehouse queries remain the source for deeper RCA and business reporting.

## Compliance: Export, Delete, Retention

Player export flow:

1. Support verifies account ownership and records the ticket id.
2. Query `analytics_prod.veil_analytics_events` by `player_id` and export rows for the requested time window.
3. Include the raw `payload_json` plus event metadata in the export bundle.
4. Deliver through the approved support channel and log the export timestamp in the ticket.

Player deletion flow (`ANALYTICS_DELETION_WORKFLOW=dsr-player-delete`):

1. Insert the player id and ticket id into the DSR queue used by the analytics gateway.
2. Gateway writes a delete tombstone and issues a ClickHouse `ALTER TABLE ... DELETE WHERE player_id = ?`.
3. Raw object storage is filtered by player id during the next retention compaction run; raw data may persist for up to 30 days until compaction completes.
4. Support closes the request only after ClickHouse rows are gone and the compaction job has acknowledged the raw archive tombstone.

Retention policy:

- Curated ClickHouse rows: `ANALYTICS_RETENTION_DAYS` with current production target `400` days.
- Raw object archive: `30` days hot retention, then delete after compaction confirms no open DSR tombstones.
- Access: read access limited to ops-oncall, data engineering, payments risk, and designated growth analysts; write/delete access stays with platform operators only.

## Failure Triage

If delivery health degrades:

1. Check `/api/runtime/analytics-pipeline` for sink mode, pending buffer size, and last error.
2. Check `/metrics` for `veil_analytics_flush_failures_total`, `veil_analytics_events_buffered`, and whether `session_start` / `payment_fraud_signal` counters are still moving.
3. If the sink is `stdout` unexpectedly, treat that as a config drift incident and restore `ANALYTICS_SINK=http` plus `ANALYTICS_ENDPOINT`.
4. If the gateway is down, keep the runtime buffer under review, pause dashboards that assume freshness, and escalate via the alerts in [`docs/alerting-rules.yml`](/home/gpt/project/ProjectVeil/docs/alerting-rules.yml).
