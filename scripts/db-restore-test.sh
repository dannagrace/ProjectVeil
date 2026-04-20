#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: ./scripts/db-restore-test.sh

Discovers the latest backup object in S3-compatible storage, restores it into a test database,
verifies schema coverage, and runs the configured application regression.

Required environment:
  VEIL_BACKUP_S3_BUCKET
  RESTORE_MYSQL_HOST
  RESTORE_MYSQL_USER
  RESTORE_MYSQL_PASSWORD

Optional environment:
  VEIL_BACKUP_S3_PREFIX=backups/mysql
  VEIL_BACKUP_S3_ENDPOINT=
  VEIL_BACKUP_S3_REGION=us-east-1
  VEIL_BACKUP_AWS_PROFILE=
  VEIL_RESTORE_TEST_STORAGE_CLASS=daily
  VEIL_RESTORE_TEST_FALLBACK_STORAGE_CLASS=weekly
  RESTORE_MYSQL_PORT=3306
  RESTORE_MYSQL_DATABASE=project_veil_restore_test
  VEIL_RESTORE_DROP_DATABASE=1
  VEIL_RESTORE_SKIP_SCHEMA_VALIDATION=0
  VEIL_RESTORE_SKIP_REGRESSION=0
  VEIL_RESTORE_VALIDATE_COMMAND='npm test -- phase1-release-persistence -- --storage mysql'
EOF
  exit 0
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required environment variable: $key" >&2
    exit 1
  fi
}

log() {
  printf '[db-restore-test] %s\n' "$*"
}

require_command aws
require_command bash

require_env VEIL_BACKUP_S3_BUCKET
require_env RESTORE_MYSQL_HOST
require_env RESTORE_MYSQL_USER
require_env RESTORE_MYSQL_PASSWORD

VEIL_BACKUP_S3_PREFIX="${VEIL_BACKUP_S3_PREFIX:-backups/mysql}"
VEIL_BACKUP_S3_REGION="${VEIL_BACKUP_S3_REGION:-us-east-1}"
VEIL_RESTORE_TEST_STORAGE_CLASS="${VEIL_RESTORE_TEST_STORAGE_CLASS:-daily}"
VEIL_RESTORE_TEST_FALLBACK_STORAGE_CLASS="${VEIL_RESTORE_TEST_FALLBACK_STORAGE_CLASS:-weekly}"
RESTORE_MYSQL_DATABASE="${RESTORE_MYSQL_DATABASE:-project_veil_restore_test}"
VEIL_RESTORE_DROP_DATABASE="${VEIL_RESTORE_DROP_DATABASE:-1}"

AWS_CLI=(aws)
if [[ -n "${VEIL_BACKUP_AWS_PROFILE:-}" ]]; then
  AWS_CLI+=(--profile "$VEIL_BACKUP_AWS_PROFILE")
fi
if [[ -n "${VEIL_BACKUP_S3_REGION:-}" ]]; then
  AWS_CLI+=(--region "$VEIL_BACKUP_S3_REGION")
fi
if [[ -n "${VEIL_BACKUP_S3_ENDPOINT:-}" ]]; then
  AWS_CLI+=(--endpoint-url "$VEIL_BACKUP_S3_ENDPOINT")
fi

find_latest_backup_key() {
  local storage_class="$1"
  local prefix_uri="s3://$VEIL_BACKUP_S3_BUCKET/$VEIL_BACKUP_S3_PREFIX/$storage_class/"
  "${AWS_CLI[@]}" s3 ls "$prefix_uri" \
    | awk '{print $4}' \
    | grep -E '\.sql\.gz$' \
    | sort \
    | tail -n1 \
    | sed "s#^#$VEIL_BACKUP_S3_PREFIX/$storage_class/#"
}

latest_backup_key="$(find_latest_backup_key "$VEIL_RESTORE_TEST_STORAGE_CLASS" || true)"
if [[ -z "$latest_backup_key" && -n "$VEIL_RESTORE_TEST_FALLBACK_STORAGE_CLASS" ]]; then
  log "No backup found under $VEIL_RESTORE_TEST_STORAGE_CLASS; trying $VEIL_RESTORE_TEST_FALLBACK_STORAGE_CLASS"
  latest_backup_key="$(find_latest_backup_key "$VEIL_RESTORE_TEST_FALLBACK_STORAGE_CLASS" || true)"
fi

if [[ -z "$latest_backup_key" ]]; then
  echo "Could not find a backup object under $VEIL_BACKUP_S3_PREFIX/$VEIL_RESTORE_TEST_STORAGE_CLASS or $VEIL_RESTORE_TEST_FALLBACK_STORAGE_CLASS." >&2
  exit 1
fi

log "Using latest backup object $latest_backup_key"

(
  export VEIL_RESTORE_BACKUP_KEY="$latest_backup_key"
  export RESTORE_MYSQL_DATABASE
  export VEIL_RESTORE_DROP_DATABASE
  cd "$ROOT_DIR"
  bash ./scripts/db-restore-rehearsal.sh
)

log "Restore test passed for $latest_backup_key"
