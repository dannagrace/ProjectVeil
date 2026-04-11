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
Usage: ./scripts/db-backup.sh

Required environment:
  VEIL_MYSQL_HOST
  VEIL_MYSQL_USER
  VEIL_MYSQL_PASSWORD
  VEIL_BACKUP_S3_BUCKET

Optional environment:
  VEIL_MYSQL_PORT=3306
  VEIL_MYSQL_DATABASE=project_veil
  VEIL_BACKUP_S3_PREFIX=backups/mysql
  VEIL_BACKUP_S3_ENDPOINT=
  VEIL_BACKUP_S3_REGION=us-east-1
  VEIL_BACKUP_AWS_PROFILE=
  VEIL_BACKUP_KEEP_DAILY_DAYS=30
  VEIL_BACKUP_KEEP_WEEKLY_DAYS=183
  VEIL_BACKUP_WEEKLY_DAY=7
  VEIL_BACKUP_TMP_DIR=<mktemp dir>
  VEIL_BACKUP_NOTIFY_COMMAND=<shell command run on failure>
  VEIL_BACKUP_TIMESTAMP=<override UTC timestamp like 20260403T030000Z>
  VEIL_BACKUP_DAY_OF_WEEK=<1-7 override; 7 is Sunday>
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
  printf '[db-backup] %s\n' "$*"
}

notify_failure() {
  local message="$1"
  if [[ -n "${VEIL_BACKUP_NOTIFY_COMMAND:-}" ]]; then
    (
      export VEIL_BACKUP_FAILURE_MESSAGE="$message"
      export VEIL_BACKUP_FAILURE_TIMESTAMP="${BACKUP_TIMESTAMP:-unknown}"
      export VEIL_BACKUP_FAILURE_DATABASE="${VEIL_MYSQL_DATABASE:-project_veil}"
      bash -lc "$VEIL_BACKUP_NOTIFY_COMMAND"
    ) || true
  fi
}

on_error() {
  local exit_code="$1"
  local line_no="$2"
  local message="Backup failed on line ${line_no} with exit code ${exit_code}."
  echo "$message" >&2
  notify_failure "$message"
  exit "$exit_code"
}

trap 'on_error $? $LINENO' ERR

require_command mysqldump
require_command gzip
require_command aws

if command -v sha256sum >/dev/null 2>&1; then
  SHA_COMMAND=(sha256sum)
  SHA_VERIFY=(sha256sum -c)
elif command -v shasum >/dev/null 2>&1; then
  SHA_COMMAND=(shasum -a 256)
  SHA_VERIFY=(shasum -a 256 -c)
else
  echo "Missing required command: sha256sum or shasum" >&2
  exit 1
fi

require_env VEIL_MYSQL_HOST
require_env VEIL_MYSQL_USER
require_env VEIL_MYSQL_PASSWORD
require_env VEIL_BACKUP_S3_BUCKET

VEIL_MYSQL_PORT="${VEIL_MYSQL_PORT:-3306}"
VEIL_MYSQL_DATABASE="${VEIL_MYSQL_DATABASE:-project_veil}"
VEIL_BACKUP_S3_PREFIX="${VEIL_BACKUP_S3_PREFIX:-backups/mysql}"
VEIL_BACKUP_S3_REGION="${VEIL_BACKUP_S3_REGION:-us-east-1}"
VEIL_BACKUP_KEEP_DAILY_DAYS="${VEIL_BACKUP_KEEP_DAILY_DAYS:-30}"
VEIL_BACKUP_KEEP_WEEKLY_DAYS="${VEIL_BACKUP_KEEP_WEEKLY_DAYS:-183}"
VEIL_BACKUP_WEEKLY_DAY="${VEIL_BACKUP_WEEKLY_DAY:-7}"

BACKUP_TIMESTAMP="${VEIL_BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
BACKUP_DAY_OF_WEEK="${VEIL_BACKUP_DAY_OF_WEEK:-$(date -u +%u)}"

TEMP_DIR_CREATED=0
TMP_DIR="${VEIL_BACKUP_TMP_DIR:-}"
if [[ -z "$TMP_DIR" ]]; then
  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/project-veil-db-backup.XXXXXX")"
  TEMP_DIR_CREATED=1
else
  mkdir -p "$TMP_DIR"
fi

cleanup() {
  if [[ "$TEMP_DIR_CREATED" == "1" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
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

backup_base_name="${VEIL_MYSQL_DATABASE}-${BACKUP_TIMESTAMP}.sql.gz"
archive_path="${TMP_DIR}/${backup_base_name}"
hash_path="${archive_path}.sha256"

daily_key="${VEIL_BACKUP_S3_PREFIX}/daily/${backup_base_name}"
daily_hash_key="${daily_key}.sha256"
weekly_key="${VEIL_BACKUP_S3_PREFIX}/weekly/${backup_base_name}"
weekly_hash_key="${weekly_key}.sha256"

s3_uri() {
  printf 's3://%s/%s' "$VEIL_BACKUP_S3_BUCKET" "$1"
}

upload_file() {
  local source_path="$1"
  local object_key="$2"
  "${AWS_CLI[@]}" s3 cp "$source_path" "$(s3_uri "$object_key")"
}

cutoff_timestamp_days_ago() {
  local days="$1"
  date -u -d "${days} days ago" +%Y%m%dT%H%M%SZ
}

prune_prefix() {
  local storage_class="$1"
  local keep_days="$2"
  local cutoff
  cutoff="$(cutoff_timestamp_days_ago "$keep_days")"

  while read -r object_name; do
    [[ -z "$object_name" ]] && continue
    if [[ "$object_name" =~ ([0-9]{8}T[0-9]{6}Z) ]]; then
      local object_timestamp="${BASH_REMATCH[1]}"
      if [[ "$object_timestamp" < "$cutoff" ]]; then
        log "Pruning ${storage_class} object ${object_name}"
        "${AWS_CLI[@]}" s3 rm "$(s3_uri "${VEIL_BACKUP_S3_PREFIX}/${storage_class}/${object_name}")"
      fi
    fi
  done < <("${AWS_CLI[@]}" s3 ls "$(s3_uri "${VEIL_BACKUP_S3_PREFIX}/${storage_class}/")" | awk '{print $4}')
}

log "Creating MySQL dump for database ${VEIL_MYSQL_DATABASE}"
mysqldump \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  --host="$VEIL_MYSQL_HOST" \
  --port="$VEIL_MYSQL_PORT" \
  --user="$VEIL_MYSQL_USER" \
  "--password=$VEIL_MYSQL_PASSWORD" \
  "$VEIL_MYSQL_DATABASE" | gzip -c >"$archive_path"

archive_hash="$("${SHA_COMMAND[@]}" "$archive_path" | awk '{print $1}')"
printf '%s  %s\n' "$archive_hash" "$backup_base_name" >"$hash_path"
(
  cd "$TMP_DIR"
  "${SHA_VERIFY[@]}" "./$backup_base_name.sha256"
)

log "Uploading daily backup to $(s3_uri "$daily_key")"
upload_file "$archive_path" "$daily_key"
upload_file "$hash_path" "$daily_hash_key"

if [[ "$BACKUP_DAY_OF_WEEK" == "$VEIL_BACKUP_WEEKLY_DAY" ]]; then
  log "Uploading weekly backup to $(s3_uri "$weekly_key")"
  upload_file "$archive_path" "$weekly_key"
  upload_file "$hash_path" "$weekly_hash_key"
fi

prune_prefix "daily" "$VEIL_BACKUP_KEEP_DAILY_DAYS"
prune_prefix "weekly" "$VEIL_BACKUP_KEEP_WEEKLY_DAYS"

log "Backup complete: ${backup_base_name}"
