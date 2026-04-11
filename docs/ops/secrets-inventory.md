# Secrets Inventory

Project Veil production credentials now load from AWS Secrets Manager during server bootstrap. The server reads the non-sensitive deploy contract from `ops/env/production.env`, fetches one JSON secret bundle from `VEIL_AWS_SECRETS_MANAGER_SECRET_ID`, and aborts startup if the bundle is unavailable or missing required keys.

## Secret Bundle

Recommended secret id:

`projectveil/production/server`

Required JSON keys:

| Key | Used by | Purpose | Rotation |
| --- | --- | --- | --- |
| `VEIL_AUTH_SECRET` | `apps/server/src/auth.ts` | Signs access, refresh, registration, and recovery tokens | Quarterly |
| `ADMIN_SECRET` | `apps/server/src/admin-console.ts` | Protects admin console routes | Quarterly |
| `SUPPORT_MODERATOR_SECRET` | `apps/server/src/admin-console.ts` | Moderator-scoped support actions | Quarterly |
| `SUPPORT_SUPERVISOR_SECRET` | `apps/server/src/admin-console.ts` | Supervisor-scoped support actions | Quarterly |
| `VEIL_ADMIN_TOKEN` | `player-accounts`, `minor-protection`, `seasons`, `wechat-pay` admin routes | Service-to-service admin API access | Quarterly |
| `VEIL_MYSQL_PASSWORD` | `apps/server/src/persistence.ts` | MySQL password for room persistence and migrations | Quarterly |
| `WECHAT_APP_SECRET` | `auth`, `wechat-subscribe`, auth readiness checks | WeChat `code2session` and subscribe-message API secret | On compromise or WeChat app credential reissue |
| `VEIL_WECHAT_GROUP_CHALLENGE_SECRET` | `apps/server/src/player-accounts.ts` | HMAC secret for group challenge tokens | Quarterly |
| `VEIL_WECHAT_PAY_API_V3_KEY` | `apps/server/src/wechat-pay.ts` | WeChat Pay API v3 callback/resource decryption key | On compromise |
| `VEIL_WECHAT_PAY_PRIVATE_KEY` | `apps/server/src/wechat-pay.ts` | Merchant signing key for WeChat Pay requests | On compromise or merchant certificate rotation |
| `VEIL_AUTH_TOKEN_DELIVERY_SMTP_PASSWORD` | `apps/server/src/account-token-delivery.ts` | SMTP credential when password delivery uses SMTP | Quarterly |
| `VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN` | `apps/server/src/account-token-delivery.ts` | Bearer token for webhook delivery channel | Quarterly |

Non-sensitive values stay in env vars:

- Network and infra coordinates such as `VEIL_MYSQL_HOST`, `VEIL_MYSQL_PORT`, `VEIL_BACKUP_S3_*`, `REDIS_URL`
- Runtime tuning such as TTLs, rate limits, and feature toggles
- Public identifiers such as `WECHAT_APP_ID`, `VEIL_WECHAT_PAY_APP_ID`, merchant ids, notify URLs, and certificate serials

## Rotation Policy

- `VEIL_AUTH_SECRET`: rotate quarterly. Coordinate a rolling restart and accept forced re-authentication for existing sessions.
- `VEIL_MYSQL_PASSWORD`: rotate quarterly. Update MySQL first, then update Secrets Manager, then trigger a rolling restart.
- `ADMIN_SECRET`, `SUPPORT_MODERATOR_SECRET`, `SUPPORT_SUPERVISOR_SECRET`, `VEIL_ADMIN_TOKEN`, `VEIL_WECHAT_GROUP_CHALLENGE_SECRET`, SMTP/webhook delivery secrets: rotate quarterly.
- `WECHAT_APP_SECRET`, `VEIL_WECHAT_PAY_API_V3_KEY`, `VEIL_WECHAT_PAY_PRIVATE_KEY`: rotate immediately on compromise, platform reissue, or merchant key rollover.

## Bootstrap Behavior

- Set `VEIL_SECRET_PROVIDER=aws-secrets-manager`.
- Set `VEIL_AWS_SECRETS_MANAGER_SECRET_ID` to the JSON bundle id.
- Set `VEIL_AWS_SECRETS_MANAGER_REGION` to the bundle region.
- Ensure the runtime IAM principal has `secretsmanager:GetSecretValue`.
- Use [`scripts/rotate-secret.sh`](../../scripts/rotate-secret.sh) to update one key and trigger a rolling restart.
