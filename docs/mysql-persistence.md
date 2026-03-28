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
