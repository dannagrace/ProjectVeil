import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

type CoverageSuite = {
  name: string;
  include: string;
  lineThreshold: number;
  tests: string[];
};

type CoverageMetrics = {
  lines: number;
  branches: number;
  functions: number;
};

const coverageRoot = path.resolve(".coverage");

const suites: CoverageSuite[] = [
  {
    name: "shared",
    include: "packages/shared/src/**/*.ts",
    lineThreshold: 90,
    tests: ["packages/shared/test/**/*.test.ts"],
  },
  {
    name: "server",
    include: "apps/server/src/**/*.ts",
    lineThreshold: 75,
    tests: ["apps/server/test/**/*.test.ts"],
  },
  {
    name: "client",
    include: "apps/client/src/**/*.ts",
    lineThreshold: 78,
    tests: ["apps/client/test/**/*.test.ts"],
  },
  {
    name: "cocos-client",
    include: "apps/cocos-client/assets/scripts/**/*.ts",
    lineThreshold: 55,
    tests: ["apps/cocos-client/test/**/*.test.ts"],
  },
];

async function main() {
  await rm(coverageRoot, { force: true, recursive: true });
  await mkdir(path.join(coverageRoot, "v8"), { recursive: true });

  const summaries: Array<{ suite: CoverageSuite; metrics: CoverageMetrics | null }> = [];

  for (const suite of suites) {
    const suiteCoverageDir = path.join(coverageRoot, "v8", suite.name);
    await mkdir(suiteCoverageDir, { recursive: true });

    const args = [
      "--import",
      "tsx",
      "--test",
      "--experimental-test-coverage",
      `--test-coverage-include=${suite.include}`,
      `--test-coverage-lines=${suite.lineThreshold}`,
      ...suite.tests,
    ];

    process.stdout.write(`\n=== ${suite.name} coverage ===\n`);
    const { code, output } = await runNodeCommand(args, {
      ...process.env,
      NODE_V8_COVERAGE: suiteCoverageDir,
    });

    await writeFile(path.join(coverageRoot, `${suite.name}.log`), output);

    const metrics = parseCoverageMetrics(output);
    summaries.push({ suite, metrics });

    if (code !== 0) {
      await writeSummary(summaries);
      process.exit(code ?? 1);
    }
  }

  await writeSummary(summaries);
}

function runNodeCommand(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

function parseCoverageMetrics(output: string): CoverageMetrics | null {
  const match = output.match(/all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
  if (!match) {
    return null;
  }

  return {
    lines: Number(match[1]),
    branches: Number(match[2]),
    functions: Number(match[3]),
  };
}

async function writeSummary(
  summaries: Array<{ suite: CoverageSuite; metrics: CoverageMetrics | null }>,
) {
  const lines = [
    "# V8 Coverage Summary",
    "",
    "| Scope | Line Threshold | Line % | Branch % | Function % |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...summaries.map(({ suite, metrics }) => {
      if (!metrics) {
        return `| ${suite.name} | ${suite.lineThreshold}% | n/a | n/a | n/a |`;
      }
      return `| ${suite.name} | ${suite.lineThreshold}% | ${metrics.lines.toFixed(2)}% | ${metrics.branches.toFixed(2)}% | ${metrics.functions.toFixed(2)}% |`;
    }),
    "",
    `Raw V8 coverage artifacts: \`${path.relative(process.cwd(), path.join(coverageRoot, "v8"))}\``,
  ];

  await writeFile(path.join(coverageRoot, "summary.md"), `${lines.join("\n")}\n`);
  await writeFile(
    path.join(coverageRoot, "summary.json"),
    `${JSON.stringify(
      summaries.map(({ suite, metrics }) => ({
        scope: suite.name,
        lineThreshold: suite.lineThreshold,
        metrics,
      })),
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
