import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface Args {
  repo: string;
  sha: string;
  outputDir: string;
  runId?: string;
}

interface GithubRunSummary {
  databaseId: number;
  workflowName?: string;
  status?: string;
  conclusion?: string;
  headSha?: string;
  createdAt?: string;
}

function parseArgs(argv: string[]): Args {
  let repo = "dannagrace/ProjectVeil";
  let sha = "";
  let outputDir = "";
  let runId: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--repo" && next) {
      repo = next;
      index += 1;
      continue;
    }
    if (arg === "--sha" && next) {
      sha = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--run-id" && next) {
      runId = next.trim() || undefined;
      index += 1;
    }
  }

  if (!sha) {
    throw new Error("Missing required argument: --sha <git-sha>");
  }

  return {
    repo,
    sha,
    outputDir: outputDir || `artifacts/downloaded/wechat-release-${sha}`,
    ...(runId ? { runId } : {})
  };
}

function runCommand(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} ${args.join(" ")} failed.`);
  }
  return result.stdout;
}

function resolveRunId(repo: string, sha: string): string {
  const runsJson = runCommand("gh", [
    "run",
    "list",
    "--repo",
    repo,
    "--commit",
    sha,
    "--json",
    "databaseId,workflowName,status,conclusion,headSha,createdAt",
    "--limit",
    "20"
  ]);
  const runs = JSON.parse(runsJson) as GithubRunSummary[];
  const matchedRun = runs.find((run) => run.workflowName === "CI" && run.status === "completed");
  if (!matchedRun) {
    throw new Error(`No completed CI run found for ${repo}@${sha}.`);
  }
  return String(matchedRun.databaseId);
}

function main(): void {
  const args = parseArgs(process.argv);
  const artifactName = `wechat-release-${args.sha}`;
  const outputDir = path.resolve(args.outputDir);
  const runId = args.runId ?? resolveRunId(args.repo, args.sha);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  runCommand("gh", ["run", "download", runId, "--repo", args.repo, "--name", artifactName, "--dir", outputDir]);

  console.log(`Downloaded ${artifactName} from run ${runId}`);
  console.log(`Artifacts directory: ${outputDir}`);
}

main();
