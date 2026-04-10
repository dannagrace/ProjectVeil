# Player Support Runbook

This runbook describes the smallest workable player-support flow shipped for issue `#1204`.

## Roles

### `admin`

Full operational access. Use for infrastructure and emergency actions only.

### `support-moderator`

Scope:

- review player reports
- issue warnings
- apply temporary bans
- remove temporary bans
- export player account data

Credential:

- server env: `SUPPORT_MODERATOR_SECRET`
- request header: `x-veil-admin-secret`

### `support-supervisor`

Scope:

- everything a moderator can do
- approve and apply permanent bans
- reverse permanent bans

Credential:

- server env: `SUPPORT_SUPERVISOR_SECRET`
- request header: `x-veil-admin-secret`

## Supported API Surface

### Review reports

- `GET /api/admin/reports?status=pending`
- `POST /api/admin/reports/:id/resolve`

For `status=banned`, the request must include:

```json
{
  "status": "banned",
  "approval": {
    "approvedBy": "ops-lead",
    "approvalReference": "SUP-204"
  }
}
```

### Ban history

- `GET /api/admin/players/:id/ban-history`

Use this before any escalation or appeal resolution.

### Temporary ban

- `POST /api/admin/players/:id/ban`

Example:

```json
{
  "banStatus": "temporary",
  "banReason": "Repeat harassment after warning",
  "banExpiry": "2026-05-05T00:00:00.000Z"
}
```

### Permanent ban

Only `support-supervisor` or `admin` may execute this.

```json
{
  "banStatus": "permanent",
  "banReason": "Confirmed automation",
  "approval": {
    "approvedBy": "ops-lead",
    "approvalReference": "SUP-205"
  }
}
```

### Unban

- `POST /api/admin/players/:id/unban`

Moderators may reverse temporary bans. Permanent-ban reversals require `support-supervisor` or `admin`.

### Player data export

- `GET /api/admin/players/:id/export`

Returns:

- raw account snapshot currently stored by the server
- current ban state
- ban history
- `exportedAt` timestamp for case attachments

Use this route for privacy/data-access responses. Before sending anything externally:

- confirm the requester controls the account
- redact internal-only annotations if they are not required for the request
- attach the case ID used to fulfill the export

## Appeal Workflow

1. Check `/api/admin/players/:id/ban-history`.
2. Review matching reports in `/api/admin/reports`.
3. Respond to the player within 48 hours.
4. If the enforcement stands, send the final rationale and close the case.
5. If the enforcement changes, apply `/unban` or a shorter temporary ban and note the case reference.

## Account Deletion

Player self-service deletion already exists at `POST /api/players/me/delete`.

Support handling:

- verify account ownership
- direct the player to the in-product deletion path when possible
- if manual intervention is required, record the reason and confirm the resulting anonymized account state

## Operational Gaps

- no dedicated approval ledger beyond the approval reference captured in the ban reason
- no automated report-threshold queue yet
- no dedicated support UI; the slice is API-first plus runbook
