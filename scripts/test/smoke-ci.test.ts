import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeSmokeCi, parseSmokeCiArgs, renderSmokeCiMarkdown, runSmokeCiCli } from "../smoke-ci.mjs";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-smoke-ci-"));
}

test("parseSmokeCiArgs resolves explicit artifact paths", () => {
  const args = parseSmokeCiArgs([
    "--output",
    "tmp/report.json",
    "--markdown-output",
    "tmp/report.md",
    "--log-dir",
    "tmp/logs",
    "--github-step-summary",
    "tmp/summary.md"
  ]);

  assert.equal(args.output, path.resolve("tmp/report.json"));
  assert.equal(args.markdownOutput, path.resolve("tmp/report.md"));
  assert.equal(args.logDir, path.resolve("tmp/logs"));
  assert.equal(args.githubStepSummary, path.resolve("tmp/summary.md"));
});

test("executeSmokeCi stops at the first failure and marks later stages skipped", async () => {
  const workspace = makeWorkspace();
  const report = await executeSmokeCi(
    {
      output: path.join(workspace, "smoke-ci.json"),
      markdownOutput: path.join(workspace, "smoke-ci.md"),
      logDir: path.join(workspace, "logs")
    },
    {
      getShortCommitImpl: () => "abc1234",
      nowIsoImpl: () => "2026-04-12T00:00:00.000Z",
      runStageCommandImpl: async (stage, logPath) => {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.writeFileSync(logPath, `${stage.script}\n`);
        if (stage.script === "validate:quickstart") {
          return {
            status: "failed",
            durationMs: 25,
            failureMessage: "validate:quickstart exited with code 1"
          };
        }
        return {
          status: "passed",
          durationMs: 10,
          failureMessage: null
        };
      }
    }
  );

  assert.equal(report.summary.status, "failed");
  assert.equal(report.stages[0].status, "passed");
  assert.equal(report.stages[1].status, "failed");
  assert.equal(report.stages[2].status, "skipped");
  assert.match(renderSmokeCiMarkdown(report), /Overall result: `FAILED`/);
  assert.equal(fs.existsSync(path.join(workspace, "smoke-ci.json")), true);
  assert.equal(fs.existsSync(path.join(workspace, "smoke-ci.md")), true);
});

test("runSmokeCiCli writes summaries and step summary output", async () => {
  const workspace = makeWorkspace();
  const summaryPath = path.join(workspace, "step-summary.md");
  const outputPath = path.join(workspace, "out", "smoke-ci.json");
  const markdownPath = path.join(workspace, "out", "smoke-ci.md");
  const logDir = path.join(workspace, "logs");

  const report = await runSmokeCiCli(
    ["--output", outputPath, "--markdown-output", markdownPath, "--log-dir", logDir, "--github-step-summary", summaryPath],
    {
      assertSupportedRuntimeImpl: () => undefined,
      getShortCommitImpl: () => "abc1234",
      nowIsoImpl: () => "2026-04-12T00:00:00.000Z",
      runStageCommandImpl: async (_stage, logPath) => {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.writeFileSync(logPath, "ok\n");
        return {
          status: "passed",
          durationMs: 5,
          failureMessage: null
        };
      }
    }
  );

  assert.ok(report);
  assert.equal(report?.summary.status, "passed");
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).summary.status, "passed");
  assert.match(fs.readFileSync(markdownPath, "utf8"), /Repository Smoke CI/);
  assert.match(fs.readFileSync(summaryPath, "utf8"), /Repository Smoke CI/);
});
