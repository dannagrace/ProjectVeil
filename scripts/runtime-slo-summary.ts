import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { RuntimeSloProfileId, RuntimeSloSummaryPayload } from "../apps/server/src/observability";

interface Args {
  serverUrl: string;
  profile: RuntimeSloProfileId;
  outputPath?: string;
  markdownOutputPath?: string;
  textOutputPath?: string;
}

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let serverUrl: string | undefined;
  let profile: RuntimeSloProfileId = "pr_diagnostics";
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let textOutputPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--server-url" && next) {
      serverUrl = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--profile" && next) {
      if (next !== "local_smoke" && next !== "pr_diagnostics" && next !== "candidate_gate") {
        fail(`Unsupported --profile value: ${next}`);
      }
      profile = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--text-output" && next) {
      textOutputPath = next.trim();
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!serverUrl) {
    fail("Missing required --server-url <base-url>.");
  }

  return {
    serverUrl: serverUrl.replace(/\/$/, ""),
    profile,
    ...(outputPath ? { outputPath: path.resolve(outputPath) } : {}),
    ...(markdownOutputPath ? { markdownOutputPath: path.resolve(markdownOutputPath) } : {}),
    ...(textOutputPath ? { textOutputPath: path.resolve(textOutputPath) } : {})
  };
}

function readGitShortRevision(): string {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : "unknown";
}

function resolveOutputPaths(args: Args): { json: string; markdown: string; text: string } {
  const shortRevision = readGitShortRevision();
  return {
    json: args.outputPath ?? path.join(DEFAULT_OUTPUT_DIR, `runtime-slo-summary-${shortRevision}.json`),
    markdown: args.markdownOutputPath ?? path.join(DEFAULT_OUTPUT_DIR, `runtime-slo-summary-${shortRevision}.md`),
    text: args.textOutputPath ?? path.join(DEFAULT_OUTPUT_DIR, `runtime-slo-summary-${shortRevision}.txt`)
  };
}

async function fetchJsonPayload<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    fail(`GET ${url} failed with ${response.status} ${response.statusText}`.trim());
  }
  return (await response.json()) as T;
}

async function fetchTextPayload(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    fail(`GET ${url} failed with ${response.status} ${response.statusText}`.trim());
  }
  return response.text();
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export async function runRuntimeSloSummaryCli(argv = process.argv): Promise<number> {
  const args = parseArgs(argv);
  const outputPaths = resolveOutputPaths(args);
  const [jsonReport, markdownReport, textReport] = await Promise.all([
    fetchJsonPayload<RuntimeSloSummaryPayload>(`${args.serverUrl}/api/runtime/slo-summary`),
    fetchTextPayload(`${args.serverUrl}/api/runtime/slo-summary?format=markdown`),
    fetchTextPayload(`${args.serverUrl}/api/runtime/slo-summary?format=text`)
  ]);

  writeFile(outputPaths.json, `${JSON.stringify(jsonReport, null, 2)}\n`);
  writeFile(outputPaths.markdown, markdownReport.endsWith("\n") ? markdownReport : `${markdownReport}\n`);
  writeFile(outputPaths.text, textReport.endsWith("\n") ? textReport : `${textReport}\n`);

  const selectedProfile = jsonReport.profiles.find((profile) => profile.id === args.profile);
  if (!selectedProfile) {
    fail(`Requested profile ${args.profile} is missing from the runtime SLO summary.`);
  }

  console.log(`Wrote runtime SLO summary JSON: ${path.relative(process.cwd(), outputPaths.json).replace(/\\/g, "/")}`);
  console.log(`Wrote runtime SLO summary Markdown: ${path.relative(process.cwd(), outputPaths.markdown).replace(/\\/g, "/")}`);
  console.log(`Wrote runtime SLO summary text: ${path.relative(process.cwd(), outputPaths.text).replace(/\\/g, "/")}`);
  console.log(`Selected profile ${selectedProfile.label}: ${selectedProfile.status.toUpperCase()} - ${selectedProfile.headline}`);

  return selectedProfile.status === "fail" ? 1 : 0;
}

const executedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedDirectly) {
  runRuntimeSloSummaryCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
