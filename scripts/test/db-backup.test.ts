import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");
const backupScriptPath = path.join(repoRoot, "scripts", "db-backup.sh");

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

function listFilesRecursively(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const entries = [];
  for (const name of fs.readdirSync(root)) {
    const entryPath = path.join(root, name);
    const stats = fs.statSync(entryPath);
    if (stats.isDirectory()) {
      for (const child of listFilesRecursively(entryPath)) {
        entries.push(path.join(name, child));
      }
      continue;
    }
    entries.push(name);
  }
  return entries.sort();
}

const normalizedArgs = stripGlobalOptions(args);
if (normalizedArgs[0] !== "s3") {
  process.stderr.write(\`Unexpected aws invocation: \${normalizedArgs.join(" ")}\\n\`);
  process.exit(1);
}

if (normalizedArgs[1] === "cp") {
  const source = normalizedArgs[2];
  const destination = parseS3Uri(normalizedArgs[3]);
  fs.mkdirSync(path.dirname(destination.filePath), { recursive: true });
  fs.copyFileSync(source, destination.filePath);
  process.exit(0);
}

if (normalizedArgs[1] === "rm") {
  const target = parseS3Uri(normalizedArgs[2]);
  fs.rmSync(target.filePath, { force: true });
  process.exit(0);
}

if (normalizedArgs[1] === "ls") {
  const target = parseS3Uri(normalizedArgs[2]);
  const files = listFilesRecursively(target.filePath);
  for (const file of files) {
    process.stdout.write(\`2026-04-03 03:00:00         10 \${file}\\n\`);
  }
  process.exit(0);
}

process.stderr.write(\`Unexpected aws invocation: \${normalizedArgs.join(" ")}\\n\`);
process.exit(1);
`
  );
}

function createMysqlDumpStub(filePath: string): void {
  writeExecutable(
    filePath,
    `#!/usr/bin/env node
const fs = require("node:fs");

if (process.env.VEIL_TEST_MYSQLDUMP_ARGS_FILE) {
  fs.writeFileSync(process.env.VEIL_TEST_MYSQLDUMP_ARGS_FILE, process.argv.slice(2).join("\\n"), "utf8");
}

if (process.env.VEIL_TEST_MYSQLDUMP_FAIL === "1") {
  process.stderr.write("mysqldump failed\\n");
  process.exit(2);
}

process.stdout.write("CREATE TABLE players (id INT);\\nINSERT INTO players VALUES (1);\\n");
`
  );
}

function sha256Of(filePath: string): string {
  const result = spawnSync("sha256sum", [filePath], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`sha256sum failed for ${filePath}: ${result.stderr}`);
  }
  return result.stdout.trim().split(/\s+/)[0] ?? "";
}

function runBackup(tempDir: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const toolsDir = path.join(tempDir, "tools");
  const bucketRoot = path.join(tempDir, "bucket-root");
  const argsFile = path.join(tempDir, "mysqldump-args.txt");

  createAwsStub(path.join(toolsDir, "aws"));
  createMysqlDumpStub(path.join(toolsDir, "mysqldump"));

  return spawnSync("bash", [backupScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${toolsDir}:${process.env.PATH ?? ""}`,
      VEIL_TEST_BUCKET_ROOT: bucketRoot,
      VEIL_TEST_MYSQLDUMP_ARGS_FILE: argsFile,
      VEIL_MYSQL_HOST: "mysql.internal",
      VEIL_MYSQL_PORT: "3307",
      VEIL_MYSQL_USER: "backup_user",
      VEIL_MYSQL_PASSWORD: "secret",
      VEIL_MYSQL_DATABASE: "project_veil",
      VEIL_BACKUP_S3_BUCKET: "veil-ops",
      VEIL_BACKUP_S3_PREFIX: "backups/mysql",
      VEIL_BACKUP_S3_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com",
      VEIL_BACKUP_S3_REGION: "oss-cn-hangzhou",
      VEIL_BACKUP_KEEP_DAILY_DAYS: "30",
      VEIL_BACKUP_KEEP_WEEKLY_DAYS: "183",
      VEIL_BACKUP_WEEKLY_DAY: "7",
      VEIL_BACKUP_TIMESTAMP: "20260403T030000Z",
      VEIL_BACKUP_DAY_OF_WEEK: "7",
      ...extraEnv
    }
  });
}

test("db-backup uploads compressed dumps, writes hashes, and prunes expired backups", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-db-backup-"));
  const bucketDir = path.join(tempDir, "bucket-root", "veil-ops", "backups", "mysql");
  fs.mkdirSync(path.join(bucketDir, "daily"), { recursive: true });
  fs.mkdirSync(path.join(bucketDir, "weekly"), { recursive: true });

  const staleDaily = path.join(bucketDir, "daily", "project_veil-20260201T030000Z.sql.gz");
  const freshDaily = path.join(bucketDir, "daily", "project_veil-20260320T030000Z.sql.gz");
  const staleWeekly = path.join(bucketDir, "weekly", "project_veil-20250901T030000Z.sql.gz");
  const freshWeekly = path.join(bucketDir, "weekly", "project_veil-20251201T030000Z.sql.gz");
  fs.writeFileSync(staleDaily, "old daily", "utf8");
  fs.writeFileSync(`${staleDaily}.sha256`, "old daily hash", "utf8");
  fs.writeFileSync(freshDaily, "fresh daily", "utf8");
  fs.writeFileSync(`${freshDaily}.sha256`, "fresh daily hash", "utf8");
  fs.writeFileSync(staleWeekly, "old weekly", "utf8");
  fs.writeFileSync(`${staleWeekly}.sha256`, "old weekly hash", "utf8");
  fs.writeFileSync(freshWeekly, "fresh weekly", "utf8");
  fs.writeFileSync(`${freshWeekly}.sha256`, "fresh weekly hash", "utf8");

  const result = runBackup(tempDir);
  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stdout, /Backup complete: project_veil-20260403T030000Z\.sql\.gz/);

  const dailyArchive = path.join(bucketDir, "daily", "project_veil-20260403T030000Z.sql.gz");
  const dailyHash = `${dailyArchive}.sha256`;
  const weeklyArchive = path.join(bucketDir, "weekly", "project_veil-20260403T030000Z.sql.gz");
  const weeklyHash = `${weeklyArchive}.sha256`;

  assert.equal(fs.existsSync(dailyArchive), true);
  assert.equal(fs.existsSync(dailyHash), true);
  assert.equal(fs.existsSync(weeklyArchive), true);
  assert.equal(fs.existsSync(weeklyHash), true);

  const uploadedHashLine = fs.readFileSync(dailyHash, "utf8").trim();
  assert.equal(uploadedHashLine.split(/\s+/)[0], sha256Of(dailyArchive));

  assert.equal(fs.existsSync(staleDaily), false);
  assert.equal(fs.existsSync(`${staleDaily}.sha256`), false);
  assert.equal(fs.existsSync(staleWeekly), false);
  assert.equal(fs.existsSync(`${staleWeekly}.sha256`), false);
  assert.equal(fs.existsSync(freshDaily), true);
  assert.equal(fs.existsSync(freshWeekly), true);

  const argsFile = path.join(tempDir, "mysqldump-args.txt");
  const dumpArgs = fs.readFileSync(argsFile, "utf8");
  assert.match(dumpArgs, /--host=mysql\.internal/);
  assert.match(dumpArgs, /--port=3307/);
  assert.match(dumpArgs, /--user=backup_user/);
  assert.match(dumpArgs, /project_veil/);
});

test("db-backup triggers the notify hook on failure", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-db-backup-fail-"));
  const notifyFile = path.join(tempDir, "notify.txt");

  const result = runBackup(tempDir, {
    VEIL_TEST_MYSQLDUMP_FAIL: "1",
    VEIL_BACKUP_NOTIFY_COMMAND: `printf '%s\n' "$VEIL_BACKUP_FAILURE_MESSAGE" > "${notifyFile}"`
  });

  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(notifyFile), true);
  assert.match(fs.readFileSync(notifyFile, "utf8"), /Backup failed on line/);
});
