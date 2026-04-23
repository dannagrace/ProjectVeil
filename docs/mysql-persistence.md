# MySQL Persistence

## Overview

Project Veil now persists authoritative room snapshots to MySQL so a room can be recovered after a server restart.

The current persistence scope is:

- World state snapshot
- All active battle snapshots in the room
- Per-player room progress snapshot
- Per-player account progression snapshot
- Per-player append-only event history read model
- Guild roster snapshots plus guild moderation audit history
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
| `VEIL_MYSQL_SSL_MODE` | No | `disabled` | Transport mode for MySQL connections: `disabled`, `required`, or `verify-ca`. Production startup now rejects `disabled` so managed deployments must opt into TLS explicitly |
| `VEIL_MYSQL_SSL_CA_PATH` | No | - | Optional PEM CA bundle path used when `VEIL_MYSQL_SSL_MODE=verify-ca`; omit it to use the runtime's default trust store |
| `VEIL_MYSQL_POOL_CONNECTION_LIMIT` | No | `4` | Max concurrent connections opened by each Project Veil MySQL pool (`room_snapshot`, `config_center`, migration tooling) |
| `VEIL_MYSQL_POOL_MAX_IDLE` | No | `4` | Max idle connections retained by each MySQL pool |
| `VEIL_MYSQL_POOL_IDLE_TIMEOUT_MS` | No | `60000` | Idle-connection timeout for each MySQL pool |
| `VEIL_MYSQL_POOL_QUEUE_LIMIT` | No | `128` | Queue depth cap when the pool is saturated. Use `0` only for local development or controlled tests that intentionally exercise mysql2's unbounded queue behavior |
| `VEIL_MYSQL_POOL_WAIT_FOR_CONNECTIONS` | No | `true` | Whether callers wait for a free pooled connection instead of failing immediately |
| `VEIL_MYSQL_SNAPSHOT_TTL_HOURS` | No | `72` | Snapshot retention window in hours. Set `0` or a negative value to disable expiry |
| `VEIL_MYSQL_SNAPSHOT_CLEANUP_INTERVAL_MINUTES` | No | `30` | Periodic cleanup interval in minutes. Set `0` or a negative value to disable scheduled cleanup |
| `VEIL_PLAYER_NAME_HISTORY_TTL_DAYS` | No | `90` | Player name history retention window in days. Set `0` or a negative value to disable expiry |
| `VEIL_PLAYER_NAME_HISTORY_CLEANUP_INTERVAL_MINUTES` | No | `1440` | Periodic player-name-history cleanup interval in minutes. Set `0` or a negative value to disable scheduled cleanup |
| `VEIL_PLAYER_NAME_HISTORY_CLEANUP_BATCH_SIZE` | No | `1000` | Maximum expired `player_name_history` rows deleted per cleanup pass |
| `VEIL_DISPLAY_NAME_RULES_PATH` | No | `configs/display-name-rules.json` | Display-name moderation rules file path. The server hot-reloads this file without a redeploy |
| `VEIL_DISPLAY_NAME_RULES_RELOAD_INTERVAL_MS` | No | `30000` | How often the server rechecks the display-name rules file for updates |
| `VEIL_DISPLAY_NAME_RULES_JSON` | No | - | Optional JSON override for display-name moderation rules, useful for ops validation |

### TLS modes

- `disabled`: do not send an `ssl` option to mysql2. This remains acceptable for local development only.
- `required`: encrypt transport, but do not verify the server certificate. Use this only as an intermediate step when the server presents a certificate chain the runtime does not trust yet.
- `verify-ca`: encrypt transport and require certificate validation. If `VEIL_MYSQL_SSL_CA_PATH` is set, Project Veil reads that PEM bundle and passes it to mysql2; otherwise Node's default trust store is used.

When `NODE_ENV=production`, Project Veil now rejects `VEIL_MYSQL_SSL_MODE=disabled` during MySQL config bootstrap so the server cannot silently fall back to plaintext database traffic.

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

### Table: `battle_snapshots`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `room_id` | `VARCHAR(191)` | No | - | Logical room id |
| `battle_id` | `VARCHAR(191)` | No | - | Battle id inside the room |
| `hero_id` | `VARCHAR(191)` | No | - | Attacking hero id |
| `attacker_player_id` | `VARCHAR(191)` | No | - | Attacker player id |
| `defender_player_id` | `VARCHAR(191)` | Yes | `NULL` | Defender player id for PvP battles |
| `defender_hero_id` | `VARCHAR(191)` | Yes | `NULL` | Defender hero id for PvP battles |
| `neutral_army_id` | `VARCHAR(191)` | Yes | `NULL` | Neutral army id for PvE battles |
| `encounter_kind` | `VARCHAR(16)` | No | - | `neutral` or `hero` |
| `initiator` | `VARCHAR(16)` | Yes | `NULL` | Who initiated the encounter |
| `path_json` | `LONGTEXT` | No | - | Serialized battle-start path used to enter the encounter |
| `move_cost` | `INT` | No | - | Movement cost consumed when battle started |
| `player_ids_json` | `LONGTEXT` | No | - | Serialized participant player id list |
| `initial_state_json` | `LONGTEXT` | No | - | Serialized starting `BattleState` snapshot |
| `estimated_compensation_grant_json` | `LONGTEXT` | Yes | `NULL` | Serialized conservative compensation estimate used when a neutral battle cannot be restored |
| `status` | `VARCHAR(16)` | No | `active` | `active`, `resolved`, `compensated`, or `aborted` |
| `result` | `VARCHAR(32)` | Yes | `NULL` | Final result when the battle settled normally |
| `resolution_reason` | `VARCHAR(64)` | Yes | `NULL` | Why the record left `active` |
| `compensation_json` | `LONGTEXT` | Yes | `NULL` | Serialized compensation/notice payload delivered to affected players |
| `started_at` | `DATETIME` | No | - | Logical battle start time |
| `resolved_at` | `DATETIME` | Yes | `NULL` | Logical settlement or compensation time |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Row insertion time |
| `updated_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Last mutation time |

Primary key:

- `(room_id, battle_id)`

Recommended index:

- `idx_battle_snapshots_status_updated` on `(status, updated_at DESC)`

This table is an ops/support ledger separate from `room_snapshots`. It is written on `battle.started`, updated on `battle.resolved`, and later marked `compensated` or `aborted` if a player reconnects after the original room vanished. Support export flows can query this history to inspect both normal settlements and interrupted battles.

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

### Table: `player_name_history`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | No | auto increment | Stable history row id |
| `player_id` | `VARCHAR(191)` | No | - | Player id |
| `display_name` | `VARCHAR(80)` | No | - | Display name snapshot before/after a rename |
| `normalized_name` | `VARCHAR(191)` | No | - | NFKC + lowercase + punctuation-stripped lookup key for support tooling |
| `changed_at` | `DATETIME` | No | - | Logical rename timestamp |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Row insertion time |

Recommended indexes:

- `idx_player_name_history_player_changed` on `(player_id, changed_at DESC)`
- `idx_player_name_history_normalized_changed` on `(normalized_name, changed_at DESC)`
- `idx_player_name_history_changed_at` on `(changed_at)`

This append-only table records the initial display name and every subsequent rename accepted by the server. Admin/support tooling can query by `player_id` to inspect a single account timeline or by `normalized_name` to trace who previously used a suspicious name.

MySQL-backed server startup now prunes expired rows immediately, then repeats on the configured cleanup interval. The default retention window is `90` days and each pass deletes up to `1000` rows ordered by oldest `changed_at` first so historical PII no longer persists indefinitely by default.

## Guest Upgrade Transaction

微信游客升级现在通过单个服务端事务完成，事务边界覆盖：

- `player_accounts` 目标账号写入与旧 `guest-*` 账号 tombstone 标记（`guest_migrated_to_player_id`）
- `player_hero_archives` 从游客档迁移到目标账号，或在保留正式档时直接清理旧游客档
- `player_quest_states` 跟随同一策略迁移或保留
- `player_account_sessions` 清理旧游客关联的持久化会话痕迹

因此迁移失败时不会留下“账号已绑定但英雄/任务没迁完”的半完成状态。

### Table: `player_name_reservations`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | No | auto increment | Stable reservation row id |
| `player_id` | `VARCHAR(191)` | No | - | Source banned player id that caused the reservation |
| `display_name` | `VARCHAR(80)` | No | - | Most recent reserved display name snapshot |
| `normalized_name` | `VARCHAR(191)` | No | - | Lookup key used to block impersonation attempts |
| `reserved_until` | `DATETIME` | No | - | Expiry timestamp; names from banned accounts are reserved for 7 days |
| `reason` | `VARCHAR(64)` | No | - | Reservation reason, currently `banned_account` |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Row insertion time |

Recommended indexes:

- `uidx_player_name_reservations_normalized` unique on `normalized_name`
- `idx_player_name_reservations_until` on `reserved_until`

When an account is banned, the server copies its current and historical display names into this table and rejects attempts by other players to reuse those names until the reservation expires.

Issue #27 follow-up note: event-log and achievement history queries now share a single normalization contract in `packages/shared/src/event-log.ts`. Route handlers and MySQL persistence both reuse that helper so trimming, pagination clamping, and ISO timestamp coercion stay consistent before full event-log persistence and richer achievement views land.

### Table: `guilds`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `guild_id` | `VARCHAR(191)` | No | - | Guild id, primary key |
| `name` | `VARCHAR(80)` | No | - | Latest guild name snapshot |
| `tag` | `VARCHAR(8)` | No | - | Latest guild tag snapshot |
| `description` | `VARCHAR(160)` | Yes | `NULL` | Latest guild description snapshot |
| `owner_player_id` | `VARCHAR(191)` | Yes | `NULL` | Current owner player id |
| `member_count` | `INT` | No | `0` | Current member count |
| `state_json` | `LONGTEXT` | No | - | Serialized `GuildState`, including hidden moderation state |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | First persistence time |
| `updated_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Last persistence time |

Recommended indexes:

- `idx_guilds_updated_at` on `updated_at`
- `uidx_guilds_tag` unique on `tag`

### Table: `guild_memberships`

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `guild_id` | `VARCHAR(191)` | No | - | Guild id |
| `player_id` | `VARCHAR(191)` | No | - | Member player id |
| `role` | `VARCHAR(16)` | No | - | Persisted guild role snapshot |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Membership row creation time |

Primary key:

- `(guild_id, player_id)`

Recommended indexes:

- `uidx_guild_memberships_player` unique on `player_id`

### Table: `guild_audit_logs`

Guild moderation and guild-create rate limits rely on an append-only audit table instead of mutable counters. The server counts recent `created` entries per `actor_player_id` to enforce the “2 creations per 24h” policy and keeps moderation actions after a guild is hidden or deleted.

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| `audit_id` | `VARCHAR(191)` | No | - | Audit row id, primary key |
| `guild_id` | `VARCHAR(191)` | No | - | Guild id referenced by the action |
| `action` | `VARCHAR(32)` | No | - | One of `created`, `hidden`, `unhidden`, `deleted` |
| `actor_player_id` | `VARCHAR(191)` | No | - | Moderator or creator actor id |
| `occurred_at` | `DATETIME` | No | - | Logical action time |
| `name` | `VARCHAR(80)` | No | - | Guild name snapshot at action time |
| `tag` | `VARCHAR(8)` | No | - | Guild tag snapshot at action time |
| `reason` | `VARCHAR(200)` | Yes | `NULL` | Optional moderation reason |
| `created_at` | `TIMESTAMP` | No | `CURRENT_TIMESTAMP` | Row insertion time |

Recommended indexes:

- `idx_guild_audit_logs_guild_occurred` on `(guild_id, occurred_at DESC)`
- `idx_guild_audit_logs_actor_occurred` on `(actor_player_id, occurred_at DESC)`

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

- Apply pending migrations: `npm run db -- migrate`
- Roll back the most recent migration: `npm run db -- migrate:rollback`
- Fresh setup alias: `npm run db -- init:mysql`

`db:init:mysql` now delegates to the same migration runner used for upgrades, so fresh installs and existing environments follow a single schema path. The runner records applied versions in `schema_migrations` with `id`, `name`, and `applied_at`.

If the dev server starts with `VEIL_MYSQL_*` configured but the schema is behind, it logs a warning and falls back to local in-memory room persistence plus filesystem config storage instead of mutating the database implicitly. Run `npm run db -- migrate` first for MySQL-backed startup.

## Manual Operations

The repository includes manual room snapshot management commands:

- `npm run db -- snapshots:list -- --limit 20`
- `npm run db -- snapshots:delete -- --roomId test-room`
- `npm run db -- snapshots:prune`

These commands are useful when you want to inspect retained rooms, delete a specific room snapshot, or force a cleanup immediately.

The repository also includes manual player profile management commands:

- `npm run db -- profiles:list -- --limit 20`
- `npm run db -- profiles:list -- --roomId test-room`
- `npm run db -- profiles:list -- --playerId player-1`
- `npm run db -- profiles:delete -- --roomId test-room --playerId player-1`
- `npm run db -- profiles:prune`

These commands are useful when you want to inspect retained per-player room progress, delete a specific player profile row, or force profile cleanup immediately.

Display-name moderation also includes an ops scan command:

- `npm run player-names:scan -- --limit 500`
- `npm run player-names:scan -- --limit 500 --json`

This scans persisted player accounts against the hot-reloadable rules in `configs/display-name-rules.json` so existing violations can be cleaned up before release or moderation sweeps.

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
- upload of a `latest-success.json` status marker used by server startup validation and Prometheus
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
| `VEIL_BACKUP_STATUS_KEY` | No | `<prefix>/_status/latest-success.json` | Object key updated after a fully successful backup run |
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
- `s3://<bucket>/<prefix>/_status/latest-success.json` after a successful backup run

### Cron Schedule

Install the example cron from [`ops/mysql-backup.cron.example`](../ops/mysql-backup.cron.example) to run backups every `6` hours and a restore verification weekly.

Recommended rollout:

1. Copy `.env.example` to the deployment host and fill in `VEIL_MYSQL_*` plus `VEIL_BACKUP_*`.
2. Confirm `aws s3 ls` can reach the bucket with the selected profile or credentials.
3. Run `./scripts/db-backup.sh` manually once.
4. Install the cron entries for both backup and restore verification.
5. Wire `VEIL_BACKUP_NOTIFY_COMMAND` to your pager, webhook, or mail wrapper so failures are visible without waiting for cron mail.

### Startup Validation And Metrics

When `VEIL_BACKUP_S3_BUCKET` is configured, the server now validates bucket reachability during startup. If the bucket or prefix is unreachable, startup continues but emits a loud `BACKUP WARNING` log entry so the deployment is visibly degraded instead of silently assuming backups are healthy.

The server also exposes `veil_db_backup_last_success_timestamp` on `/metrics` and `/api/runtime/metrics`. The metric is populated from the uploaded `latest-success.json` marker and falls back to the most recent visible backup object timestamp when the marker is missing. A value of `0` means startup could not determine a successful backup time.

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
npm run db -- restore:rehearsal
```

For the automated weekly drill that always selects the latest available backup, run:

```bash
RESTORE_MYSQL_HOST=127.0.0.1 \
RESTORE_MYSQL_PORT=3306 \
RESTORE_MYSQL_USER=root \
RESTORE_MYSQL_PASSWORD=change_me \
RESTORE_MYSQL_DATABASE=project_veil_restore_test \
npm run db -- restore:test
```

That flow downloads the archive and `.sha256`, verifies integrity before touching MySQL, restores into the target schema, runs the table-count sanity query, and then executes `npm test -- phase1-release-persistence -- --storage mysql` against the recovered instance unless `VEIL_RESTORE_SKIP_REGRESSION=1`.

## MySQL Alerting

`/metrics` now exports `veil_db_pool_active_connections`, `veil_db_pool_queue_depth`, `veil_mysql_pool_connection_limit`, `veil_mysql_pool_connections_active`, `veil_mysql_pool_connections_idle`, `veil_mysql_pool_queue_depth`, and `veil_mysql_pool_connection_utilization_ratio` for the long-lived `room_snapshot` and `config_center` pools. Use the `db_pool_*` gauges for alerting and the `mysql_pool_*` gauges for deeper pool sizing context when working with the `VeilMySqlPoolPressureHigh` alert in [`docs/alerting-rules.yml`](./alerting-rules.yml).

Replication lag alerting depends on your MySQL exporter exposing `mysql_slave_status_seconds_behind_master`. Project Veil documents the threshold and response flow in the same alerting bundle so HA drills and backup restore drills use one source of truth.

## Release Regression

Use the Phase 1 release regression when you need one bounded proof that MySQL persistence and shipped config/content data are healthy together:

- Local/default mode: `npm test -- phase1-release-persistence`
- Additional Phase 1 pack (`frontier-basin`): `npm test -- phase1-release-persistence:frontier`
- Additional Phase 1 pack (`stonewatch-fork`): `npm test -- phase1-release-persistence:stonewatch`
- Second Phase 1 pack (`ridgeway-crossing`): `npm test -- phase1-release-persistence:ridgeway`
- Additional shipped Phase 1 pack (`highland-reach`): `npm test -- phase1-release-persistence:highland`
- Release-target MySQL mode: `npm test -- phase1-release-persistence -- --storage mysql`

The command writes a JSON artifact under `artifacts/release-readiness/`, validates the shipped Phase 1 content packs, saves representative player/account/world progression through the persistence store, and verifies fresh-room hydration still restores long-term account + hero data while resetting room-local position/readiness. Pass `--map-pack frontier-basin`, `--map-pack stonewatch-fork`, `--map-pack ridgeway-crossing`, or `--map-pack highland-reach` when you need the persistence proof on one of the alternate Phase 1 layouts without changing the validation bundle.
