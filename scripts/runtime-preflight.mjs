import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function normalizeVersion(version) {
  return version.replace(/^v/i, "").trim();
}

export function parseMajor(version) {
  const match = normalizeVersion(version).match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

export function parsePackageManagerVersion(packageManager) {
  const match = packageManager?.match(/^npm@(.+)$/);
  return match ? normalizeVersion(match[1]) : null;
}

export function parseRange(range) {
  const boundedMatch = range?.match(/^>=\s*(\d+)\s*<\s*(\d+)$/);
  if (boundedMatch) {
    return { minInclusive: Number(boundedMatch[1]), maxExclusive: Number(boundedMatch[2]) };
  }

  const lowerBoundMatch = range?.match(/^>=\s*(\d+)$/);
  if (lowerBoundMatch) {
    return { minInclusive: Number(lowerBoundMatch[1]), maxExclusive: null };
  }

  const upperBoundMatch = range?.match(/^<\s*(\d+)$/);
  if (upperBoundMatch) {
    return { minInclusive: null, maxExclusive: Number(upperBoundMatch[1]) };
  }

  if (!range) {
    return null;
  }
  return null;
}

export function versionSatisfiesMajorRange(version, range) {
  const major = parseMajor(version);
  if (major == null) {
    return false;
  }
  const parsedRange = parseRange(range);
  if (!parsedRange) {
    return true;
  }
  return (
    (parsedRange.minInclusive == null || major >= parsedRange.minInclusive) &&
    (parsedRange.maxExclusive == null || major < parsedRange.maxExclusive)
  );
}

function readReadmePrerequisites(readmeText) {
  if (!readmeText) {
    return { node: null, npm: null };
  }

  const match = readmeText.match(/### Prerequisites\s+([\s\S]*?)\n### /);
  const block = match?.[1] ?? readmeText;
  const nodeLine = block.match(/^- (Node\.js[^\n]+)/m)?.[1] ?? null;
  const npmLine = block.match(/^- (npm[^\n]+)/m)?.[1] ?? null;
  return { node: nodeLine, npm: npmLine };
}

function detectNpmVersionFromEnvironment(env = process.env) {
  return (
    env.npm_config_user_agent?.match(/\bnpm\/([^\s]+)/)?.[1] ??
    env.npm_package_manager?.match(/^npm@(.+)$/)?.[1] ??
    null
  );
}

function runCommand(command, args, cwd, env = process.env) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8"
  });
}

export function loadRuntimeContract(repoRoot = defaultRepoRoot) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  const nvmrcPath = path.join(repoRoot, ".nvmrc");
  const readmePath = path.join(repoRoot, "README.md");
  const packageJson = readJson(packageJsonPath);
  const nvmrcValue = readTextIfExists(nvmrcPath)?.trim() ?? null;
  const readmePrerequisites = readReadmePrerequisites(readTextIfExists(readmePath));

  return {
    repoRoot,
    packageJsonPath,
    nvmrcPath,
    readmePath,
    packageJson,
    nvmrcValue,
    readmePrerequisites,
    nodeEngine: packageJson.engines?.node ?? null,
    npmEngine: packageJson.engines?.npm ?? null,
    packageManager: packageJson.packageManager ?? null,
    expectedNpmVersion: parsePackageManagerVersion(packageJson.packageManager)
  };
}

export function detectRuntimeVersions({
  repoRoot = defaultRepoRoot,
  env = process.env,
  nodeVersion = process.version,
  npmVersion,
  runCommandImpl = runCommand
} = {}) {
  const npmFromEnvironment = npmVersion ?? detectNpmVersionFromEnvironment(env);
  if (npmFromEnvironment) {
    return {
      nodeVersion,
      npmVersion: npmFromEnvironment
    };
  }

  const npmResult = runCommandImpl("npm", ["--version"], repoRoot, env);
  return {
    nodeVersion,
    npmVersion: npmResult.status === 0 ? npmResult.stdout.trim() : null
  };
}

export function evaluateRuntimePreflight({
  contract,
  nodeVersion,
  npmVersion
}) {
  const expectedNodeFromNvmrc = contract.nvmrcValue ? normalizeVersion(contract.nvmrcValue) : null;
  const expectedNpmVersion = contract.expectedNpmVersion;
  const checks = [];

  if (!versionSatisfiesMajorRange(nodeVersion, contract.nodeEngine)) {
    checks.push({
      id: "node-engine",
      title: "Node.js version",
      status: "fail",
      summary: `Current Node ${nodeVersion} does not satisfy package.json engines.node (${contract.nodeEngine ?? "unspecified"}).`
    });
  } else if (expectedNodeFromNvmrc && parseMajor(nodeVersion) !== parseMajor(expectedNodeFromNvmrc)) {
    checks.push({
      id: "node-nvmrc",
      title: "Node.js alignment",
      status: "warn",
      summary: `Current Node ${nodeVersion} satisfies engines but differs from .nvmrc (${contract.nvmrcValue}).`
    });
  } else {
    checks.push({
      id: "node-nvmrc",
      title: "Node.js alignment",
      status: "pass",
      summary: `Current Node ${nodeVersion} matches the repo runtime target${contract.nvmrcValue ? ` (${contract.nvmrcValue})` : ""}.`
    });
  }

  if (!npmVersion) {
    checks.push({
      id: "npm-version",
      title: "npm availability",
      status: "fail",
      summary: "npm is not available on PATH."
    });
  } else if (!versionSatisfiesMajorRange(npmVersion, contract.npmEngine)) {
    checks.push({
      id: "npm-version",
      title: "npm version",
      status: "fail",
      summary: `Current npm ${npmVersion} does not satisfy package.json engines.npm (${contract.npmEngine ?? "unspecified"}).`
    });
  } else if (expectedNpmVersion && normalizeVersion(npmVersion) !== expectedNpmVersion) {
    checks.push({
      id: "npm-version",
      title: "npm alignment",
      status: "warn",
      summary: `Current npm ${npmVersion} satisfies engines but differs from packageManager (${contract.packageManager}).`
    });
  } else {
    checks.push({
      id: "npm-version",
      title: "npm alignment",
      status: "pass",
      summary: `Current npm ${npmVersion} matches the repo expectation${expectedNpmVersion ? ` (${expectedNpmVersion})` : ""}.`
    });
  }

  const counts = {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length
  };

  return {
    contract,
    nodeVersion,
    npmVersion,
    checks,
    counts,
    isSupported: counts.fail === 0
  };
}

export function remediationSteps(commandName, report) {
  const steps = [];
  if (report.contract.nvmrcValue) {
    steps.push(`Run \`nvm use\` from the repo root to switch to Node ${report.contract.nvmrcValue}.`);
  } else if (report.contract.readmePrerequisites.node) {
    steps.push(`Install the README runtime: ${report.contract.readmePrerequisites.node}.`);
  }

  if (report.contract.expectedNpmVersion) {
    steps.push(
      `Confirm \`npm --version\` reports ${report.contract.expectedNpmVersion} (or another npm major that satisfies ${report.contract.npmEngine ?? "the repo requirement"}).`
    );
  } else if (report.contract.readmePrerequisites.npm) {
    steps.push(`Confirm the npm version matches the README prerequisite: ${report.contract.readmePrerequisites.npm}.`);
  }

  steps.push(`Rerun \`npm ci --no-audit --no-fund\`, then retry \`${commandName}\`.`);
  return steps;
}

export function formatUnsupportedRuntimeMessage(commandName, report) {
  const lines = [
    `[runtime-preflight] Unsupported runtime for \`${commandName}\`.`,
    `Detected Node: ${report.nodeVersion}`,
    `Detected npm: ${report.npmVersion ?? "unavailable"}`,
    "",
    "Repo-supported runtime:",
    ...(report.contract.readmePrerequisites.node ? [`- README.md prerequisites: ${report.contract.readmePrerequisites.node}`] : []),
    ...(report.contract.readmePrerequisites.npm ? [`- README.md prerequisites: ${report.contract.readmePrerequisites.npm}`] : []),
    ...(report.contract.nvmrcValue ? [`- .nvmrc: ${report.contract.nvmrcValue}`] : []),
    ...(report.contract.nodeEngine ? [`- package.json engines.node: ${report.contract.nodeEngine}`] : []),
    ...(report.contract.npmEngine ? [`- package.json engines.npm: ${report.contract.npmEngine}`] : []),
    ...(report.contract.packageManager ? [`- package.json packageManager: ${report.contract.packageManager}`] : []),
    "",
    "Runtime check failures:"
  ];

  for (const check of report.checks.filter((entry) => entry.status === "fail")) {
    lines.push(`- ${check.summary}`);
  }

  lines.push("", "Remediation:");
  for (const step of remediationSteps(commandName, report)) {
    lines.push(`- ${step}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function createRuntimePreflightCheckRecords(report) {
  return report.checks.map((check) => {
    const remediation = check.status === "fail" ? remediationSteps("npm run doctor", report) : check.status === "warn"
      ? [
          report.contract.nvmrcValue
            ? `Run \`nvm use\` to align with .nvmrc (${report.contract.nvmrcValue}).`
            : "Align with the README runtime guidance before validating the quickstart path.",
          report.contract.expectedNpmVersion
            ? `Use npm ${report.contract.expectedNpmVersion} for the closest CI match.`
            : "Use the npm version documented in README/package metadata."
        ]
      : [];

    return {
      id: check.id,
      title: check.title,
      status: check.status,
      summary: check.summary,
      details: [],
      remediation
    };
  });
}

export function assertSupportedRuntime({
  commandName,
  repoRoot = defaultRepoRoot,
  env = process.env,
  nodeVersion = process.version,
  npmVersion,
  runCommandImpl = runCommand
} = {}) {
  const contract = loadRuntimeContract(repoRoot);
  const detected = detectRuntimeVersions({
    repoRoot,
    env,
    nodeVersion,
    npmVersion,
    runCommandImpl
  });
  const report = evaluateRuntimePreflight({
    contract,
    nodeVersion: detected.nodeVersion,
    npmVersion: detected.npmVersion
  });

  if (!report.isSupported) {
    const error = new Error(formatUnsupportedRuntimeMessage(commandName, report));
    error.report = report;
    throw error;
  }

  return report;
}
