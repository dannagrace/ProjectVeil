# Retention Ops Runbook

Issue #1200 starts the retention surface with a narrow server-side slice: daily first-login rewards are now issued automatically on successful login, streak state is persisted on the player account, and every successful issuance emits a versioned `daily_login` analytics event.

This runbook only covers the implemented slice. WeChat push, offline-reward summaries, and D1/D7 dashboard material are still out of scope for this change and need follow-up work before they should be promised as live.

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
