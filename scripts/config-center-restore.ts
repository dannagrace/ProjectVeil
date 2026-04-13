import path from "node:path";
import { FileSystemConfigCenterStore } from "../apps/server/src/config-center";

type ConfigDocumentId = "world" | "mapObjects" | "units" | "battleSkills" | "battleBalance";

interface CliArgs {
  configRoot: string;
  documentId: ConfigDocumentId | null;
  snapshotId: string | null;
  publishId: string | null;
  help: boolean;
}

const VALID_DOCUMENT_IDS: ConfigDocumentId[] = [
  "world",
  "mapObjects",
  "units",
  "battleSkills",
  "battleBalance",
  "leaderboardTierThresholds"
];

function printUsage(): void {
  console.log(`Usage: npm run config-center:restore -- --document <id> [--snapshot-id <snapshot>] [--publish-id <publish>]

Options:
  --document <id>       Config document id: ${VALID_DOCUMENT_IDS.join(", ")}
  --snapshot-id <id>    Roll back directly to a known snapshot id
  --publish-id <id>     Resolve the rollback snapshot recorded for a publish event
  --config-root <path>  Override config root (default: ./configs)
  --help                Show this help message
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    configRoot: path.resolve(process.cwd(), "configs"),
    documentId: null,
    snapshotId: null,
    publishId: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if ((token === "--config-root" || token === "--document" || token === "--snapshot-id" || token === "--publish-id") && !nextValue) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--config-root") {
      args.configRoot = path.resolve(process.cwd(), nextValue ?? "");
      index += 1;
      continue;
    }

    if (token === "--document") {
      if (!VALID_DOCUMENT_IDS.includes((nextValue ?? "") as ConfigDocumentId)) {
        throw new Error(`Unsupported document id: ${nextValue ?? ""}`);
      }
      args.documentId = (nextValue ?? "") as ConfigDocumentId;
      index += 1;
      continue;
    }

    if (token === "--snapshot-id") {
      args.snapshotId = nextValue ?? null;
      index += 1;
      continue;
    }

    if (token === "--publish-id") {
      args.publishId = nextValue ?? null;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

async function resolveSnapshotId(
  store: FileSystemConfigCenterStore,
  documentId: ConfigDocumentId,
  publishId: string | null,
  snapshotId: string | null
): Promise<string> {
  if (snapshotId) {
    return snapshotId;
  }

  if (!publishId) {
    throw new Error("Provide either --snapshot-id or --publish-id.");
  }

  const history = await store.listPublishAuditHistory();
  const publishEvent = history.find((entry) => entry.id === publishId);
  if (!publishEvent) {
    throw new Error(`Publish event not found: ${publishId}`);
  }

  const change = publishEvent.changes.find((entry) => entry.documentId === documentId);
  if (!change) {
    throw new Error(`Publish event ${publishId} does not include document ${documentId}`);
  }
  if (!change.snapshotId) {
    throw new Error(`Publish event ${publishId} has no rollback snapshot for ${documentId}`);
  }

  return change.snapshotId;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!args.documentId) {
    throw new Error("Missing required argument: --document");
  }
  if (args.snapshotId && args.publishId) {
    throw new Error("Use either --snapshot-id or --publish-id, not both.");
  }

  const store = new FileSystemConfigCenterStore(args.configRoot);
  try {
    const resolvedSnapshotId = await resolveSnapshotId(store, args.documentId, args.publishId, args.snapshotId);
    const restored = await store.rollbackToSnapshot(args.documentId, resolvedSnapshotId);
    console.log(
      `Restored ${restored.id} to snapshot ${resolvedSnapshotId} at version ${restored.version ?? "unknown"} (${restored.updatedAt})`
    );
  } finally {
    await store.close();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
