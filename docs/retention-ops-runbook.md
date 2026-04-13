# Retention Ops Runbook

Issue #1200 starts the retention surface with a narrow server-side slice: daily first-login rewards are now issued automatically on successful login, streak state is persisted on the player account, and every successful issuance emits a versioned `daily_login` analytics event.

This runbook only covers the implemented slices. WeChat push, offline-reward summaries, and D1/D7 dashboard material are still out of scope for this change and need follow-up work before they should be promised as live.

## Current Scope

- Successful `POST /api/auth/guest-login` issues the daily reward on the first login of the calendar day.
- Successful `POST /api/auth/account-login` issues the same reward path for bound accounts.
- Successful `POST /api/auth/wechat-login` and `POST /api/auth/wechat-mini-game-login` use the same reward path.
- The legacy `POST /api/player/daily-claim` route remains available, but once a login flow has already issued today’s reward it returns `already_claimed_today`.
- Reward amounts are read from [`configs/daily-rewards.json`](/home/gpt/project/ProjectVeil/configs/daily-rewards.json).
- Reward issuance appends an account event-log entry and emits `daily_login` analytics with `dateKey`, `streak`, and `reward`.

## Expected Behavior

1. First successful login on date `YYYY-MM-DD`
   The server checks `lastPlayDate`. If it differs from today, it grants the configured gems/gold reward, resets `dailyPlayMinutes` to `0`, updates `lastPlayDate`, and persists `loginStreak`.
2. Consecutive login
   If `lastPlayDate` equals yesterday, `loginStreak` increments by one and the next reward tier is granted.
3. Gap login
   If `lastPlayDate` is older than yesterday or missing, `loginStreak` resets to `1`.
4. Same-day repeat login
   No second reward is granted and no new `daily_login` analytics event is emitted.

## Operator Checks

- Verify the auth response includes `dailyLoginReward` on the first login of the day.
- Verify `/api/player-accounts/me` or stored account data shows updated `gems`, `globalResources.gold`, `loginStreak`, and `lastPlayDate`.
- Verify the latest account event log includes a `每日签到奖励` entry.
- Verify analytics ingestion received a `daily_login` event for the same player/dateKey.

## Triage Notes

- Wrong streak after a gap:
  Check the stored `lastPlayDate` and confirm it uses the same daily key boundary as the server.
- Reward missing on login:
  Confirm the account has not already claimed on the same day through a prior login or `/api/player/daily-claim`.
- Analytics missing while rewards succeeded:
  Inspect analytics pipeline logs for `daily_login` ingestion or downstream flush failures; reward issuance is not rolled back by telemetry failure.

## Rollback

- To reduce exposure immediately, point clients back to the existing manual claim flow operationally and avoid depending on the auth response field.
- To change values without code rollout, update [`configs/daily-rewards.json`](/home/gpt/project/ProjectVeil/configs/daily-rewards.json).
- If the reward logic itself is faulty, revert the server change rather than mutating player data manually without an audit trail.

## Battle Replay Retention

Issue `#1376` adds a second retention slice for battle replay payloads stored in `player_accounts.recent_battle_replays_json`.

### Current Scope

- New replay writes are rejected when the serialized replay JSON exceeds `VEIL_BATTLE_REPLAY_MAX_BYTES` (default `524288`, or `512 KB`).
- New replay writes receive `expiresAt` based on `VEIL_BATTLE_REPLAY_TTL_DAYS` (default `90`).
- MySQL-backed server startup runs replay cleanup immediately, then repeats on `VEIL_BATTLE_REPLAY_CLEANUP_INTERVAL_MINUTES` (default `1440`, or every 24 hours).
- Each cleanup pass scans up to `VEIL_BATTLE_REPLAY_CLEANUP_BATCH_SIZE` account rows (default `100`) and removes expired replay entries from the embedded JSON array.
- Cleanup activity is emitted to the server log as `Pruned N expired battle replay(s)`.

### Operator Checks

- Confirm startup logs include a line shaped like `Battle replay retention: ttl=90d / max=524288B / cleanup=1440m / batch=100`.
- Confirm cleanup logs periodically emit `Pruned N expired battle replay(s)` when stale data exists.
- When debugging an account-specific replay issue, inspect the stored `recent_battle_replays_json` payload and verify every retained replay has an `expiresAt` within the configured TTL window.

### Table Sizing Guidance

- Estimate replay footprint from the serialized JSON payload, not from replay count alone.
- A safe starting alert threshold is `player_accounts.recent_battle_replays_json` averaging above `256 KB` per active player row or any single replay approaching the `512 KB` write cap, because that usually means battle steps are expanding faster than the retention window can offset.
- If table growth remains high after cleanup is working, lower `VEIL_BATTLE_REPLAY_TTL_DAYS` first before raising the write cap.

### Triage Notes

- Replay missing immediately after battle:
  Check whether the payload exceeded `VEIL_BATTLE_REPLAY_MAX_BYTES`; oversized replays are intentionally skipped instead of persisted.
- Old replay still visible:
  Confirm the replay has an `expiresAt` value, then check whether the server is running with MySQL persistence and whether the cleanup interval is enabled.
- Cleanup logs missing:
  Verify `VEIL_BATTLE_REPLAY_CLEANUP_INTERVAL_MINUTES` is positive and the process has completed at least one startup cycle since the config change.

## Player Name History Retention

Issue `#1426` adds retention enforcement for `player_name_history`, which stores historical display names and therefore contains PII.

### Current Scope

- MySQL-backed server startup prunes expired `player_name_history` rows immediately, then repeats on `VEIL_PLAYER_NAME_HISTORY_CLEANUP_INTERVAL_MINUTES` (default `1440`, or every 24 hours).
- The retention window is `VEIL_PLAYER_NAME_HISTORY_TTL_DAYS` (default `90`).
- Each cleanup pass deletes up to `VEIL_PLAYER_NAME_HISTORY_CLEANUP_BATCH_SIZE` oldest expired rows (default `1000`).
- Cleanup activity is emitted to the server log as `Pruned N expired player name history row(s)`.

### Operator Checks

- Confirm startup logs include a line shaped like `Player name history retention: ttl=90d / cleanup=1440m / batch=1000`.
- Confirm cleanup logs periodically emit `Pruned N expired player name history row(s)` when stale rows exist.
- When investigating moderation history, remember entries older than the configured TTL are expected to disappear after the next cleanup cycle.

### Triage Notes

- Old name-history row still visible:
  Check the row's `changed_at`, then verify the runtime config and whether the process has completed startup or a scheduled cleanup pass since the row expired.
- Cleanup logs missing:
  Verify `VEIL_PLAYER_NAME_HISTORY_CLEANUP_INTERVAL_MINUTES` is positive and the process is running with MySQL persistence.
