# Season And Battle Pass Operations Runbook

Issues: `#1206`, `#1428`

This runbook is the operational gate for season cadence and battle-pass rollout work. Use it before changing season dates, before closing a live season, and before promoting `battle_pass_enabled` for any new season/reward table revision.

## Scope And Owners

- Product ops: season calendar, reward theme, push copy, and the final go/no-go call on start and close windows.
- Server on-call: `/api/admin/seasons/*` execution, runtime health checks, and rollback if close/start fails.
- Economy owner: `configs/battle-pass.json` XP pacing and reward value review.
- CS / community ops: player-facing reminder copy, outage notices, and mailbox compensation delivery when policy requires it.

## Operational Artifacts

- Battle-pass config: [configs/battle-pass.json](/home/gpt/project/ProjectVeil/configs/battle-pass.json)
- Season admin routes: [apps/server/src/seasons.ts](/home/gpt/project/ProjectVeil/apps/server/src/seasons.ts)
- Seasonal event admin routes: [apps/server/src/event-engine.ts](/home/gpt/project/ProjectVeil/apps/server/src/event-engine.ts#L1265)
- Season reward close implementation: [apps/server/src/persistence.ts](/home/gpt/project/ProjectVeil/apps/server/src/persistence.ts#L6927)
- Battle-pass config normalization: [apps/server/src/battle-pass.ts](/home/gpt/project/ProjectVeil/apps/server/src/battle-pass.ts)
- Compensation delivery path: [docs/player-mailbox-compensation.md](/home/gpt/project/ProjectVeil/docs/player-mailbox-compensation.md)
- Seasonal event admin route coverage: [apps/server/test/event-admin-routes.test.ts](/home/gpt/project/ProjectVeil/apps/server/test/event-admin-routes.test.ts#L223)
- XP pacing helper: [scripts/battle-pass-xp-balance.ts](/home/gpt/project/ProjectVeil/scripts/battle-pass-xp-balance.ts)

## Seasonal Event Admin Surface

Use these routes for live seasonal-event interventions. They are separate from ranked season create/close.

- `GET /api/admin/seasonal-events`
  - Returns live event status, participation totals, and the in-memory audit trail for recent admin actions.
- `PATCH /api/admin/seasonal-events/:id`
  - Applies a runtime override for `startsAt`, `endsAt`, `isActive`, `rewards`, `leaderboard`, or `rewardDistributionAt`.
- `POST /api/admin/seasonal-events/:id/end`
  - Force-ends the currently active event, stamps `endsAt` and `rewardDistributionAt` to now, and distributes threshold plus leaderboard rewards through the player mailbox flow.
- `DELETE /api/admin/seasonal-events/:eventId/players/:playerId`
  - Deletes one player's stored progress for one seasonal event.

Authentication:

- These routes require `VEIL_ADMIN_TOKEN` on the server.
- Send the token as `x-veil-admin-token: $VEIL_ADMIN_TOKEN` for `curl` examples in this runbook.

Important limits:

- `PATCH /api/admin/seasonal-events/:id` writes an in-memory runtime override, not a config file change. The override disappears on process restart or redeploy.
- `POST /api/admin/seasonal-events/:id/end` and the player-reset route require persistence-backed account storage. Treat `503 seasonal_event_persistence_unavailable` as a hard blocker.
- Reward distribution for forced event close is mailbox-based and should be audited like any other compensation or live-ops grant.

## Season Lifecycle SOP

### T-14 To T-7 Content Lock

1. Freeze the season theme, premium reward set, and season length.
2. Update `configs/battle-pass.json`, then run:

```bash
node --import tsx ./scripts/battle-pass-xp-balance.ts \
  --season-days=28 \
  --matches-per-day=8 \
  --win-rate=0.55 \
  --daily-login-days=28
```

3. Review the output with product ops and economy owner.
   The working target is that the final tier lands inside the final week for a regular player cohort, not only for whales or only-perfect win rates.
4. Record the chosen assumptions and the projected final-tier day in the season ticket or launch note.

### T-72h Reminder Planning

1. Lock the outbound reminder cadence and owners.
2. Schedule one reminder at `season_end - 72h` and one at `season_end - 24h`.
3. Both reminders must contain:
   - season end timestamp in UTC and CN local time
   - current tier / XP CTA
   - premium purchase CTA if premium is still on sale
   - reward-claim CTA if the player already has unlocked but unclaimed tiers
4. Confirm CS has the compensation macro and mailbox script ready before the 72h send.

### T-24h Final Readiness

1. Re-run the pacing script if XP sources changed after T-72h.
2. Confirm `/api/seasons/current` returns the expected live `seasonId`.
3. Confirm `/api/runtime/feature-flags` checksum consistency if `battle_pass_enabled` rollout is changing with the season event.
4. Freeze battle-pass config edits after the final reminder unless there is a production incident.

### D0 Season Start

1. Verify there is no stray active season:

```bash
curl -sS "$VEIL_SERVER_URL/api/admin/seasons?status=all" \
  -H "x-veil-admin-token: $VEIL_ADMIN_TOKEN"
```

2. Create the new season only after the battle-pass config revision is deployed everywhere:

```bash
curl -sS -X POST "$VEIL_SERVER_URL/api/admin/seasons/create" \
  -H "content-type: application/json" \
  -H "x-veil-admin-token: $VEIL_ADMIN_TOKEN" \
  -d '{"seasonId":"season-2026-q2"}'
```

3. Validate `GET /api/seasons/current` and one reward-claim smoke test on a seeded QA account.
4. Append rollout evidence and the season ID to the release log for the same revision.

### In-Season Weekly Review

1. Sample current XP pacing against the original assumptions.
2. Do not change XP numbers mid-season unless the economy owner and server on-call both approve.
3. If XP tuning is unavoidable, announce the effective date and re-send the 72h/24h reminders using the revised pacing.

## Seasonal Event Reward Override SOP

Use this only when the live seasonal event reward table is wrong and waiting for a full config rollout would materially harm players.

Pre-checks:

1. Confirm the target event ID and current live state:

```bash
curl -sS "$VEIL_SERVER_URL/api/admin/seasonal-events" \
  -H "x-veil-admin-token: $VEIL_ADMIN_TOKEN"
```

2. Save the current `event`, `participation`, and `audit` payload in the incident ticket before overriding anything.
3. Decide whether the override is temporary incident mitigation or the intended final reward table. If it is final, open or link the follow-up config PR so the runtime patch is not lost on restart.

Runtime reward override example:

```bash
curl -sS -X PATCH "$VEIL_SERVER_URL/api/admin/seasonal-events/defend-the-bridge" \
  -H "content-type: application/json" \
  -H "x-veil-admin-token: $VEIL_ADMIN_TOKEN" \
  -d '{
    "rewards": [
      {
        "id": "bridge-ration-cache",
        "name": "Ration Cache",
        "pointsRequired": 40,
        "kind": "resources",
        "resources": { "gold": 200, "wood": 25 }
      }
    ]
  }'
```

Post-checks:

1. Re-run `GET /api/admin/seasonal-events` and confirm the event audit trail contains `action=patched`.
2. Confirm the override scope is the minimum needed. Do not widen `leaderboard.rewardTiers` and threshold rewards together unless the incident requires both.
3. Record the expected expiry condition for the patch:
   - superseded by config rollout
   - removed during planned restart
   - followed immediately by forced event close

## Forced Seasonal Event End SOP

Use this when the event must close immediately because the reward config is irreparably wrong, the event is causing live-service instability, or policy requires an early stop.

Pre-checks:

1. Confirm the event is currently `active`:

```bash
curl -sS "$VEIL_SERVER_URL/api/admin/seasonal-events" \
  -H "x-veil-admin-token: $VEIL_ADMIN_TOKEN"
```

2. Capture the current event payload and participation totals before ending it.
3. Confirm mailbox delivery is the intended reward path and CS has the player-facing macro ready in case follow-up messaging is required.
4. If the event should end with a corrected reward table instead of the currently live table, apply the reward override first and verify it through `GET /api/admin/seasonal-events`.

Force-end command:

```bash
curl -sS -X POST "$VEIL_SERVER_URL/api/admin/seasonal-events/defend-the-bridge/end" \
  -H "x-veil-admin-token: $VEIL_ADMIN_TOKEN"
```

Expected behavior:

1. The route sets `endsAt` to now, flips `isActive` to `false`, and stamps `rewardDistributionAt`.
2. Threshold and leaderboard rewards are delivered through the mailbox pipeline.
3. The response includes a `distribution` summary and an audit entry with `action=force_ended`.

Post-checks:

1. Re-run `GET /api/admin/seasonal-events` and confirm the event is no longer active.
2. Save the `distribution` block in the incident or release log, including:
   - `deliveredThresholdRewards`
   - `deliveredLeaderboardRewards`
   - any skipped delivery counts if present
3. Spot-check at least one impacted account mailbox when the incident severity justifies it.
4. Do not re-run the end route after success unless engineering has explicitly confirmed duplicate mailbox IDs remain safe for the current event definition.

## Single-Player Seasonal State Reset SOP

Use this for one-off player recovery when a single account has corrupted or unfair event progress and broad reward compensation is not the correct fix.

Pre-checks:

1. Confirm the target event ID and player ID.
2. Check whether the player already claimed any event rewards; a reset removes stored progress and may intentionally require separate mailbox compensation if the player should retain value.
3. Capture the current player-support note before mutating state.

Reset command:

```bash
curl -sS -X DELETE "$VEIL_SERVER_URL/api/admin/seasonal-events/defend-the-bridge/players/player-123" \
  -H "x-veil-admin-token: $VEIL_ADMIN_TOKEN"
```

Expected behavior:

1. The route removes only the requested event entry from `seasonalEventStates`.
2. The response returns `reset=true`, the updated account snapshot, and an audit entry with `action=player_progress_reset`.
3. If the player has no progress for that event, the route returns `404 seasonal_event_progress_not_found`.

Post-checks:

1. Save the response payload in the support ticket with the previous points noted in the audit metadata.
2. If the player should keep previously earned value, send any make-good through the mailbox compensation path instead of direct account edits.
3. Reconfirm the player can re-enter the event loop normally before closing the support task.

### Season Close

1. Announce a content freeze for the final 24h.
2. At the close window, run:

```bash
curl -sS -X POST "$VEIL_SERVER_URL/api/admin/seasons/close" \
  -H "x-veil-admin-token: $VEIL_ADMIN_TOKEN"
```

3. Expected behavior:
   - `closeSeason()` snapshots standings if needed, grants ranked-season rewards once, and marks the season closed.
   - Re-running the same close is idempotent and should return zero newly rewarded players.
4. Immediately verify:
   - `/api/admin/seasons?status=all` shows the season as `closed`
   - the close response contains the expected `playersRewarded` and `totalGemsGranted`
   - no second reward distribution occurs on a repeated close call

## Battle-Pass XP Balancing Template

Use the script output as the planning template. Record these four assumptions every season:

- `seasonDays`
- `matchesPerDay`
- `winRate`
- `dailyLoginDays`

Operator interpretation:

- `expectedDailyXp` is the regular-cohort pacing baseline.
- `projectedSeasonXp` and `projectedTier` show where that cohort lands by season end.
- `finalTierTarget` should typically land between `D(seasonDays - 7)` and `D(seasonDays)` for the core cohort.
- If final tier lands far earlier, reduce XP income or add more tiers/rewards.
- If final tier is unreachable without near-perfect play, reduce tier thresholds or add extra XP sources before launch.

## Season Close Rehearsal

Run one rehearsal for every new reward table or close-flow change.

Checklist:

1. Seed a dev or staging environment with at least 25 ranked accounts.
2. Create a rehearsal season ID.
3. Call the close route once and save the JSON response.
4. Call the close route a second time and verify idempotency.
5. Capture `GET /api/admin/seasons?status=all` before and after close.
6. Save the evidence links in the issue or release packet.

Current automated rehearsal anchors already in-repo:

- [apps/server/test/memory-room-snapshot-store.test.ts](/home/gpt/project/ProjectVeil/apps/server/test/memory-room-snapshot-store.test.ts#L203) covers reward distribution once plus double-close protection.
- [apps/server/test/persistence-account-credentials.test.ts](/home/gpt/project/ProjectVeil/apps/server/test/persistence-account-credentials.test.ts#L314) covers MySQL-backed close behavior and reward log idempotency.

## Expired Unclaimed Reward Compensation Policy

Current behavior is split by reward type:

- Ranked-season rewards are granted during `closeSeason()` and do not require player claim afterward.
- Battle-pass tier rewards are still player-claimed; there is no automatic end-of-season sweep for unlocked but unclaimed tiers.

Policy:

1. No compensation for pure player inactivity.
2. Compensation is required when a service incident, emergency maintenance, or forced early close removed a reasonable claim window.
3. Premium purchasers get priority handling because money changed hands. If a paid player loses claim access due to service failure, grant the missed premium value manually.
4. Use mailbox compensation, not direct account edits, so the recovery is auditable and player-visible.

Compensation procedure:

1. Build the affected-player list and missed reward summary.
2. Send one mailbox message per incident using [scripts/send-player-mailbox-compensation.ts](/home/gpt/project/ProjectVeil/scripts/send-player-mailbox-compensation.ts).
3. Set `expiresAt` to `incident_resolved_at + 7 days`.
4. Use a stable compensation ID such as `bp-comp-2026-q2-close-incident`.
5. Include the incident reference in the internal ops note and CS macro.

## Reminder Plan Template

- `T-72h`: broad reminder to all active season participants, plus premium upsell if applicable.
- `T-24h`: urgency reminder to players with unclaimed unlocked tiers and players within one tier of a premium chase reward.
- `T-0`: optional maintenance/close notice only if the season close requires a visible service window.

Minimum planning fields:

- audience
- send time
- owner
- copy link
- fallback channel
- success metric
- incident rollback note

## Release Gate

Do not promote a new season or a new battle-pass revision until all of the following are true:

- battle-pass config reviewed with the XP pacing script
- 72h and 24h reminders scheduled
- season close rehearsal evidence linked
- compensation owner named
- server on-call has the admin token, close command, and rollback path ready
