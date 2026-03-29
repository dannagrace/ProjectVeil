import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildCoverageSummary,
  coverageRoot,
  parseCoverageMetrics,
  renderFailureSection,
  writeSummary,
} from "../ci-v8-coverage.ts";

test("buildCoverageSummary flags branch and function floor misses alongside lines", () => {
  const summary = buildCoverageSummary(
    {
      name: "client",
      include: "apps/client/src/**/*.ts",
      lineThreshold: 80,
      branchThreshold: 70,
      functionThreshold: 75,
      tests: ["apps/client/test/**/*.test.ts"],
    },
    {
      lines: 79.25,
      branches: 69.5,
      functions: 74.99,
    },
  );

  assert.deepEqual(summary.failures, [
    { metric: "lines", actual: 79.25, threshold: 80 },
    { metric: "branches", actual: 69.5, threshold: 70 },
    { metric: "functions", actual: 74.99, threshold: 75 },
  ]);
});

test("renderFailureSection produces a clear failure list", () => {
  const lines = renderFailureSection([
    buildCoverageSummary(
      {
        name: "server",
        include: "apps/server/src/**/*.ts",
        lineThreshold: 75,
        branchThreshold: 65,
        functionThreshold: 75,
        tests: ["apps/server/test/**/*.test.ts"],
      },
      {
        lines: 77.25,
        branches: 64.99,
        functions: 74.5,
      },
    ),
  ]);

  assert.deepEqual(lines, [
    "## Threshold Failures",
    "",
    "- server: branches 64.99% below 65% floor; functions 74.50% below 75% floor",
  ]);
});

test("parseCoverageMetrics reads the all files summary row", () => {
  const metrics = parseCoverageMetrics(`
ℹ file | line % | branch % | funcs % | uncovered lines
ℹ all files                     |  77.25 |    70.92 |   80.69 |
`);

  assert.deepEqual(metrics, {
    lines: 77.25,
    branches: 70.92,
    functions: 80.69,
  });
});

test("writeSummary includes overall status and explicit threshold failures", async () => {
  fs.mkdirSync(coverageRoot, { recursive: true });

  await writeSummary([
    buildCoverageSummary(
      {
        name: "shared",
        include: "packages/shared/src/**/*.ts",
        lineThreshold: 90,
        branchThreshold: 70,
        functionThreshold: 90,
        tests: ["packages/shared/test/**/*.test.ts"],
      },
      {
        lines: 92.11,
        branches: 74.54,
        functions: 94.23,
      },
    ),
    buildCoverageSummary(
      {
        name: "server",
        include: "apps/server/src/**/*.ts",
        lineThreshold: 78,
        branchThreshold: 72,
        functionThreshold: 82,
        tests: ["apps/server/test/**/*.test.ts"],
      },
      {
        lines: 77.25,
        branches: 70.92,
        functions: 80.69,
      },
    ),
  ]);

  const markdown = fs.readFileSync(path.join(coverageRoot, "summary.md"), "utf8");
  const json = JSON.parse(fs.readFileSync(path.join(coverageRoot, "summary.json"), "utf8")) as Array<{
    branchThreshold: number;
    scope: string;
    functionThreshold: number;
    failures: Array<{ metric: string; actual: number; threshold: number }>;
    lineThreshold: number;
    metrics: { lines: number; branches: number; functions: number };
  }>;

  assert.match(markdown, /Overall status: \*\*FAILED\*\*/);
  assert.match(markdown, /## Threshold Failures/);
  assert.match(markdown, /- server: lines 77\.25% below 78% floor; branches 70\.92% below 72% floor; functions 80\.69% below 82% floor/);
  assert.match(markdown, /\| shared \| PASS 92\.11% vs 90% \| PASS 74\.54% vs 70% \| PASS 94\.23% vs 90% \|/);
  assert.deepEqual(json[1], {
    branchThreshold: 72,
    scope: "server",
    functionThreshold: 82,
    failures: [
      { metric: "lines", actual: 77.25, threshold: 78 },
      { metric: "branches", actual: 70.92, threshold: 72 },
      { metric: "functions", actual: 80.69, threshold: 82 },
    ],
    lineThreshold: 78,
    metrics: {
      lines: 77.25,
      branches: 70.92,
      functions: 80.69,
    },
  });
});
