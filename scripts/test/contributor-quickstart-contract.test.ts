import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  renderContributorQuickstartContractMarkdown,
  runContributorQuickstartContract,
  type ContributorQuickstartContractReport
} from "../contributor-quickstart-contract.ts";

const repoRoot = path.resolve(__dirname, "../..");
const quickstartValidatorPath = path.join(repoRoot, "scripts", "validate-local-dev-quickstart.mjs");

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-quickstart-contract-"));
}

function writeFile(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function createFixtureWorkspace(readmeText: string): {
  workspace: string;
  readmePath: string;
  packageJsonPath: string;
  outputPath: string;
  markdownOutputPath: string;
} {
  const workspace = createTempWorkspace();
  const readmePath = path.join(workspace, "README.md");
  const packageJsonPath = path.join(workspace, "package.json");
  const outputPath = path.join(workspace, "artifacts", "quickstart-contract.json");
  const markdownOutputPath = path.join(workspace, "artifacts", "quickstart-contract.md");

  writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        scripts: {
          doctor: "node ./scripts/repo-doctor.mjs",
          "validate:quickstart": "node ./scripts/validate-local-dev-quickstart.mjs",
          "build:client:h5": "vite build --config apps/client/vite.config.ts",
          "dev:client:h5": "vite --config apps/client/vite.config.ts"
        }
      },
      null,
      2
    )
  );
  writeFile(readmePath, readmeText);

  return {
    workspace,
    readmePath,
    packageJsonPath,
    outputPath,
    markdownOutputPath
  };
}

const README_FIXTURE = `### 5-Minute Setup

\`\`\`bash
nvm use
npm ci --no-audit --no-fund
npm run doctor
npm run validate:quickstart
\`\`\`

\`npm run validate:quickstart\` builds the H5 debug shell and checks health / auth-readiness / lobby endpoints.

\`\`\`bash
npm run dev:client:h5
\`\`\`

- H5 debug shell: \`http://127.0.0.1:5173/\`
- Runtime health: \`http://127.0.0.1:2567/api/runtime/health\`
`;

test("quickstart contract reports pass when docs and entry points stay aligned", async () => {
  const fixture = createFixtureWorkspace(README_FIXTURE);

  const report = await runContributorQuickstartContract({
    repoRoot: fixture.workspace,
    readmePath: fixture.readmePath,
    packageJsonPath: fixture.packageJsonPath,
    quickstartValidatorPath,
    outputPath: fixture.outputPath,
    markdownOutputPath: fixture.markdownOutputPath,
    skipRuntime: true
  });

  assert.equal(report.summary.status, "passed");
  assert.equal(report.inputs.runtimeSkipped, true);
  assert.equal(fs.existsSync(fixture.outputPath), true);
  assert.equal(fs.existsSync(fixture.markdownOutputPath), true);
  assert.match(fs.readFileSync(fixture.markdownOutputPath, "utf8"), /Contributor Quickstart Contract Audit/);
});

test("quickstart contract flags README drift with actionable stage failures", async () => {
  const fixture = createFixtureWorkspace(`### 5-Minute Setup

\`\`\`bash
nvm use
npm ci --no-audit --no-fund
npm run doctor
\`\`\`
`);

  const report = await runContributorQuickstartContract({
    repoRoot: fixture.workspace,
    readmePath: fixture.readmePath,
    packageJsonPath: fixture.packageJsonPath,
    quickstartValidatorPath,
    outputPath: fixture.outputPath,
    markdownOutputPath: fixture.markdownOutputPath,
    skipRuntime: true
  });

  assert.equal(report.summary.status, "failed");
  assert.equal(report.stages.some((stage) => stage.id === "readme-5-minute-setup" && stage.status === "failed"), true);
  assert.equal(report.stages.some((stage) => stage.id === "readme-runtime-promises" && stage.status === "failed"), true);
});

test("quickstart contract captures runtime command failures in the report", async () => {
  const fixture = createFixtureWorkspace(README_FIXTURE);
  const invokedScripts: string[] = [];

  const report = await runContributorQuickstartContract(
    {
      repoRoot: fixture.workspace,
      readmePath: fixture.readmePath,
      packageJsonPath: fixture.packageJsonPath,
      quickstartValidatorPath,
      outputPath: fixture.outputPath,
      markdownOutputPath: fixture.markdownOutputPath,
      skipRuntime: false
    },
    {
      runScript: (scriptName) => {
        invokedScripts.push(scriptName);
        if (scriptName === "validate:quickstart") {
          return {
            status: 1,
            stdout: "",
            stderr: "[quickstart] validation failed: boom"
          };
        }
        return {
          status: 0,
          stdout: "ok",
          stderr: ""
        };
      }
    }
  );

  assert.deepEqual(invokedScripts, ["doctor", "validate:quickstart"]);
  assert.equal(report.summary.status, "failed");
  assert.equal(
    report.stages.some(
      (stage) =>
        stage.id === "runtime-validate-quickstart" &&
        stage.status === "failed" &&
        stage.stderrTail?.includes("boom")
    ),
    true
  );
});

test("quickstart contract CLI writes artifacts for the checked-out repo", () => {
  const workspace = createTempWorkspace();
  const outputPath = path.join(workspace, "quickstart-contract.json");
  const markdownOutputPath = path.join(workspace, "quickstart-contract.md");

  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/contributor-quickstart-contract.ts",
      "--skip-runtime",
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stdout, /Wrote quickstart contract JSON:/);

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as ContributorQuickstartContractReport;
  assert.equal(report.summary.status, "passed");
  assert.match(fs.readFileSync(markdownOutputPath, "utf8"), /Runtime stages: skipped/);
});

test("quickstart contract markdown renders stage remediation and runtime context", () => {
  const markdown = renderContributorQuickstartContractMarkdown({
    schemaVersion: 1,
    generatedAt: "2026-04-06T12:00:00.000Z",
    summary: {
      status: "failed",
      totalStages: 1,
      failedStages: 1,
      headline: "Contributor quickstart contract failed."
    },
    contract: {
      doctorScript: "doctor",
      validateQuickstartScript: "validate:quickstart",
      h5BuildScript: "build:client:h5",
      h5DevScript: "dev:client:h5",
      serverUrl: "http://127.0.0.1:2567",
      healthChecks: ["/api/runtime/health"]
    },
    inputs: {
      readmePath: "README.md",
      packageJsonPath: "package.json",
      quickstartValidatorPath: "scripts/validate-local-dev-quickstart.mjs",
      runtimeSkipped: false
    },
    artifacts: {
      jsonPath: "artifacts/release-readiness/contract.json",
      markdownPath: "artifacts/release-readiness/contract.md"
    },
    stages: [
      {
        id: "runtime-validate-quickstart",
        label: "Quickstart validator still exercises the advertised H5 build and server boot flow",
        category: "runtime",
        status: "failed",
        summary: "validation failed",
        remediation: "Repair the validator.",
        details: ["Command: `npm run validate:quickstart`"],
        command: "npm run validate:quickstart",
        exitCode: 1,
        durationMs: 42,
        stderrTail: "boom"
      }
    ]
  });

  assert.match(markdown, /Remediation: Repair the validator/);
  assert.match(markdown, /Exit code: 1/);
  assert.match(markdown, /Stderr tail:/);
});
