# MySQL Persistence

## Overview

Project Veil now persists authoritative room snapshots to MySQL so a room can be recovered after a server restart.

The current persistence scope is:

- World state snapshot
- All active battle snapshots in the room
- Per-player room progress snapshot
- Per-player account progression snapshot
- Per-player append-only event history read model
- Config center documents for `world`, `mapObjects`, and `units`

Snapshots are stored as serialized JSON strings for compatibility with older MySQL versions.

## Environment Variables

The server reads these variables on startup:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VEIL_MYSQL_HOST` | Yes | - | MySQL host |
| `VEIL_MYSQL_PORT` | No | `3306` | MySQL port |
| `VEIL_MYSQL_USER` | Yes | - | MySQL username |
| `VEIL_MYSQL_PASSWORD` | Yes | - | MySQL password |
| `VEIL_MYSQL_DATABASE` | No | `project_veil` | Database name |
| `VEIL_MYSQL_POOL_CONNECTION_LIMIT` | No | `4` | Max concurrent connections opened by each Project Veil MySQL pool (`room_snapshot`, `config_center`, migration tooling) |
| `VEIL_MYSQL_POOL_MAX_IDLE` | No | `4` | Max idle connections retained by each MySQL pool |
| `VEIL_MYSQL_POOL_IDLE_TIMEOUT_MS` | No | `60000` | Idle-connection timeout for each MySQL pool |
| `VEIL_MYSQL_POOL_QUEUE_LIMIT` | No | `0` | Queue depth cap when the pool is saturated. `0` keeps mysql2's unbounded queue behavior |
| `VEIL_MYSQL_POOL_WAIT_FOR_CONNECTIONS` | No | `true` | Whether callers wait for a free pooled connection instead of failing immediately |
| `VEIL_MYSQL_SNAPSHOT_TTL_HOURS` | No | `72` | Snapshot retention window in hours. Set `0` or a negative value to disable expiry |
| `VEIL_MYSQL_SNAPSHOT_CLEANUP_INTERVAL_MINUTES` | No | `30` | Periodic cleanup interval in minutes. Set `0` or a negative value to disable scheduled cleanup |

## Database And Table

### Database

- Name: `project_veil`
- Character set: `utf8mb4`
- Collation: `utf8mb4_unicode_ci`

### Table: `room_snapshots`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `room_id` | `VARCHAR(191)` | No | - | Logical room id, primary key |
| `state_json` | `LONGTEXT` | No | - | Serialized `WorldState` JSON |
| `battles_json` | `LONGTEXT` | No | - | Serialized active `BattleState[]` JSON |
| `version` | `BIGINT UNSIGNED` | No | `1` | Incremented on every upsert |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | First persistence time |
| `updated_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Last persistence time |

Recommended index:

- `idx_room_snapshots_updated_at` on `updated_at`

### Table: `player_room_profiles`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `room_id` | `VARCHAR(191)` | No | - | Logical room id |
| `player_id` | `VARCHAR(191)` | No | - | Player id inside the room |
| `heroes_json` | `LONGTEXT` | No | - | Serialized owned `HeroState[]`, including hero progression fields such as `level`, `experience`, and battle win counters |
| `resources_json` | `LONGTEXT` | No | - | Serialized per-player resource ledger |
| `version` | `BIGINT UNSIGNED` | No | `1` | Incremented on every upsert |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | First persistence time |
| `updated_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Last persistence time |

Recommended index:

- `idx_player_room_profiles_updated_at` on `updated_at`

When loading older snapshots that predate hero progression, the server will backfill default progression values before the room is restored.

### Table: `player_accounts`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `player_id` | `VARCHAR(191)` | No | - | Player id, primary key |
| `display_name` | `VARCHAR(80)` | Yes | `NULL` | Public display name |
| `global_resources_json` | `LONGTEXT` | No | - | Serialized account-wide resource ledger |
| `achievements_json` | `LONGTEXT` | Yes | `NULL` | Serialized achievement progress snapshot |
| `recent_event_log_json` | `LONGTEXT` | Yes | `NULL` | Serialized compact recent event snapshot used by `/event-log` and `/progression` |
| `recent_battle_replays_json` | `LONGTEXT` | Yes | `NULL` | Serialized recent battle replay summaries |
| `last_room_id` | `VARCHAR(191)` | Yes | `NULL` | Last room seen for this account |
| `last_seen_at` | `DATETIME` | Yes | `NULL` | Last known activity timestamp |
| `login_id` | `VARCHAR(40)` | Yes | `NULL` | Bound login id for credential auth |
| `account_session_version` | `BIGINT UNSIGNED` | No | `0` | Monotonic account session family version used to revoke access tokens |
| `refresh_session_id` | `VARCHAR(64)` | Yes | `NULL` | Current active refresh-token family id |
| `refresh_token_hash` | `VARCHAR(255)` | Yes | `NULL` | Server-side hash of the currently active refresh token |
| `refresh_token_expires_at` | `DATETIME` | Yes | `NULL` | Expiry timestamp for the active refresh token |
| `password_hash` | `VARCHAR(255)` | Yes | `NULL` | Stored password hash |
| `credential_bound_at` | `DATETIME` | Yes | `NULL` | First credential bind time |
| `version` | `BIGINT UNSIGNED` | No | `1` | Incremented on every upsert |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | First persistence time |
| `updated_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Last persistence time |

Recommended indexes:

- `idx_player_accounts_updated_at` on `updated_at`
- `uidx_player_accounts_login_id` unique on `login_id`

### Table: `player_event_history`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `player_id` | `VARCHAR(191)` | No | - | Player id |
| `event_id` | `VARCHAR(191)` | No | - | Stable event log id within the player timeline |
| `timestamp` | `DATETIME` | No | - | Event time used for history ordering |
| `room_id` | `VARCHAR(191)` | No | - | Source room id |
| `category` | `VARCHAR(32)` | No | - | Event category for lightweight filtering |
| `hero_id` | `VARCHAR(191)` | Yes | `NULL` | Optional hero id filter key |
| `world_event_type` | `VARCHAR(64)` | Yes | `NULL` | Optional world event type filter key |
| `achievement_id` | `VARCHAR(64)` | Yes | `NULL` | Optional achievement id filter key |
| `entry_json` | `LONGTEXT` | No | - | Serialized `EventLogEntry` payload |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | First persistence time |

Primary key:

- `(player_id, event_id)`

Recommended index:

- `idx_player_event_history_player_time` on `(player_id, timestamp)`

The server appends only newly seen `recentEventLog` entries into this table when player account progress is saved. This keeps the existing compact snapshot read model intact while exposing a paged `/api/player-accounts/:playerId/event-history` API for player-facing history views.

The event history routes support the existing `category` / `heroId` / `achievementId` / `worldEventType` filters, plus optional inclusive `since` and `until` ISO-8601 timestamps. MySQL-backed queries push those time-range predicates down into SQL so player history views can page within a bounded time window without scanning unrelated rows.

Issue #27 follow-up note: event-log and achievement history queries now share a single normalization contract in `packages/shared/src/event-log.ts`. Route handlers and MySQL persistence both reuse that helper so trimming, pagination clamping, and ISO timestamp coercion stay consistent before full event-log persistence and richer achievement views land.

### Table: `config_documents`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `document_id` | `VARCHAR(64)` | No | - | Config document id, currently `world`, `mapObjects`, or `units` |
| `content_json` | `LONGTEXT` | No | - | Serialized config JSON |
| `version` | `BIGINT UNSIGNED` | No | `1` | Incremented on every successful save |
| `exported_at` | `DATETIME` | Yes | `NULL` | Last time this row was exported back to `configs/*.json` |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | First persistence time |
| `updated_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Last persistence time |

Recommended index:

- `idx_config_documents_updated_at` on `updated_at`

The config center uses this table as the source of truth when MySQL is enabled. On startup, the server loads these rows, applies them to runtime, and exports the normalized JSON back to the local `configs/` directory.

## Cleanup Strategy

The current cleanup strategy is:

- Load-time expiry: if a snapshot is older than the configured TTL, it is treated as expired and deleted before the room can be restored.
- Startup cleanup: when the server starts, it immediately prunes expired snapshots.
- Periodic cleanup: the server keeps deleting expired snapshots on a fixed interval.

Default behavior:

- Keep snapshots for `72` hours
- Run cleanup every `30` minutes

This gives us a safe recovery window after server restarts without letting `room_snapshots` grow forever.

## Initialization

The repository now uses versioned migrations under `scripts/migrations/`.

- Apply pending migrations: `npm run db:migrate`
- Roll back the most recent migration: `npm run db:migrate:rollback`
- Fresh setup alias: `npm run db:init:mysql`

`db:init:mysql` now delegates to the same migration runner used for upgrades, so fresh installs and existing environments follow a single schema path. The runner records applied versions in `schema_migrations` with `id`, `name`, and `applied_at`.

If the dev server starts with `VEIL_MYSQL_*` configured but the schema is behind, it logs a warning and falls back to local in-memory room persistence plus filesystem config storage instead of mutating the database implicitly. Run `npm run db:migrate` first for MySQL-backed startup.

## Manual Operations

The repository includes manual room snapshot management commands:

- `npm run db:snapshots:list -- --limit 20`
- `npm run db:snapshots:delete -- --roomId test-room`
- `npm run db:snapshots:prune`

These commands are useful when you want to inspect retained rooms, delete a specific room snapshot, or force a cleanup immediately.

The repository also includes manual player profile management commands:

- `npm run db:profiles:list -- --limit 20`
- `npm run db:profiles:list -- --roomId test-room`
- `npm run db:profiles:list -- --playerId player-1`
- `npm run db:profiles:delete -- --roomId test-room --playerId player-1`
- `npm run db:profiles:prune`

These commands are useful when you want to inspect retained per-player room progress, delete a specific player profile row, or force profile cleanup immediately.

## Automated Backup To Object Storage

Project Veil also includes [`scripts/db-backup.sh`](../scripts/db-backup.sh) for full MySQL backups to S3-compatible object storage.

The script performs:

- `mysqldump` full export with `--single-transaction`
- gzip compression
- SHA-256 hash generation beside the archive
- immediate checksum self-verification before upload
- upload to a daily object prefix
- weekly mirror upload on the configured weekday
- retention pruning for daily backups older than 30 days and weekly backups older than 183 days
- optional failure notification through `VEIL_BACKUP_NOTIFY_COMMAND`

### Required Environment

The backup script reuses the existing `VEIL_MYSQL_*` connection settings and expects:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VEIL_BACKUP_S3_BUCKET` | Yes | - | Target object storage bucket |
| `VEIL_BACKUP_S3_PREFIX` | No | `backups/mysql` | Object prefix under the bucket |
| `VEIL_BACKUP_S3_ENDPOINT` | No | - | Custom S3-compatible endpoint URL for OSS/COS/minio-style storage |
| `VEIL_BACKUP_S3_REGION` | No | `us-east-1` | AWS CLI region passed to upload/list/delete commands |
| `VEIL_BACKUP_AWS_PROFILE` | No | - | Optional AWS CLI profile name |
| `VEIL_BACKUP_KEEP_DAILY_DAYS` | No | `30` | Daily retention window in days |
| `VEIL_BACKUP_KEEP_WEEKLY_DAYS` | No | `183` | Weekly retention window in days |
| `VEIL_BACKUP_WEEKLY_DAY` | No | `7` | Day of week used for weekly copies; `7` means Sunday |
| `VEIL_BACKUP_NOTIFY_COMMAND` | No | - | Shell command executed on failure with `VEIL_BACKUP_FAILURE_MESSAGE` exported |

The script requires `mysqldump`, `gzip`, `aws`, and `sha256sum` (or `shasum`) on the runner host.

### Manual Dry Run

Use a real bucket and run one manual backup before installing cron:

```bash
./scripts/db-backup.sh
```

Successful output ends with:

```text
[db-backup] Backup complete: project_veil-<timestamp>.sql.gz
```

The uploaded object layout is:

- `s3://<bucket>/<prefix>/daily/<database>-<timestamp>.sql.gz`
- `s3://<bucket>/<prefix>/daily/<database>-<timestamp>.sql.gz.sha256`
- `s3://<bucket>/<prefix>/weekly/<database>-<timestamp>.sql.gz` on the configured weekly day
- `s3://<bucket>/<prefix>/weekly/<database>-<timestamp>.sql.gz.sha256` on the configured weekly day

### Cron Schedule

Install the example cron from [`ops/mysql-backup.cron.example`](../ops/mysql-backup.cron.example) to run at `03:00` server local time every day.

Recommended rollout:

1. Copy `.env.example` to the deployment host and fill in `VEIL_MYSQL_*` plus `VEIL_BACKUP_*`.
2. Confirm `aws s3 ls` can reach the bucket with the selected profile or credentials.
3. Run `./scripts/db-backup.sh` manually once.
4. Install the cron entry.
5. Wire `VEIL_BACKUP_NOTIFY_COMMAND` to your pager, webhook, or mail wrapper so failures are visible without waiting for cron mail.

### Restore

Use [`docs/db-restore-runbook.md`](./db-restore-runbook.md) to download a timestamped backup, verify the hash, restore into a fresh instance, and validate the recovered data with the existing MySQL persistence regression.

For a repeatable operator drill, run the new rehearsal wrapper:

```bash
VEIL_RESTORE_BACKUP_KEY="backups/mysql/daily/project_veil-20260403T030000Z.sql.gz" \
RESTORE_MYSQL_HOST=127.0.0.1 \
RESTORE_MYSQL_PORT=3306 \
RESTORE_MYSQL_USER=root \
RESTORE_MYSQL_PASSWORD=change_me \
RESTORE_MYSQL_DATABASE=project_veil_restore \
npm run db:restore:rehearsal
```

That flow downloads the archive and `.sha256`, verifies integrity before touching MySQL, restores into the target schema, runs the table-count sanity query, and then executes `npm run test:phase1-release-persistence -- --storage mysql` against the recovered instance unless `VEIL_RESTORE_SKIP_REGRESSION=1`.

## MySQL Alerting

`/metrics` now exports `veil_mysql_pool_connection_limit`, `veil_mysql_pool_connections_active`, `veil_mysql_pool_connections_idle`, `veil_mysql_pool_queue_depth`, and `veil_mysql_pool_connection_utilization_ratio` for the long-lived `room_snapshot` and `config_center` pools. Use those together with the `VeilMySqlPoolPressureHigh` alert in [`docs/alerting-rules.yml`](./alerting-rules.yml) when sizing the server-side pools.

Replication lag alerting depends on your MySQL exporter exposing `mysql_slave_status_seconds_behind_master`. Project Veil documents the threshold and response flow in the same alerting bundle so HA drills and backup restore drills use one source of truth.

## Release Regression

Use the Phase 1 release regression when you need one bounded proof that MySQL persistence and shipped config/content data are healthy together:

- Local/default mode: `npm run test:phase1-release-persistence`
- Additional Phase 1 pack (`frontier-basin`): `npm run test:phase1-release-persistence:frontier`
- Additional Phase 1 pack (`stonewatch-fork`): `npm run test:phase1-release-persistence:stonewatch`
- Second Phase 1 pack (`ridgeway-crossing`): `npm run test:phase1-release-persistence:ridgeway`
- Additional shipped Phase 1 pack (`highland-reach`): `npm run test:phase1-release-persistence:highland`
- Release-target MySQL mode: `npm run test:phase1-release-persistence -- --storage mysql`

The command writes a JSON artifact under `artifacts/release-readiness/`, validates the shipped Phase 1 content packs, saves representative player/account/world progression through the persistence store, and verifies fresh-room hydration still restores long-term account + hero data while resetting room-local position/readiness. Pass `--map-pack frontier-basin`, `--map-pack stonewatch-fork`, `--map-pack ridgeway-crossing`, or `--map-pack highland-reach` when you need the persistence proof on one of the alternate Phase 1 layouts without changing the validation bundle.
