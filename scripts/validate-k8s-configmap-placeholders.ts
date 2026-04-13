import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface PlaceholderMatch {
  key: string;
  value: string;
  pattern: string;
}

const DEFAULT_CONFIGMAP_PATH = resolve(process.cwd(), "k8s", "configmap.yaml");
const PLACEHOLDER_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "bare .example hostname", regex: /\.example($|\/|:)/ },
  { label: "placeholder Sentry ingest host", regex: /example\.ingest\.sentry\.io/ },
  { label: "REPLACE_ME token", regex: /REPLACE_ME/ },
  { label: "TODO token", regex: /TODO/ }
];

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = DEFAULT_CONFIGMAP_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      configPath = resolve(argv[index + 1] ?? configPath);
      index += 1;
    }
  }

  return { configPath };
}

function normalizeYamlScalar(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function findPlaceholderMatches(configContents: string): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  let inDataSection = false;

  for (const line of configContents.split(/\r?\n/)) {
    if (/^data:\s*$/.test(line)) {
      inDataSection = true;
      continue;
    }

    if (inDataSection && /^[^\s]/.test(line)) {
      break;
    }

    if (!inDataSection) {
      continue;
    }

    const entry = line.match(/^\s{2}([A-Z0-9_]+):\s*(.+?)\s*$/);
    if (!entry) {
      continue;
    }

    const [, key, rawValue] = entry;
    const value = normalizeYamlScalar(rawValue);

    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.regex.test(value)) {
        matches.push({ key, value, pattern: pattern.label });
      }
    }
  }

  return matches;
}

async function validateConfigMapPlaceholders(configPath: string): Promise<PlaceholderMatch[]> {
  const contents = await readFile(configPath, "utf8");
  return findPlaceholderMatches(contents);
}

async function main(): Promise<void> {
  const { configPath } = parseArgs(process.argv.slice(2));
  const matches = await validateConfigMapPlaceholders(configPath);

  if (matches.length === 0) {
    console.log(`Kubernetes ConfigMap placeholder gate: PASS (${configPath})`);
    return;
  }

  console.error(`Kubernetes ConfigMap placeholder gate: FAIL (${configPath})`);
  for (const match of matches) {
    console.error(`- ${match.key}: matched ${match.pattern} (${match.value})`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(
      `Kubernetes ConfigMap placeholder gate failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}

export { findPlaceholderMatches, validateConfigMapPlaceholders };
