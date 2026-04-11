# Production Deploy Runbook

Issue #1299 closes the gap between the existing local-dev Compose setup and a repeatable production deployment flow. The deliverables in this repo are intentionally pragmatic:

- `Dockerfile.server` builds the Colyseus + API server container.
- `apps/client/Dockerfile` builds and serves the H5 client on Nginx.
- `docker-compose.prod.yml` runs MySQL, Redis, the server, and the H5 client with named volumes and restart policies.
- `ops/env/production.env.example` defines the 27-variable production env contract.
- `npm run validate:production-env -- --env-file ops/env/production.env` verifies that contract before any deploy.

This runbook assumes a VM or bare-metal host using Docker Compose. For zero-downtime deploys, run two identical app hosts behind the same L4/L7 load balancer and roll them one host at a time while both point at the same MySQL and Redis.

Before widening traffic after a deploy, check [`docs/ops/capacity-planning.md`](./capacity-planning.md). The current published single-node limit is `10` concurrent rooms, with an early scale-out trigger at `8`.

## 1. Files Used During Deploy

- Compose stack: `docker compose -f docker-compose.prod.yml`
- Env file: `ops/env/production.env`
- Server health endpoint: `http://<server-host>:2567/api/runtime/health`
- Auth readiness endpoint: `http://<server-host>:2567/api/runtime/auth-readiness`
- Lobby smoke endpoint: `http://<server-host>:2567/api/lobby/rooms`
- H5 client: `http://<server-host>:8080/`

## 2. Pre-Deploy Checklist

1. Start from the release commit you plan to deploy and record its git SHA plus intended image tag.
2. Copy `ops/env/production.env.example` to `ops/env/production.env` on the host and fill in all 27 values.
3. Run `npm run validate:production-env -- --env-file ops/env/production.env`.
4. Confirm MySQL resolves from the deploy host:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env run --rm migrate`
5. Confirm Redis resolves from the deploy host:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env run --rm server node --input-type=module -e "const Redis=(await import('ioredis')).default; const url=process.env.REDIS_URL||'redis://redis:6379/0'; const client=new Redis(url); console.log(await client.ping(), url); await client.quit();"`
6. Review disk headroom for the persistent volumes used by MySQL and Redis.
7. Confirm you have the previous image tag and previous git SHA available for rollback.
8. Schedule the deploy in a low-traffic window and verify no active incident or schema-restore work is in progress.

## 3. Production Env Contract

The deploy validator expects these 27 variables in `ops/env/production.env`:

`VEIL_MYSQL_HOST`, `VEIL_MYSQL_PORT`, `VEIL_MYSQL_USER`, `VEIL_MYSQL_PASSWORD`, `VEIL_MYSQL_DATABASE`, `VEIL_MYSQL_SNAPSHOT_TTL_HOURS`, `VEIL_MYSQL_SNAPSHOT_CLEANUP_INTERVAL_MINUTES`, `VEIL_BACKUP_S3_BUCKET`, `VEIL_BACKUP_S3_PREFIX`, `VEIL_BACKUP_S3_ENDPOINT`, `VEIL_BACKUP_S3_REGION`, `VEIL_BACKUP_AWS_PROFILE`, `VEIL_BACKUP_KEEP_DAILY_DAYS`, `VEIL_BACKUP_KEEP_WEEKLY_DAYS`, `VEIL_BACKUP_WEEKLY_DAY`, `VEIL_RATE_LIMIT_AUTH_WINDOW_MS`, `VEIL_RATE_LIMIT_AUTH_MAX`, `VEIL_RATE_LIMIT_WS_ACTION_WINDOW_MS`, `VEIL_RATE_LIMIT_WS_ACTION_MAX`, `VEIL_AUTH_LOCKOUT_THRESHOLD`, `VEIL_AUTH_LOCKOUT_DURATION_MINUTES`, `VEIL_MAX_GUEST_SESSIONS`, `VEIL_AUTH_SECRET`, `VEIL_AUTH_ACCESS_TTL_SECONDS`, `VEIL_AUTH_REFRESH_TTL_SECONDS`, `VEIL_AUTH_GUEST_TTL_SECONDS`, `VEIL_MATCHMAKING_QUEUE_TTL_SECONDS`

Notes:

- `REDIS_URL` is optional in the env file because `docker-compose.prod.yml` defaults it to `redis://redis:6379/0`.
- `VEIL_AUTH_SECRET` must be set to a production secret. Do not reuse the dev default embedded in code.
- If you use managed MySQL or Redis, point `VEIL_MYSQL_HOST` and `REDIS_URL` at those services and leave the local `mysql` / `redis` services disabled by policy or removed in an override file.

## 4. First-Time Host Bootstrap

1. Copy the repo to the host and create `ops/env/production.env`.
2. Validate env configuration:
   `npm run validate:production-env -- --env-file ops/env/production.env`
3. Build images:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env build`
4. Start stateful services:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env up -d mysql redis`
5. Wait for healthchecks to pass:
   `docker compose -f docker-compose.prod.yml ps`
6. Run schema migrations:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env --profile ops run --rm migrate`
7. Start the app services:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env up -d server client`

## 5. Standard Deploy Procedure

Single-host maintenance deploy:

1. Pull the new release commit onto the host.
2. Run `npm run validate:production-env -- --env-file ops/env/production.env`.
3. Rebuild images:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env build server client`
4. Run migrations before switching traffic:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env --profile ops run --rm migrate`
5. Restart the server and client:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env up -d server client`
6. Run the smoke checklist in section 8.

## 6. Zero-Downtime Rolling Deploy For Colyseus

Project Veil rooms are long-lived, so the practical zero-downtime path is a two-host rolling deploy, not a hard restart of one host.

1. Keep host A and host B on the same release until both are healthy and both point at the same MySQL and Redis.
2. Remove host B from the external load balancer target group, but keep its existing room traffic alive until `activeRoomCount` drains to zero on `/api/runtime/health`.
3. On host B, deploy the new release with the standard procedure:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env build server client`
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env --profile ops run --rm migrate`
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env up -d server client`
4. Verify host B health, auth readiness, and login/matchmaking smoke checks.
5. Add host B back into the load balancer.
6. Repeat the same drain-and-deploy sequence for host A.

This avoids dropping active Colyseus sessions, keeps Redis-backed matchmaking shared between nodes, and limits blast radius to one host at a time.

## 7. Rollback Procedure

Rollback target: the previous known-good git SHA and image build.

1. Remove the unhealthy host from the load balancer.
2. Check whether a migration was applied. If the new release introduced a schema change that is not backward-compatible, stop and assess data rollback risk before changing app images.
3. On the host, check out the previous git SHA or restore the previous image tag.
4. Rebuild or repull the previous images.
5. Restart the services on the previous release:
   `docker compose -f docker-compose.prod.yml --env-file ops/env/production.env up -d server client`
6. Verify `/api/runtime/health`, `/api/runtime/auth-readiness`, guest login, and matchmaking queue behavior.
7. Re-add the host to the load balancer only after smoke checks pass.

If both hosts are already on the bad release, roll them back one host at a time with the same drain procedure used for forward deploys.

## 8. Post-Deploy Smoke Tests

Run these after every deploy or rollback:

1. Health endpoint:
   `curl -fsS http://127.0.0.1:2567/api/runtime/health`
2. Auth readiness:
   `curl -fsS http://127.0.0.1:2567/api/runtime/auth-readiness`
3. Lobby / matchmaking readiness:
   `curl -fsS http://127.0.0.1:2567/api/lobby/rooms`
4. H5 client shell:
   `curl -fsS http://127.0.0.1:8080/ > /dev/null`
5. Browser/manual smoke:
   open `http://<server-host>:8080/`, perform guest login, enter the lobby, and confirm the matchmaking queue opens without client-side connection errors.

Recommended pass criteria:

- `status` is `ok` on `/api/runtime/health`
- `/api/runtime/auth-readiness` returns HTTP 200 without new alerts
- guest login succeeds
- the player can reach the matchmaking queue and receive a room assignment

## 9. Operational Notes

- The committed Compose file keeps MySQL and Redis in-stack because that is the smallest reviewable production baseline. If your environment already provides managed MySQL or Redis, use an override file and point the app at those endpoints.
- The H5 client still talks to the game server on port `2567`, so your firewall or load balancer must expose both `8080` and `2567`.
- `./configs` is mounted read-only into the server container so config files in the repo remain visible without baking a new image just to inspect mounted config state.
