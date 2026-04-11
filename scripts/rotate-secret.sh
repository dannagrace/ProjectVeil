#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/rotate-secret.sh --secret-id ID --key KEY --value VALUE [--region REGION] --restart COMMAND

Updates one JSON field in an AWS Secrets Manager secret, then runs the supplied restart command.

Example:
  scripts/rotate-secret.sh \
    --secret-id projectveil/production/server \
    --region us-east-1 \
    --key VEIL_AUTH_SECRET \
    --value "$(openssl rand -hex 32)" \
    --restart "docker compose -f docker-compose.prod.yml --env-file ops/env/production.env up -d server"
EOF
}

secret_id=""
region=""
key=""
value=""
restart_command=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --secret-id)
      secret_id="${2:-}"
      shift 2
      ;;
    --region)
      region="${2:-}"
      shift 2
      ;;
    --key)
      key="${2:-}"
      shift 2
      ;;
    --value)
      value="${2:-}"
      shift 2
      ;;
    --restart)
      restart_command="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$secret_id" || -z "$key" || -z "$value" || -z "$restart_command" ]]; then
  usage >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

aws_args=(--secret-id "$secret_id")
if [[ -n "$region" ]]; then
  aws_args+=(--region "$region")
fi

current_secret_json="$(aws secretsmanager get-secret-value "${aws_args[@]}" --query SecretString --output text)"
updated_secret_json="$(jq --arg key "$key" --arg value "$value" '.[$key] = $value' <<<"$current_secret_json")"

aws secretsmanager update-secret "${aws_args[@]}" --secret-string "$updated_secret_json" >/dev/null
eval "$restart_command"

echo "Rotated $key in $secret_id and executed restart command."
