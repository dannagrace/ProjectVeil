# Project Veil Monitoring Stack Setup

This repository now ships a minimal Prometheus + Alertmanager + Grafana stack under `infra/` for scraping the server `/metrics` endpoint, loading the alert rules in `docs/alerting-rules.yml`, and delivering at least one alert route to a real notification receiver.

## Files

- `infra/prometheus.yml`: Prometheus scrape and alerting configuration.
- `infra/alertmanager.yml`: Alertmanager routing and Slack notification receiver.
- `infra/docker-compose.monitoring.yml`: local monitoring stack for Prometheus, Alertmanager, and Grafana.
- `infra/grafana/dashboard-overview.json`: overview dashboard covering DAU proxy, active rooms, battle duration P95, and error rate.
- `infra/grafana/provisioning/...`: Grafana datasource and dashboard provisioning.
- `docs/alerting-rules.yml`: alert rules evaluated by Prometheus.

## Prerequisites

1. Start the Project Veil server so `/metrics` is reachable on `http://127.0.0.1:2567/metrics`.
2. Create the Alertmanager secret directory and webhook file:

```bash
mkdir -p infra/secrets
printf '%s' 'https://hooks.slack.com/services/REPLACE/ME' > infra/secrets/slack-webhook-url
```

3. If the server is not running on the Docker host at port `2567`, update `infra/prometheus.yml` target `host.docker.internal:2567`.

## Bring Up The Stack

```bash
docker compose -f infra/docker-compose.monitoring.yml up -d
```

After startup:

- Prometheus: `http://127.0.0.1:9090`
- Alertmanager: `http://127.0.0.1:9093`
- Grafana: `http://127.0.0.1:3000` (`admin` / `admin`)

Grafana auto-provisions the Prometheus datasource and imports `Project Veil Monitoring Overview`.

## What The Dashboard Shows

- `DAU Proxy (24h Login Events)`: `increase(veil_auth_guest_logins_total[24h]) + increase(veil_auth_account_logins_total[24h])`
- `Active Rooms`: `max(veil_active_rooms)`
- `Battle Duration P95`: `histogram_quantile(0.95, sum(rate(veil_battle_duration_seconds_bucket[30m])) by (le))`
- `Gameplay Error Rate`: `sum(rate(veil_action_validation_failures_total[5m])) / clamp_min(sum(rate(veil_gameplay_action_messages_total[5m])), 1)`

`DAU` is represented as a login-based proxy because the current `/metrics` endpoint exposes authentication counters but not a distinct unique-user gauge.

## Validate Scraping

1. Open Prometheus targets and confirm `project-veil-server` is `UP`.
2. Run these queries in Prometheus:

```promql
veil_up
max(veil_active_rooms)
histogram_quantile(0.95, sum(rate(veil_battle_duration_seconds_bucket[30m])) by (le))
```

3. Confirm Grafana panels render without `No data`.

## Validate Notification Delivery

The `ops-slack` receiver is selected when an alert carries `notify="ops-slack"`. Critical Project Veil alerts in `docs/alerting-rules.yml` now include that label.

To verify end-to-end delivery without waiting for a real incident, post a synthetic alert directly to Alertmanager:

```bash
curl -X POST http://127.0.0.1:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[
    {
      "labels": {
        "alertname": "VeilMonitoringPipelineDrill",
        "service": "project-veil-server",
        "severity": "critical",
        "notify": "ops-slack"
      },
      "annotations": {
        "summary": "Project Veil monitoring pipeline drill",
        "description": "Synthetic alert used to verify Alertmanager -> Slack delivery.",
        "runbook_url": "./docs/monitoring-setup.md#validate-notification-delivery"
      },
      "startsAt": "2026-04-11T00:00:00Z"
    }
  ]'
```

Expected result:

- Alert appears in `http://127.0.0.1:9093/#/alerts`
- Slack channel receives a formatted alert message
- Alert resolves automatically when the posted alert expires or is withdrawn

Record the drill in your deployment log with timestamp, receiver channel, and screenshot or copied Alertmanager event JSON.

## Production Notes

- Replace the Slack webhook secret with a production-managed secret mount.
- For Kubernetes or a VM-based deployment, keep `infra/prometheus.yml` and `infra/alertmanager.yml` unchanged and translate only the runtime wrapper from Docker Compose into your platform manifests.
- If the organization prefers DingTalk or WeCom robots, keep the same Prometheus rule labels and swap the Alertmanager receiver to a webhook bridge that transforms Alertmanager payloads into the provider-specific robot format.
