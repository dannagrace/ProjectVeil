import { spawnSync } from "node:child_process";

export interface BackupStorageValidationResult {
  status: "ok" | "warn" | "skipped";
  message: string;
  lastSuccessTimestamp: number | null;
}

interface BackupStorageConfig {
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string;
  profile?: string;
}

function readBackupStorageConfig(): BackupStorageConfig | null {
  const bucket = process.env.VEIL_BACKUP_S3_BUCKET?.trim();
  if (!bucket) {
    return null;
  }

  const prefix = (process.env.VEIL_BACKUP_S3_PREFIX?.trim() || "backups/mysql").replace(/^\/+|\/+$/g, "");
  const region = process.env.VEIL_BACKUP_S3_REGION?.trim() || "us-east-1";
  const endpoint = process.env.VEIL_BACKUP_S3_ENDPOINT?.trim();
  const profile = process.env.VEIL_BACKUP_AWS_PROFILE?.trim();

  return {
    bucket,
    prefix,
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(profile ? { profile } : {})
  };
}

function createAwsCommand(config: BackupStorageConfig): string[] {
  const args: string[] = [];
  if (config.profile) {
    args.push("--profile", config.profile);
  }
  if (config.region) {
    args.push("--region", config.region);
  }
  if (config.endpoint) {
    args.push("--endpoint-url", config.endpoint);
  }
  return args;
}

function runAws(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("aws", args, {
    encoding: "utf8",
    env: process.env
  });
}

function toText(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return value.toString("utf8");
}

function parseLatestSuccessTimestamp(markerJson: string): number | null {
  try {
    const parsed = JSON.parse(markerJson) as {
      timestamp?: unknown;
      completedAt?: unknown;
    };
    const rawTimestamp =
      typeof parsed.timestamp === "string"
        ? parsed.timestamp
        : typeof parsed.completedAt === "string"
          ? parsed.completedAt
          : null;
    if (!rawTimestamp) {
      return null;
    }

    const timestampMs = Date.parse(rawTimestamp);
    if (!Number.isFinite(timestampMs)) {
      return null;
    }
    return Math.floor(timestampMs / 1000);
  } catch {
    return null;
  }
}

function parseLatestTimestampFromListing(listing: string): number | null {
  const candidates = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 4 && parts[3]?.endsWith(".sql.gz"))
    .map((parts) => `${parts[0]}T${parts[1]}Z`)
    .map((timestamp) => Date.parse(timestamp))
    .filter((value) => Number.isFinite(value));

  if (candidates.length === 0) {
    return null;
  }

  return Math.floor(Math.max(...candidates) / 1000);
}

export async function validateBackupStorageOnStartup(): Promise<BackupStorageValidationResult> {
  const config = readBackupStorageConfig();
  if (!config) {
    return {
      status: "skipped",
      message: "Backup storage validation skipped because VEIL_BACKUP_S3_BUCKET is not configured.",
      lastSuccessTimestamp: null
    };
  }

  const awsBaseArgs = createAwsCommand(config);
  const prefixUri = `s3://${config.bucket}/${config.prefix}/`;
  const listingResult = runAws([...awsBaseArgs, "s3", "ls", prefixUri]);
  if (listingResult.error) {
    return {
      status: "warn",
      message: `Backup storage validation failed for ${prefixUri}: ${listingResult.error.message}`,
      lastSuccessTimestamp: null
    };
  }
  if (listingResult.status !== 0) {
    return {
      status: "warn",
      message: `Backup storage validation failed for ${prefixUri}: ${(toText(listingResult.stderr) || toText(listingResult.stdout)).trim() || `aws exited ${listingResult.status}`}`,
      lastSuccessTimestamp: null
    };
  }

  const markerKey = `${config.prefix}/_status/latest-success.json`;
  const markerResult = runAws([...awsBaseArgs, "s3", "cp", `s3://${config.bucket}/${markerKey}`, "-"]);
  const markerTimestamp =
    markerResult.status === 0 && !markerResult.error && toText(markerResult.stdout)
      ? parseLatestSuccessTimestamp(toText(markerResult.stdout))
      : null;
  const listingTimestamp = parseLatestTimestampFromListing(toText(listingResult.stdout));
  const lastSuccessTimestamp = markerTimestamp ?? listingTimestamp;

  return {
    status: "ok",
    message:
      lastSuccessTimestamp == null
        ? `Backup storage validation passed for ${prefixUri}, but no completed backup marker was found yet.`
        : `Backup storage validation passed for ${prefixUri}.`,
    lastSuccessTimestamp
  };
}
