import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

const repoRoot = path.resolve(__dirname, "../..");
const restoreScriptPath = path.join(repoRoot, "scripts", "db-restore-rehearsal.sh");

function writeExecutable(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o755 });
}

function createAwsStub(filePath: string): void {
  writeExecutable(
    filePath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const bucketRoot = process.env.VEIL_TEST_BUCKET_ROOT;
if (!bucketRoot) {
  process.stderr.write("VEIL_TEST_BUCKET_ROOT is required\\n");
  process.exit(1);
}

function stripGlobalOptions(values) {
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--profile" || value === "--region" || value === "--endpoint-url") {
      index += 1;
      continue;
    }
    result.push(value);
  }
  return result;
}

function parseS3Uri(uri) {
  const match = /^s3:\\/\\/([^/]+)\\/(.+)$/.exec(uri);
  if (!match) {
    throw new Error(\`Invalid S3 URI: \${uri}\`);
  }
  return {
    bucket: match[1],
    key: match[2],
    filePath: path.join(bucketRoot, match[1], match[2])
  };
}

const normalizedArgs = stripGlobalOptions(args);
if (normalizedArgs[0] !== "s3" || normalizedArgs[1] !== "cp") {
  process.stderr.write(\`Unexpected aws invocation: \${normalizedArgs.join(" ")}\\n\`);
  process.exit(1);
}

const source = normalizedArgs[2];
const destination = normalizedArgs[3];
if (source.startsWith("s3://")) {
  const sourceInfo = parseS3Uri(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(sourceInfo.filePath, destination);
  process.exit(0);
}

const destinationInfo = parseS3Uri(destination);
fs.mkdirSync(path.dirname(destinationInfo.filePath), { recursive: true });
fs.copyFileSync(source, destinationInfo.filePath);
process.exit(0);
`
  );
}

function createMysqlStub(filePath: string): void {
  writeExecutable(
    filePath,
    `#!/usr/bin/env node
const fs = require("node:fs");

const args = process.argv.slice(2);
const stdin = args.includes("-e") ? "" : fs.readFileSync(0, "utf8");
const logFile = process.env.VEIL_TEST_MYSQL_LOG_FILE;
if (logFile) {
  fs.appendFileSync(logFile, JSON.stringify({ args, stdin }) + "\\n", "utf8");
}

if (args.includes("--table")) {
  process.stdout.write("+----------------------+-----------+\\n");
  process.stdout.write("| table_name           | row_count |\\n");
  process.stdout.write("+----------------------+-----------+\\n");
  process.stdout.write("| room_snapshots       | 1         |\\n");
  process.stdout.write("| player_room_profiles | 2         |\\n");
  process.stdout.write("| player_accounts      | 2         |\\n");
  process.stdout.write("| player_event_history | 4         |\\n");
  process.stdout.write("| config_documents     | 3         |\\n");
  process.stdout.write("+----------------------+-----------+\\n");
}
`
  );
}

function createNpmStub(filePath: string): void {
  writeExecutable(
    filePath,
    `#!/usr/bin/env node
const fs = require("node:fs");

if (process.env.VEIL_TEST_NPM_LOG_FILE) {
  fs.writeFileSync(
    process.env.VEIL_TEST_NPM_LOG_FILE,
    JSON.stringify({
      args: process.argv.slice(2),
      mysqlHost: process.env.VEIL_MYSQL_HOST,
      mysqlPort: process.env.VEIL_MYSQL_PORT,
      mysqlUser: process.env.VEIL_MYSQL_USER,
      mysqlDatabase: process.env.VEIL_MYSQL_DATABASE
    }, null, 2),
    "utf8"
  );
}
`
  );
}

function createRestoreFixture(bucketDir: string, objectKey: string, hashContents?: string): void {
  const archivePath = path.join(bucketDir, objectKey);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const dump = "CREATE TABLE room_snapshots (room_id INT);\\nINSERT INTO room_snapshots VALUES (1);\\n";
  fs.writeFileSync(archivePath, zlib.gzipSync(Buffer.from(dump, "utf8")));

  const hash = spawnSync("sha256sum", [archivePath], { encoding: "utf8" });
  if (hash.status !== 0) {
    throw new Error(`sha256sum failed: ${hash.stderr}`);
  }
  const digest = hash.stdout.trim().split(/\s+/)[0];
  fs.writeFileSync(
    `${archivePath}.sha256`,
    hashContents ?? `${digest}  ${path.basename(objectKey)}\n`,
    "utf8"
  );
}

function runRestore(tempDir: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const toolsDir = path.join(tempDir, "tools");
  createAwsStub(path.join(toolsDir, "aws"));
  createMysqlStub(path.join(toolsDir, "mysql"));
  createNpmStub(path.join(toolsDir, "npm"));

  return spawnSync("bash", [restoreScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${toolsDir}:${process.env.PATH ?? ""}`,
      VEIL_TEST_BUCKET_ROOT: path.join(tempDir, "bucket-root"),
      VEIL_TEST_MYSQL_LOG_FILE: path.join(tempDir, "mysql.log"),
      VEIL_TEST_NPM_LOG_FILE: path.join(tempDir, "npm.json"),
      VEIL_BACKUP_S3_BUCKET: "veil-ops",
      VEIL_BACKUP_S3_PREFIX: "backups/mysql",
      VEIL_BACKUP_S3_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com",
      VEIL_BACKUP_S3_REGION: "oss-cn-hangzhou",
      VEIL_RESTORE_BACKUP_KEY: "backups/mysql/daily/project_veil-20260403T030000Z.sql.gz",
      RESTORE_MYSQL_HOST: "127.0.0.1",
      RESTORE_MYSQL_PORT: "3310",
      RESTORE_MYSQL_USER: "restore_user",
      RESTORE_MYSQL_PASSWORD: "secret",
      RESTORE_MYSQL_DATABASE: "project_veil_restore",
      ...extraEnv
    }
  });
}

test("db-restore-rehearsal restores a verified backup and runs the persistence regression", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-db-restore-"));
  const bucketDir = path.join(tempDir, "bucket-root", "veil-ops");
  createRestoreFixture(bucketDir, "backups/mysql/daily/project_veil-20260403T030000Z.sql.gz");

  const result = runRestore(tempDir);
  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stdout, /Restore rehearsal complete: project_veil-20260403T030000Z\.sql\.gz -> project_veil_restore/);

  const mysqlCalls = fs
    .readFileSync(path.join(tempDir, "mysql.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { args: string[]; stdin: string });
  assert.equal(mysqlCalls.length, 3);
  assert.match(mysqlCalls[0]?.args.join(" "), /CREATE DATABASE IF NOT EXISTS `project_veil_restore`/);
  assert.match(mysqlCalls[1]?.stdin ?? "", /CREATE TABLE room_snapshots/);
  assert.match(mysqlCalls[2]?.stdin ?? "", /SELECT 'room_snapshots' AS table_name/);

  const npmInvocation = JSON.parse(fs.readFileSync(path.join(tempDir, "npm.json"), "utf8")) as {
    args: string[];
    mysqlHost: string;
    mysqlPort: string;
    mysqlUser: string;
    mysqlDatabase: string;
  };
  assert.deepEqual(npmInvocation.args, ["run", "test:phase1-release-persistence", "--", "--storage", "mysql"]);
  assert.equal(npmInvocation.mysqlHost, "127.0.0.1");
  assert.equal(npmInvocation.mysqlPort, "3310");
  assert.equal(npmInvocation.mysqlUser, "restore_user");
  assert.equal(npmInvocation.mysqlDatabase, "project_veil_restore");
});

test("db-restore-rehearsal stops before mysql restore when checksum verification fails", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-db-restore-bad-hash-"));
  const bucketDir = path.join(tempDir, "bucket-root", "veil-ops");
  createRestoreFixture(
    bucketDir,
    "backups/mysql/daily/project_veil-20260403T030000Z.sql.gz",
    "deadbeef  project_veil-20260403T030000Z.sql.gz\n"
  );

  const result = runRestore(tempDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FAILED|failed|no properly formatted/i);
  assert.equal(fs.existsSync(path.join(tempDir, "mysql.log")), false);
  assert.equal(fs.existsSync(path.join(tempDir, "npm.json")), false);
});
