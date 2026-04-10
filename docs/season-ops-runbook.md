# Season And Battle Pass Operations Runbook

Issue: `#1206`

This runbook is the operational gate for season cadence and battle-pass rollout work. Use it before changing season dates, before closing a live season, and before promoting `battle_pass_enabled` for any new season/reward table revision.

## Scope And Owners

- Product ops: season calendar, reward theme, push copy, and the final go/no-go call on start and close windows.
- Server on-call: `/api/admin/seasons/*` execution, runtime health checks, and rollback if close/start fails.
- Economy owner: `configs/battle-pass.json` XP pacing and reward value review.
- CS / community ops: player-facing reminder copy, outage notices, and mailbox compensation delivery when policy requires it.

## Operational Artifacts

- Battle-pass config: [configs/battle-pass.json](/home/gpt/project/ProjectVeil/configs/battle-pass.json)
- Season admin routes: [apps/server/src/seasons.ts](/home/gpt/project/ProjectVeil/apps/server/src/seasons.ts)
- Season reward close implementation: [apps/server/src/persistence.ts](/home/gpt/project/ProjectVeil/apps/server/src/persistence.ts#L6927)
- Battle-pass config normalization: [apps/server/src/battle-pass.ts](/home/gpt/project/ProjectVeil/apps/server/src/battle-pass.ts)
- Compensation delivery path: [docs/player-mailbox-compensation.md](/home/gpt/project/ProjectVeil/docs/player-mailbox-compensation.md)
- XP pacing helper: [scripts/battle-pass-xp-balance.ts](/home/gpt/project/ProjectVeil/scripts/battle-pass-xp-balance.ts)

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
