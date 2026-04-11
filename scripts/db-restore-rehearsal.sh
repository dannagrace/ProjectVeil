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
Usage: ./scripts/db-restore-rehearsal.sh

Required environment:
  VEIL_BACKUP_S3_BUCKET
  VEIL_RESTORE_BACKUP_KEY
  RESTORE_MYSQL_HOST
  RESTORE_MYSQL_USER
  RESTORE_MYSQL_PASSWORD

Optional environment:
  VEIL_BACKUP_S3_PREFIX=backups/mysql
  VEIL_BACKUP_S3_ENDPOINT=
  VEIL_BACKUP_S3_REGION=us-east-1
  VEIL_BACKUP_AWS_PROFILE=
  RESTORE_MYSQL_PORT=3306
  RESTORE_MYSQL_DATABASE=project_veil_restore
  VEIL_RESTORE_WORK_DIR=<mktemp dir>
  VEIL_RESTORE_DROP_DATABASE=0
  VEIL_RESTORE_SKIP_REGRESSION=0
  VEIL_RESTORE_SKIP_SCHEMA_VALIDATION=0
  VEIL_RESTORE_VALIDATE_COMMAND='npm run test:phase1-release-persistence -- --storage mysql'
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
  printf '[db-restore-rehearsal] %s\n' "$*"
}

require_command aws
require_command gzip
require_command mysql

if command -v sha256sum >/dev/null 2>&1; then
  SHA_VERIFY=(sha256sum -c)
elif command -v shasum >/dev/null 2>&1; then
  SHA_VERIFY=(shasum -a 256 -c)
else
  echo "Missing required command: sha256sum or shasum" >&2
  exit 1
fi

require_env VEIL_BACKUP_S3_BUCKET
require_env VEIL_RESTORE_BACKUP_KEY
require_env RESTORE_MYSQL_HOST
require_env RESTORE_MYSQL_USER
require_env RESTORE_MYSQL_PASSWORD

VEIL_BACKUP_S3_PREFIX="${VEIL_BACKUP_S3_PREFIX:-backups/mysql}"
VEIL_BACKUP_S3_REGION="${VEIL_BACKUP_S3_REGION:-us-east-1}"
RESTORE_MYSQL_PORT="${RESTORE_MYSQL_PORT:-3306}"
RESTORE_MYSQL_DATABASE="${RESTORE_MYSQL_DATABASE:-project_veil_restore}"
VEIL_RESTORE_DROP_DATABASE="${VEIL_RESTORE_DROP_DATABASE:-0}"
VEIL_RESTORE_SKIP_REGRESSION="${VEIL_RESTORE_SKIP_REGRESSION:-0}"
VEIL_RESTORE_SKIP_SCHEMA_VALIDATION="${VEIL_RESTORE_SKIP_SCHEMA_VALIDATION:-0}"
VEIL_RESTORE_VALIDATE_COMMAND="${VEIL_RESTORE_VALIDATE_COMMAND:-npm run test:phase1-release-persistence -- --storage mysql}"

TEMP_DIR_CREATED=0
WORK_DIR="${VEIL_RESTORE_WORK_DIR:-}"
if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/project-veil-db-restore.XXXXXX")"
  TEMP_DIR_CREATED=1
else
  mkdir -p "$WORK_DIR"
fi

cleanup() {
  if [[ "$TEMP_DIR_CREATED" == "1" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}

trap cleanup EXIT

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

BACKUP_FILE="$(basename "$VEIL_RESTORE_BACKUP_KEY")"
BACKUP_PATH="$WORK_DIR/$BACKUP_FILE"
BACKUP_HASH_PATH="$BACKUP_PATH.sha256"

download_object() {
  local object_key="$1"
  local destination="$2"
  "${AWS_CLI[@]}" s3 cp "s3://$VEIL_BACKUP_S3_BUCKET/$object_key" "$destination"
}

mysql_base_command() {
  mysql \
    --host="$RESTORE_MYSQL_HOST" \
    --port="$RESTORE_MYSQL_PORT" \
    --user="$RESTORE_MYSQL_USER" \
    --password="$RESTORE_MYSQL_PASSWORD" \
    "$@"
}

run_validation() {
  if [[ "$VEIL_RESTORE_SKIP_REGRESSION" == "1" ]]; then
    log "Skipping application regression because VEIL_RESTORE_SKIP_REGRESSION=1"
    return
  fi

  require_command npm
  log "Running application-level validation against restored database"
  (
    export VEIL_MYSQL_HOST="$RESTORE_MYSQL_HOST"
    export VEIL_MYSQL_PORT="$RESTORE_MYSQL_PORT"
    export VEIL_MYSQL_USER="$RESTORE_MYSQL_USER"
    export VEIL_MYSQL_PASSWORD="$RESTORE_MYSQL_PASSWORD"
    export VEIL_MYSQL_DATABASE="$RESTORE_MYSQL_DATABASE"
    cd "$ROOT_DIR"
    eval "$VEIL_RESTORE_VALIDATE_COMMAND"
  )
}

run_schema_validation() {
  if [[ "$VEIL_RESTORE_SKIP_SCHEMA_VALIDATION" == "1" ]]; then
    log "Skipping schema validation because VEIL_RESTORE_SKIP_SCHEMA_VALIDATION=1"
    return
  fi

  local expected_migrations
  expected_migrations="$(find "$ROOT_DIR/scripts/migrations" -maxdepth 1 -type f -name '*.ts' | wc -l | tr -d ' ')"
  local applied_migrations
  applied_migrations="$(
    mysql_base_command --batch --skip-column-names "$RESTORE_MYSQL_DATABASE" <<'SQL'
SELECT COUNT(*) FROM schema_migrations;
SQL
  )"

  applied_migrations="$(printf '%s' "$applied_migrations" | tr -d '[:space:]')"

  if [[ -z "$applied_migrations" || "$applied_migrations" != "$expected_migrations" ]]; then
    echo "Schema validation failed: expected ${expected_migrations} applied migrations, found ${applied_migrations:-0}." >&2
    exit 1
  fi

  log "Schema validation passed with ${applied_migrations} applied migrations"
}

log "Downloading backup object $VEIL_RESTORE_BACKUP_KEY"
download_object "$VEIL_RESTORE_BACKUP_KEY" "$BACKUP_PATH"
download_object "${VEIL_RESTORE_BACKUP_KEY}.sha256" "$BACKUP_HASH_PATH"

log "Verifying backup integrity"
(
  cd "$WORK_DIR"
  "${SHA_VERIFY[@]}" "./$BACKUP_FILE.sha256"
)

if [[ "$VEIL_RESTORE_DROP_DATABASE" == "1" ]]; then
  log "Dropping existing restore database $RESTORE_MYSQL_DATABASE"
  mysql_base_command -e "DROP DATABASE IF EXISTS \`$RESTORE_MYSQL_DATABASE\`;"
fi

log "Creating restore database $RESTORE_MYSQL_DATABASE"
mysql_base_command -e "CREATE DATABASE IF NOT EXISTS \`$RESTORE_MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

log "Restoring compressed dump into $RESTORE_MYSQL_DATABASE"
gzip -dc "$BACKUP_PATH" | mysql_base_command "$RESTORE_MYSQL_DATABASE"

log "Running table-level sanity query"
mysql_base_command --table "$RESTORE_MYSQL_DATABASE" <<'SQL'
SELECT 'room_snapshots' AS table_name, COUNT(*) AS row_count FROM room_snapshots
UNION ALL
SELECT 'player_room_profiles', COUNT(*) FROM player_room_profiles
UNION ALL
SELECT 'player_accounts', COUNT(*) FROM player_accounts
UNION ALL
SELECT 'player_event_history', COUNT(*) FROM player_event_history
UNION ALL
SELECT 'config_documents', COUNT(*) FROM config_documents;
SQL

run_schema_validation
run_validation

log "Restore rehearsal complete: $BACKUP_FILE -> $RESTORE_MYSQL_DATABASE"
