const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const targets = {
  doctor: {
    command: "node",
    args: ["./scripts/repo-doctor.mjs"]
  },
  "validate-quickstart": {
    command: "node",
    args: ["./scripts/validate-local-dev-quickstart.mjs"]
  },
  "validate-quickstart-contract": {
    command: "node",
    args: ["--import", "tsx", "./scripts/contributor-quickstart-contract.ts"]
  }
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function normalizeVersion(version) {
  return String(version || "").replace(/^v/i, "").trim();
}

function parseMajor(version) {
  var match = normalizeVersion(version).match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function parsePackageManagerVersion(packageManager) {
  var match = packageManager && packageManager.match(/^npm@(.+)$/);
  return match ? normalizeVersion(match[1]) : null;
}

function parseRange(range) {
  var boundedMatch = range && range.match(/^>=\s*(\d+)\s*<\s*(\d+)$/);
  if (boundedMatch) {
    return { minInclusive: Number(boundedMatch[1]), maxExclusive: Number(boundedMatch[2]) };
  }

  var lowerBoundMatch = range && range.match(/^>=\s*(\d+)$/);
  if (lowerBoundMatch) {
    return { minInclusive: Number(lowerBoundMatch[1]), maxExclusive: Number.POSITIVE_INFINITY };
  }

  var exactMatch = range && range.match(/^(\d+)$/);
  if (exactMatch) {
    var major = Number(exactMatch[1]);
    return { minInclusive: major, maxExclusive: major + 1 };
  }

  return null;
}

function versionSatisfiesMajorRange(version, range) {
  var major = parseMajor(version);
  var parsedRange;
  if (major == null) {
    return false;
  }
  parsedRange = parseRange(range);
  if (!parsedRange) {
    return true;
  }
  return major >= parsedRange.minInclusive && major < parsedRange.maxExclusive;
}

function detectNpmVersion() {
  var userAgentMatch;
  var packageManagerMatch;
  var result;

  if (process.env.PROJECT_VEIL_RUNTIME_NPM_VERSION) {
    return process.env.PROJECT_VEIL_RUNTIME_NPM_VERSION;
  }

  userAgentMatch =
    process.env.npm_config_user_agent &&
    process.env.npm_config_user_agent.match(/\bnpm\/([^\s]+)/);
  if (userAgentMatch) {
    return userAgentMatch[1];
  }

  packageManagerMatch =
    process.env.npm_package_manager &&
    process.env.npm_package_manager.match(/^npm@(.+)$/);
  if (packageManagerMatch) {
    return packageManagerMatch[1];
  }

  result = childProcess.spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--version"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  return result.status === 0 ? result.stdout.trim() : null;
}

function createFailure(summary, remediation) {
  return { summary: summary, remediation: remediation };
}

function evaluateRuntimeSupport(packageJson, nvmrcValue, nodeVersion, npmVersion) {
  var failures = [];
  var expectedNpmVersion;

  if (!versionSatisfiesMajorRange(nodeVersion, packageJson.engines && packageJson.engines.node)) {
    failures.push(
      createFailure(
        "Current Node " +
          nodeVersion +
          " does not satisfy package.json engines.node (" +
          ((packageJson.engines && packageJson.engines.node) || "unspecified") +
          ").",
        "Install the repo runtime from `.nvmrc` and rerun `nvm use`."
      )
    );
  }

  expectedNpmVersion = parsePackageManagerVersion(packageJson.packageManager);
  if (!npmVersion) {
    failures.push(
      createFailure(
        "npm is not available on PATH.",
        "Install npm and rerun `npm --version`. If you use nvm, `nvm use` should restore the bundled npm."
      )
    );
    return failures;
  }

  if (!versionSatisfiesMajorRange(npmVersion, packageJson.engines && packageJson.engines.npm)) {
    failures.push(
      createFailure(
        "Current npm " +
          npmVersion +
          " does not satisfy package.json engines.npm (" +
          ((packageJson.engines && packageJson.engines.npm) || "unspecified") +
          ").",
        expectedNpmVersion
          ? "Install npm " +
              expectedNpmVersion +
              " or use the npm bundled with the repo's Node runtime."
          : "Install the npm version expected by package.json and rerun `npm --version`."
      )
    );
  }

  return failures;
}

function formatRuntimeSupportMessage(failures) {
  var lines = ["Unsupported quickstart runtime detected."];
  failures.forEach(function (failure) {
    lines.push("- " + failure.summary);
    lines.push("  Fix: " + failure.remediation);
  });
  lines.push(
    "Run `npm run doctor` after correcting the runtime to confirm the quickstart prerequisites."
  );
  return lines.join("\n");
}

function printUsage() {
  console.error(
    "Usage: node ./scripts/run-quickstart-runtime-entrypoint.cjs <doctor|validate-quickstart|validate-quickstart-contract> [-- <args...>]"
  );
}

function main() {
  var targetName = process.argv[2];
  var target = targets[targetName];
  var packageJson;
  var nvmrcValue;
  var nodeVersion;
  var npmVersion;
  var failures;
  var childResult;
  var extraArgs;

  if (!target) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  packageJson = readJson(path.join(repoRoot, "package.json"));
  nvmrcValue = readTextIfExists(path.join(repoRoot, ".nvmrc"));
  nvmrcValue = nvmrcValue ? nvmrcValue.trim() : null;
  nodeVersion = process.env.PROJECT_VEIL_RUNTIME_NODE_VERSION || process.version;
  npmVersion = detectNpmVersion();
  failures = evaluateRuntimeSupport(packageJson, nvmrcValue, nodeVersion, npmVersion);

  if (failures.length > 0) {
    console.error(formatRuntimeSupportMessage(failures));
    process.exitCode = 1;
    return;
  }

  extraArgs = process.argv.slice(3);
  childResult = childProcess.spawnSync(target.command, target.args.concat(extraArgs), {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit"
  });

  if (childResult.error) {
    console.error("[quickstart-runtime] " + childResult.error.message);
    process.exitCode = 1;
    return;
  }

  process.exitCode = typeof childResult.status === "number" ? childResult.status : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateRuntimeSupport: evaluateRuntimeSupport,
  formatRuntimeSupportMessage: formatRuntimeSupportMessage
};
