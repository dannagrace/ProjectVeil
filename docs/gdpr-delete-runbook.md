# GDPR Delete Verification Runbook

Use this query after `/api/players/me/delete` to confirm the server removed the player from the dependent tables that are not protected by foreign-key cascade and scrubbed the remaining `player_accounts` row.

Replace `:player_id` with the deleted player id before running it in MySQL:

```sql
SELECT 'player_account_sessions' AS table_name, COUNT(*) AS remaining
FROM player_account_sessions
WHERE player_id = :player_id
UNION ALL
SELECT 'player_accounts_scrubbed', COUNT(*)
FROM player_accounts
WHERE player_id = :player_id
  AND (
    mailbox_json IS NOT NULL
    OR seasonal_event_states_json IS NOT NULL
    OR daily_dungeon_state_json IS NOT NULL
    OR JSON_LENGTH(COALESCE(recent_battle_replays_json, JSON_ARRAY())) > 0
    OR JSON_LENGTH(COALESCE(recent_event_log_json, JSON_ARRAY())) > 0
    OR elo_rating IS NOT NULL
    OR rank_division IS NOT NULL
    OR peak_rank_division IS NOT NULL
  )
UNION ALL
SELECT 'player_hero_archives', COUNT(*)
FROM player_hero_archives
WHERE player_id = :player_id
UNION ALL
SELECT 'player_quest_states', COUNT(*)
FROM player_quest_states
WHERE player_id = :player_id
UNION ALL
SELECT 'player_compensation_history', COUNT(*)
FROM player_compensation_history
WHERE player_id = :player_id
UNION ALL
SELECT 'player_event_history', COUNT(*)
FROM player_event_history
WHERE player_id = :player_id
UNION ALL
SELECT 'player_name_history', COUNT(*)
FROM player_name_history
WHERE player_id = :player_id
UNION ALL
SELECT 'guild_memberships', COUNT(*)
FROM guild_memberships
WHERE player_id = :player_id
UNION ALL
SELECT 'guild_messages', COUNT(*)
FROM guild_messages
WHERE author_player_id = :player_id
UNION ALL
SELECT 'referrals', COUNT(*)
FROM referrals
WHERE referrer_id = :player_id OR new_player_id = :player_id
UNION ALL
SELECT 'battle_snapshots', COUNT(*)
FROM battle_snapshots
WHERE attacker_player_id = :player_id OR defender_player_id = :player_id
UNION ALL
SELECT 'leaderboard_season_archives', COUNT(*)
FROM leaderboard_season_archives
WHERE player_id = :player_id
UNION ALL
SELECT 'season_reward_log', COUNT(*)
FROM season_reward_log
WHERE player_id = :player_id
UNION ALL
SELECT 'orders (raw player_id removed)', COUNT(*)
FROM orders
WHERE player_id = :player_id
UNION ALL
SELECT 'payment_receipts (raw player_id removed)', COUNT(*)
FROM payment_receipts
WHERE player_id = :player_id;
```

Every `remaining` value must be `0`. If any count is non-zero, treat the deletion as failed and investigate before acknowledging GDPR completion.
