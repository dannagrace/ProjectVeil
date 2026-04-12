import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCTION_ENV_VARS = [
  "VEIL_MYSQL_HOST",
  "VEIL_MYSQL_PORT",
  "VEIL_MYSQL_USER",
  "VEIL_MYSQL_DATABASE",
  "VEIL_MYSQL_SNAPSHOT_TTL_HOURS",
  "VEIL_MYSQL_SNAPSHOT_CLEANUP_INTERVAL_MINUTES",
  "VEIL_SECRET_PROVIDER",
  "VEIL_AWS_SECRETS_MANAGER_SECRET_ID",
  "VEIL_AWS_SECRETS_MANAGER_REGION",
  "VEIL_BACKUP_S3_BUCKET",
  "VEIL_BACKUP_S3_PREFIX",
  "VEIL_BACKUP_S3_ENDPOINT",
  "VEIL_BACKUP_S3_REGION",
  "VEIL_BACKUP_AWS_PROFILE",
  "VEIL_BACKUP_KEEP_DAILY_DAYS",
  "VEIL_BACKUP_KEEP_WEEKLY_DAYS",
  "VEIL_BACKUP_WEEKLY_DAY",
  "VEIL_RATE_LIMIT_AUTH_WINDOW_MS",
  "VEIL_RATE_LIMIT_AUTH_MAX",
  "VEIL_RATE_LIMIT_WS_ACTION_WINDOW_MS",
  "VEIL_RATE_LIMIT_WS_ACTION_MAX",
  "VEIL_AUTH_LOCKOUT_THRESHOLD",
  "VEIL_AUTH_LOCKOUT_DURATION_MINUTES",
  "VEIL_MAX_GUEST_SESSIONS",
  "VEIL_AUTH_ACCESS_TTL_SECONDS",
  "VEIL_AUTH_REFRESH_TTL_SECONDS",
  "VEIL_AUTH_GUEST_TTL_SECONDS",
  "VEIL_MATCHMAKING_QUEUE_TTL_SECONDS",
  "ANALYTICS_ENDPOINT",
  "SENTRY_DSN"
];

function parseArgs(argv) {
  let envFile = "ops/env/production.env";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--env-file") {
      envFile = argv[index + 1];
      index += 1;
    }
  }
  return { envFile };
}

export function parseEnvFile(text) {
  const values = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  return values;
}

export function validateProductionEnv(values) {
  const missing = [];
  const blank = [];

  for (const key of PRODUCTION_ENV_VARS) {
    if (!values.has(key)) {
      missing.push(key);
      continue;
    }

    if (values.get(key)?.trim() === "") {
      blank.push(key);
    }
  }

  return { missing, blank, expectedCount: PRODUCTION_ENV_VARS.length };
}

export function runValidation(envFile) {
  const resolvedPath = path.resolve(envFile);
  const text = readFileSync(resolvedPath, "utf8");
  const values = parseEnvFile(text);
  return {
    envFile: resolvedPath,
    ...validateProductionEnv(values)
  };
}

function formatList(label, values) {
  return `${label}: ${values.join(", ")}`;
}

function main() {
  const { envFile } = parseArgs(process.argv.slice(2));
  const result = runValidation(envFile);

  if (result.missing.length > 0 || result.blank.length > 0) {
    if (result.missing.length > 0) {
      console.error(formatList("Missing keys", result.missing));
    }
    if (result.blank.length > 0) {
      console.error(formatList("Blank values", result.blank));
    }
    process.exit(1);
  }

  console.log(
    `Validated ${result.expectedCount} production env vars in ${result.envFile}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
