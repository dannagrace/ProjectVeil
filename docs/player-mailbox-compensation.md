# Player Mailbox And Compensation

This vertical slice adds a minimal system mailbox for compensation and live-ops rewards.

## Player APIs

- `GET /api/player-accounts/me/mailbox`
  - Returns `items` plus `summary { totalCount, unreadCount, claimableCount, expiredCount }`.
- `POST /api/player-accounts/me/mailbox/:messageId/claim`
  - Idempotent.
  - Repeat calls return `claimed=false` with `reason=already_claimed`.
- `POST /api/player-accounts/me/mailbox/claim-all`
  - Claims every non-expired message that still has an attachment.

Mailbox items are embedded in the player account snapshot for this first slice and expose:

- `id`, `kind`, `title`, `body`
- `sentAt`, optional `expiresAt`
- optional `readAt`, `claimedAt`
- optional `grant { gems, resources, equipmentIds, cosmeticIds, seasonPassPremium }`

## Admin Delivery

- `POST /api/admin/player-mailbox/deliver`
- Requires `VEIL_ADMIN_TOKEN` on the server and `x-veil-admin-token` on the request.
- Duplicate protection is per-player per-message-id. Re-sending the same `message.id` to the same player is skipped, not duplicated.

Example payload:

```json
{
  "playerIds": ["player-1", "player-2"],
  "message": {
    "id": "comp-2026-04-05-maintenance",
    "kind": "compensation",
    "title": "停机补偿",
    "body": "由于维护延长，补发资源。",
    "expiresAt": "2026-04-12T00:00:00.000Z",
    "grant": {
      "gems": 50,
      "resources": {
        "gold": 200
      }
    }
  }
}
```

## Ops Script

Use [send-player-mailbox-compensation.ts](/home/gpt/project/ProjectVeil/scripts/send-player-mailbox-compensation.ts):

```bash
VEIL_SERVER_URL=http://127.0.0.1:2567 \
VEIL_ADMIN_TOKEN=dev-admin-token \
node --import tsx ./scripts/send-player-mailbox-compensation.ts \
  --player player-1 \
  --player player-2 \
  --id comp-2026-04-05-maintenance \
  --title "停机补偿" \
  --body "由于维护延长，补发资源。" \
  --gems 50 \
  --gold 200 \
  --expires-at 2026-04-12T00:00:00.000Z
```

## Notes

- Claim mutation is atomic with account balance updates and mailbox state.
- Expired messages are never granted by `claim` or `claim-all`.
- `pruneExpired()` now removes expired mailbox entries from persistence-backed account state.
- The Cocos lobby shows mailbox counts plus a basic claim surface with unread redpoint text.
