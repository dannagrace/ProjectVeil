import { spawnSync } from "node:child_process";
import process from "node:process";
import { listTrackedRootTestFiles } from "./root-test-discovery.ts";

const ROOT_TEST_COMMAND = [process.execPath, "--import", "tsx", "--test"] as const;

function main(): never {
  const trackedTestFiles = listTrackedRootTestFiles();

  if (trackedTestFiles.length === 0) {
    throw new Error("Root test runner found no tracked *.test.ts files.");
  }

  const result = spawnSync(
    ROOT_TEST_COMMAND[0],
    [...ROOT_TEST_COMMAND.slice(1), ...trackedTestFiles],
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

main();
