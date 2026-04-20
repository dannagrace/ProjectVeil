import { config as loadEnv } from "dotenv";
import { pathToFileURL } from "node:url";
import { MySqlRoomSnapshotStore, readMySqlPersistenceConfig, type PlayerAccountSnapshot } from "@server/persistence";
import { findDisplayNameModerationViolation } from "../packages/shared/src/display-name-validation";
import { loadDisplayNameValidationRules } from "@server/domain/account/display-name-rules";

loadEnv();

export interface DisplayNameScanFinding {
  playerId: string;
  displayName: string;
  reason: string;
  matchedTerm: string;
}

export function scanAccountsForDisplayNameViolations(accounts: PlayerAccountSnapshot[]): DisplayNameScanFinding[] {
  const rules = loadDisplayNameValidationRules();
  const findings: DisplayNameScanFinding[] = [];

  for (const account of accounts) {
    const violation = findDisplayNameModerationViolation(account.displayName, rules);
    if (!violation) {
      continue;
    }

    findings.push({
      playerId: account.playerId,
      displayName: account.displayName,
      reason: violation.reason,
      matchedTerm: violation.term
    });
  }

  return findings;
}

function readFlag(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run player-names:scan -- --limit 500");
  console.log("  npm run player-names:scan -- --limit 500 --json");
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("help")) {
    printUsage();
    return;
  }

  const config = readMySqlPersistenceConfig();
  if (!config) {
    throw new Error(
      "Missing MySQL env config. Set VEIL_MYSQL_HOST, VEIL_MYSQL_USER, VEIL_MYSQL_PASSWORD and optionally VEIL_MYSQL_PORT / VEIL_MYSQL_DATABASE."
    );
  }

  const hardLimit = Math.max(1, Math.floor(Number(readFlag("--limit") ?? 1000)));
  const jsonOutput = process.argv.includes("--json");
  const store = await MySqlRoomSnapshotStore.create(config);
  const allAccounts: PlayerAccountSnapshot[] = [];

  try {
    const pageSize = Math.min(200, hardLimit);
    let offset = 0;

    while (allAccounts.length < hardLimit) {
      const page = await store.listPlayerAccounts({
        limit: Math.min(pageSize, hardLimit - allAccounts.length),
        offset
      });
      if (page.length === 0) {
        break;
      }
      allAccounts.push(...page);
      offset += page.length;
    }
  } finally {
    await store.close();
  }

  const findings = scanAccountsForDisplayNameViolations(allAccounts);
  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          scanned: allAccounts.length,
          findings
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Scanned ${allAccounts.length} player account(s).`);
  if (findings.length === 0) {
    console.log("No display-name violations found.");
    return;
  }

  console.table(findings);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
