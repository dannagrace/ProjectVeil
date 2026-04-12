# Kubernetes Production Manifests

This directory provides a production-oriented baseline for the Project Veil server runtime.

## Included resources

- `Deployment` with probes and production resource sizing
- `Service` and `Ingress` for HTTP plus long-lived WebSocket traffic on the same backend
- `ConfigMap` for the non-secret env contract from `ops/env/production.env.example`
- `HorizontalPodAutoscaler` keyed to the thresholds published in `docs/ops/capacity-planning.md`

## External stateful services

These manifests assume managed backing services instead of in-cluster MySQL:

- `VEIL_MYSQL_HOST` points at an external RDS endpoint
- `REDIS_URL` points at an external Redis endpoint or dedicated Redis service
- no MySQL `PersistentVolumeClaim` is included because the database is expected to live outside the cluster

If you decide to run MySQL in-cluster instead, add a StatefulSet and PVC, then replace `VEIL_MYSQL_HOST` with the MySQL Service DNS name.

## Secrets

Create a `Secret` named `project-veil-server-secrets` with the sensitive keys documented in `docs/ops/secrets-inventory.md`, including at minimum:

- `VEIL_AUTH_SECRET`
- `ADMIN_SECRET`
- `SUPPORT_MODERATOR_SECRET`
- `SUPPORT_SUPERVISOR_SECRET`
- `VEIL_ADMIN_TOKEN`
- `VEIL_MYSQL_PASSWORD`

The deployment uses `envFrom` so the secret keys should match the runtime env var names exactly.

## HPA assumptions

The current in-repo capacity evidence was published on `2026-04-11` in `docs/ops/capacity-planning.md`:

- scale out when `veil_active_rooms_total > 8` per pod
- scale out when `veil_matchmaking_queue_depth > 50`

The HPA encodes those thresholds directly and also keeps a CPU fallback metric at `70%` average utilization. The custom metrics require a Prometheus-compatible metrics adapter such as Prometheus Adapter or KEDA.
