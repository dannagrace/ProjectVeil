# Structured Error Codes

Project Veil now keeps a small operational error catalog in [`packages/shared/src/error-codes.ts`](../packages/shared/src/error-codes.ts). The goal is not to model every failure in the codebase; it is to stabilize the subset that should be searchable in Sentry, runtime diagnostics, and alert rules.

## Current operational codes

| Code | Surface | Severity | Owner | Meaning |
| --- | --- | --- | --- | --- |
| `persistence_save_failed` | server | error | multiplayer | Authoritative room persistence failed and the action was rolled back before the client reply completed. |
| `auth_invalid` | server | warn | auth | The session or reconnect identity was rejected as invalid, expired, revoked, or banned. |
| `config_hotload_failed` | server | error | config | A config hot reload caused a runtime error spike and was rolled back automatically. |
| `uncaught_exception` | server | fatal | ops | A process-level uncaught exception forced server shutdown. |
| `unhandled_rejection` | server | fatal | ops | A process-level unhandled promise rejection forced server shutdown. |
| `session_disconnect` | client | error | client | The primary Cocos session disconnected or failed reconnect recovery. |
| `client_error_boundary_triggered` | client | fatal | client | The global client error boundary caught an uncaught exception or unhandled rejection. |

## Operational use

- Set `SENTRY_DSN` on the server runtime to enable best-effort Sentry envelope delivery. If `SENTRY_DSN` is empty, the runtime still records structured errors locally and in Prometheus metrics.
- Use `error_code`, `feature_area`, and `owner_area` tags in Sentry to filter room persistence failures apart from auth and config incidents.
- Use `veil_runtime_error_events_total{error_code="persistence_save_failed"}` for Prometheus alerting and incident budgets.
- Client severe failures go through the existing analytics pipeline as `client_runtime_error` events and keep the specific `payload.errorCode` for warehouse or downstream filtering.
