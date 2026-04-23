# Kubernetes Production Manifests

This directory provides a production-oriented baseline for the Project Veil server runtime.

## Included resources

- `Deployment` with probes and production resource sizing
- `Service` and `Ingress` for HTTP plus long-lived WebSocket traffic on the same backend
- `ConfigMap` for the non-secret env contract from `ops/env/production.env.example`
- `HorizontalPodAutoscaler` keyed to the thresholds published in `docs/ops/capacity-planning.md`
- `canary/` subdirectory with stable/canary Deployments, Services, and an NGINX weighted Ingress baseline for rollback drills

## CI placeholder gate

Pull requests that touch `k8s/` now run `npm run validate:k8s-configmap` in CI. The validator scans `k8s/configmap.yaml` and fails if any `data` value still contains known placeholder tokens:

- bare `.example` hostnames such as `analytics.projectveil.example/ingest`
- `example.ingest.sentry.io`
- `REPLACE_ME`
- `TODO`

The matcher is intentionally narrow so valid production-shaped values do not trip it accidentally. For example, S3-compatible endpoints like `https://s3.example.com` are allowed because they do not use the placeholder bare `.example` top-level domain.

Pull requests that touch `k8s/` should also run `npm run validate -- k8s-image-tags`. That gate scans `k8s/deployment.yaml` and fails if any container image omits an explicit tag or digest, which prevents the primary production deployment from silently falling back to `:latest`.

## External stateful services

These manifests assume managed backing services instead of in-cluster MySQL:

- `VEIL_MYSQL_HOST` points at an external RDS endpoint
- `VEIL_MYSQL_SSL_MODE` should stay at `verify-ca` for managed MySQL so pod-to-RDS traffic is encrypted and certificate-validated
- `REDIS_URL` points at an external Redis endpoint or dedicated Redis service
- no MySQL `PersistentVolumeClaim` is included because the database is expected to live outside the cluster

If you decide to run MySQL in-cluster instead, add a StatefulSet and PVC, then replace `VEIL_MYSQL_HOST` with the MySQL Service DNS name.

If your container image does not already trust the managed MySQL server certificate chain, mount the CA bundle into the pod and set `VEIL_MYSQL_SSL_CA_PATH` to that PEM file.

## Secrets

Create a `Secret` named `project-veil-server-secrets` with the sensitive keys documented in `docs/ops/secrets-inventory.md`, including at minimum:

- `VEIL_AUTH_SECRET`
- `ADMIN_SECRET`
- `SUPPORT_MODERATOR_SECRET`
- `SUPPORT_SUPERVISOR_SECRET`
- `VEIL_ADMIN_TOKEN`
- `VEIL_MYSQL_PASSWORD`
- `SENTRY_DSN`

The deployment uses `envFrom` so the secret keys should match the runtime env var names exactly.

## HPA assumptions

The current in-repo capacity evidence was published on `2026-04-11` in `docs/ops/capacity-planning.md`:

- scale out when `veil_active_rooms_total > 8` per pod
- scale out when `veil_matchmaking_queue_depth > 50`

The HPA encodes those thresholds directly and also keeps a CPU fallback metric at `70%` average utilization. The custom metrics require a Prometheus-compatible metrics adapter such as Prometheus Adapter or KEDA.
