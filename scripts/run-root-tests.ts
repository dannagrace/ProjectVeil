import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { listTrackedRootTestFiles } from "./root-test-discovery.ts";

const ROOT_TEST_COMMAND = [process.execPath, "--import", "tsx", "--test"] as const;
export const ROOT_TEST_CONCURRENCY = "4";

export function buildRootTestArgs(trackedTestFiles: string[]): string[] {
  return [
    ...ROOT_TEST_COMMAND.slice(1),
    `--test-concurrency=${ROOT_TEST_CONCURRENCY}`,
    ...trackedTestFiles,
  ];
}

function main(): never {
  const trackedTestFiles = listTrackedRootTestFiles();

  if (trackedTestFiles.length === 0) {
    throw new Error("Root test runner found no tracked *.test.ts files.");
  }

  const result = spawnSync(
    ROOT_TEST_COMMAND[0],
    buildRootTestArgs(trackedTestFiles),
    {
      cwd: process.cwd(),
      stdio: "inherit",
    },
  );

  if (typeof result.status === "number") {
    process.exit(result.status);
  }

  if (result.error) {
    throw result.error;
  }

  process.exit(1);
}

function isDirectRun(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  main();
}
