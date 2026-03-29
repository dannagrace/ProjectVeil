import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CoverageSuite = {
  name: string;
  include: string;
  lineThreshold: number;
  branchThreshold: number;
  functionThreshold: number;
  tests: string[];
};

type CoverageMetrics = {
  lines: number;
  branches: number;
  functions: number;
};

type CoverageFailure = {
  metric: keyof CoverageMetrics;
  actual: number | null;
  threshold: number;
};

type CoverageSummary = {
  suite: CoverageSuite;
  metrics: CoverageMetrics | null;
  failures: CoverageFailure[];
};

export const coverageRoot = path.resolve(".coverage");

export const suites: CoverageSuite[] = [
  {
    name: "shared",
    include: "packages/shared/src/**/*.ts",
    lineThreshold: 90,
    branchThreshold: 70,
    functionThreshold: 90,
    tests: ["packages/shared/test/**/*.test.ts"],
  },
  {
    name: "server",
    include: "apps/server/src/**/*.ts",
    lineThreshold: 75,
    branchThreshold: 65,
    functionThreshold: 75,
    tests: ["apps/server/test/**/*.test.ts"],
  },
  {
    name: "client",
    include: "apps/client/src/**/*.ts",
    lineThreshold: 78,
    branchThreshold: 65,
    functionThreshold: 70,
    tests: ["apps/client/test/**/*.test.ts"],
  },
  {
    name: "cocos-client",
    include: "apps/cocos-client/assets/scripts/**/*.ts",
    lineThreshold: 55,
    branchThreshold: 70,
    functionThreshold: 60,
    tests: ["apps/cocos-client/test/**/*.test.ts"],
  },
];

async function main() {
  await rm(coverageRoot, { force: true, recursive: true });
  await mkdir(path.join(coverageRoot, "v8"), { recursive: true });

  const summaries: CoverageSummary[] = [];

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
      `--test-coverage-branches=${suite.branchThreshold}`,
      `--test-coverage-functions=${suite.functionThreshold}`,
      ...suite.tests,
    ];

    process.stdout.write(`\n=== ${suite.name} coverage ===\n`);
    const { code, output } = await runNodeCommand(args, {
      ...process.env,
      NODE_V8_COVERAGE: suiteCoverageDir,
    });

    await writeFile(path.join(coverageRoot, `${suite.name}.log`), output);

    const metrics = parseCoverageMetrics(output);
    const summary = buildCoverageSummary(suite, metrics);
    summaries.push(summary);

    if (code !== 0) {
      await writeSummary(summaries);
      printFailureReport(summaries);
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

export function parseCoverageMetrics(output: string): CoverageMetrics | null {
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

export function buildCoverageSummary(
  suite: CoverageSuite,
  metrics: CoverageMetrics | null,
): CoverageSummary {
  const failures: CoverageFailure[] = [];

  if (!metrics) {
    failures.push(
      { metric: "lines", actual: null, threshold: suite.lineThreshold },
      { metric: "branches", actual: null, threshold: suite.branchThreshold },
      { metric: "functions", actual: null, threshold: suite.functionThreshold },
    );
  } else {
    if (metrics.lines < suite.lineThreshold) {
      failures.push({ metric: "lines", actual: metrics.lines, threshold: suite.lineThreshold });
    }
    if (metrics.branches < suite.branchThreshold) {
      failures.push({ metric: "branches", actual: metrics.branches, threshold: suite.branchThreshold });
    }
    if (metrics.functions < suite.functionThreshold) {
      failures.push({ metric: "functions", actual: metrics.functions, threshold: suite.functionThreshold });
    }
  }

  return {
    suite,
    metrics,
    failures,
  };
}

export async function writeSummary(summaries: CoverageSummary[]) {
  const failedSummaries = summaries.filter((summary) => summary.failures.length > 0);
  const lines = [
    "# V8 Coverage Summary",
    "",
    `Overall status: **${failedSummaries.length > 0 ? "FAILED" : "PASSED"}**`,
    "",
    ...renderFailureSection(failedSummaries),
    "",
    "| Scope | Lines | Branches | Functions |",
    "| --- | --- | --- | --- |",
    ...summaries.map(({ suite, metrics }) => {
      if (!metrics) {
        return `| ${suite.name} | n/a vs ${suite.lineThreshold}% | n/a vs ${suite.branchThreshold}% | n/a vs ${suite.functionThreshold}% |`;
      }
      return `| ${suite.name} | ${formatMetric(metrics.lines, suite.lineThreshold)} | ${formatMetric(metrics.branches, suite.branchThreshold)} | ${formatMetric(metrics.functions, suite.functionThreshold)} |`;
    }),
    "",
    `Raw V8 coverage artifacts: \`${path.relative(process.cwd(), path.join(coverageRoot, "v8"))}\``,
  ];

  await writeFile(path.join(coverageRoot, "summary.md"), `${lines.join("\n")}\n`);
  await writeFile(
    path.join(coverageRoot, "summary.json"),
    `${JSON.stringify(
      summaries.map(({ suite, metrics, failures }) => ({
        scope: suite.name,
        lineThreshold: suite.lineThreshold,
        branchThreshold: suite.branchThreshold,
        functionThreshold: suite.functionThreshold,
        metrics,
        failures,
      })),
      null,
      2,
    )}\n`,
  );
}

export function renderFailureSection(failedSummaries: CoverageSummary[]): string[] {
  if (failedSummaries.length === 0) {
    return ["## Threshold Failures", "", "None. All configured line, branch, and function coverage floors passed."];
  }

  return [
    "## Threshold Failures",
    "",
    ...failedSummaries.map(({ suite, failures }) => {
      const details = failures.map((failure) => formatFailure(failure)).join("; ");
      return `- ${suite.name}: ${details}`;
    }),
  ];
}

export function printFailureReport(summaries: CoverageSummary[]): void {
  const failedSummaries = summaries.filter((summary) => summary.failures.length > 0);
  if (failedSummaries.length === 0) {
    return;
  }

  process.stderr.write("\nCoverage threshold failures:\n");
  for (const line of renderFailureSection(failedSummaries).slice(2)) {
    process.stderr.write(`${line}\n`);
  }
}

function formatFailure(failure: CoverageFailure): string {
  if (failure.actual === null) {
    return `${failure.metric} missing coverage output vs ${failure.threshold}% floor`;
  }

  return `${failure.metric} ${failure.actual.toFixed(2)}% below ${failure.threshold}% floor`;
}

function formatMetric(actual: number, threshold: number): string {
  const passed = actual >= threshold;
  return `${passed ? "PASS" : "FAIL"} ${actual.toFixed(2)}% vs ${threshold}%`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
