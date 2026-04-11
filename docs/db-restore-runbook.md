# MySQL Backup Restore Runbook

## Scope

This runbook restores a Project Veil MySQL backup created by [`scripts/db-backup.sh`](../scripts/db-backup.sh) from S3-compatible object storage into a new MySQL instance, then verifies that the recovered instance is safe to promote.

Backup objects are stored as:

- Daily: `s3://<bucket>/<prefix>/daily/<database>-<timestamp>.sql.gz`
- Weekly: `s3://<bucket>/<prefix>/weekly/<database>-<timestamp>.sql.gz`
- Hash file: same object name plus `.sha256`

Example timestamp: `20260403T030000Z`.

## Preconditions

- A fresh MySQL instance is available and reachable.
- The target schema name exists or can be created.
- `aws`, `gzip`, `sha256sum` (or `shasum -a 256`), and `mysql` are installed on the restore host.
- The restore operator has object-storage read access and MySQL write access.

Required environment on the restore host:

```bash
export VEIL_BACKUP_S3_BUCKET=veil-ops
export VEIL_BACKUP_S3_PREFIX=backups/mysql
export VEIL_BACKUP_S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
export VEIL_BACKUP_S3_REGION=oss-cn-hangzhou

export RESTORE_MYSQL_HOST=127.0.0.1
export RESTORE_MYSQL_PORT=3306
export RESTORE_MYSQL_USER=root
export RESTORE_MYSQL_PASSWORD=change_me
export RESTORE_MYSQL_DATABASE=project_veil_restore
```

If your object storage uses a named AWS CLI profile, also export `VEIL_BACKUP_AWS_PROFILE`.

For rehearsals, prefer the automatable wrapper first:

```bash
export VEIL_RESTORE_BACKUP_KEY="$VEIL_BACKUP_S3_PREFIX/daily/project_veil-20260403T030000Z.sql.gz"
npm run db:restore:rehearsal
```

The remainder of this runbook explains the exact manual steps that wrapper executes so reviewers can audit or adapt the flow.

## 1. Pick The Backup To Restore

Choose the most recent daily backup that predates the incident. For a weekly rollback or compliance restore, pick the matching object under `weekly/`.

List available backups:

```bash
aws --endpoint-url "$VEIL_BACKUP_S3_ENDPOINT" --region "$VEIL_BACKUP_S3_REGION" \
  s3 ls "s3://$VEIL_BACKUP_S3_BUCKET/$VEIL_BACKUP_S3_PREFIX/daily/"
```

Record the exact object key you intend to restore, for example:

```bash
export BACKUP_KEY="$VEIL_BACKUP_S3_PREFIX/daily/project_veil-20260403T030000Z.sql.gz"
```

## 2. Download And Verify Integrity

Download the compressed dump and its checksum file:

```bash
export BACKUP_FILE="$(basename "$BACKUP_KEY")"

aws --endpoint-url "$VEIL_BACKUP_S3_ENDPOINT" --region "$VEIL_BACKUP_S3_REGION" \
  s3 cp "s3://$VEIL_BACKUP_S3_BUCKET/$BACKUP_KEY" "./$BACKUP_FILE"

aws --endpoint-url "$VEIL_BACKUP_S3_ENDPOINT" --region "$VEIL_BACKUP_S3_REGION" \
  s3 cp "s3://$VEIL_BACKUP_S3_BUCKET/$BACKUP_KEY.sha256" "./$BACKUP_FILE.sha256"
```

Verify the hash before touching MySQL:

```bash
sha256sum -c "./$BACKUP_FILE.sha256"
```

Expected result: `<database>-<timestamp>.sql.gz: OK`

If hash verification fails, stop. Do not restore from that object. Retrieve an earlier backup instead.

## 3. Restore Into A New MySQL Instance

Create the target database if needed:

```bash
mysql \
  --host="$RESTORE_MYSQL_HOST" \
  --port="$RESTORE_MYSQL_PORT" \
  --user="$RESTORE_MYSQL_USER" \
  --password="$RESTORE_MYSQL_PASSWORD" \
  -e "CREATE DATABASE IF NOT EXISTS \`$RESTORE_MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Load the dump:

```bash
gzip -dc "./$BACKUP_FILE" | mysql \
  --host="$RESTORE_MYSQL_HOST" \
  --port="$RESTORE_MYSQL_PORT" \
  --user="$RESTORE_MYSQL_USER" \
  --password="$RESTORE_MYSQL_PASSWORD" \
  "$RESTORE_MYSQL_DATABASE"
```

## 4. Validate The Recovered Data

Run a quick table-level sanity check:

```bash
mysql \
  --host="$RESTORE_MYSQL_HOST" \
  --port="$RESTORE_MYSQL_PORT" \
  --user="$RESTORE_MYSQL_USER" \
  --password="$RESTORE_MYSQL_PASSWORD" \
  --table \
  "$RESTORE_MYSQL_DATABASE" <<'SQL'
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
```

Then run the application-level persistence regression against the restored instance:

```bash
VEIL_MYSQL_HOST="$RESTORE_MYSQL_HOST" \
VEIL_MYSQL_PORT="$RESTORE_MYSQL_PORT" \
VEIL_MYSQL_USER="$RESTORE_MYSQL_USER" \
VEIL_MYSQL_PASSWORD="$RESTORE_MYSQL_PASSWORD" \
VEIL_MYSQL_DATABASE="$RESTORE_MYSQL_DATABASE" \
npm run test:phase1-release-persistence -- --storage mysql
```

Validation is complete when:

- Hash verification passed.
- The restore loaded without MySQL errors.
- Expected core tables are present with plausible row counts.
- `npm run test:phase1-release-persistence -- --storage mysql` passes on the restored instance.

## 5. Promote Or Hand Off

- Keep the recovered instance isolated until validation is complete.
- Record the restored backup timestamp, object key, and validation output in the incident log.
- Only repoint application traffic after the restored instance has passed the regression above.

## Migration Failure Handling

If a production rollout fails during DB migration/bootstrap, the server must not stay up in in-memory mode.

- Treat startup failure plus a non-zero exit code as the expected safeguard, not as a transient warning to ignore.
- Confirm `/api/runtime/health` is not reporting a degraded in-memory persistence status before reopening traffic.
- Fix MySQL reachability or apply the missing migration, then restart the service and recheck health.
- If the release window is at risk, roll back to the previous good build and continue recovery from a controlled host.

## Estimated RTO

Estimated RTO for a routine restore:

- Download from object storage: 2 to 10 minutes
- Hash verification: under 1 minute
- Import into a fresh MySQL instance: 5 to 20 minutes for moderate datasets
- Validation and promotion checks: 10 to 15 minutes

Practical target RTO: 20 to 45 minutes, assuming object storage and a standby MySQL host are both available.

## Rehearsal Recording

For production-readiness drills, capture these fields in the incident log or ops evidence bundle:

- `VEIL_RESTORE_BACKUP_KEY` used for the rehearsal
- restore host and schema name
- checksum verification output
- sanity-query row counts
- `npm run test:phase1-release-persistence -- --storage mysql` result
- measured start/end timestamps for the full rehearsal window
