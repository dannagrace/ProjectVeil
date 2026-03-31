import { execFileSync } from "node:child_process";

const TEST_FILE_PATTERN = /\.test\.ts$/;

export function listTrackedRootTestFiles(cwd = process.cwd()): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", "*.test.ts"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  return output
    .split("\0")
    .filter((filePath) => filePath.length > 0)
    .filter((filePath) => TEST_FILE_PATTERN.test(filePath))
    .sort((left, right) => left.localeCompare(right));
}
