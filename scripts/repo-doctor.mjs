import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createRuntimePreflightCheckRecords,
  detectRuntimeVersions,
  evaluateRuntimePreflight,
  loadRuntimeContract,
  parsePackageManagerVersion,
} from "./runtime-preflight.mjs";

const STATUS_ORDER = ["pass", "info", "warn", "fail"];
const FLOW_ALIASES = new Map([
  ["base", "baseline"],
  ["baseline", "baseline"],
  ["e2e", "e2e"],
  ["playwright", "e2e"],
  ["mysql", "mysql"],
  ["persistence", "mysql"],
  ["redis", "redis"],
  ["release", "release"],
  ["wechat", "release"]
]);
const SUPPORTED_FLOWS = ["baseline", "e2e", "mysql", "redis", "release"];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function parseArgs(argv) {
  const flows = new Set(["baseline"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      return { help: true, flows: [...flows] };
    }

    if (arg === "--flow" || arg === "--flows") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value. Supported flows: ${SUPPORTED_FLOWS.join(", ")}`);
      }
      index += 1;
      for (const rawFlow of value.split(",")) {
        const flow = FLOW_ALIASES.get(rawFlow.trim().toLowerCase());
        if (!flow) {
          throw new Error(`Unknown flow "${rawFlow}". Supported flows: ${SUPPORTED_FLOWS.join(", ")}`);
        }
        flows.add(flow);
      }
      continue;
    }

    throw new Error(`Unknown argument "${arg}". Use --help for usage.`);
  }

  return { help: false, flows: [...flows] };
}

function commandExists(command, environment = process.env) {
  const pathValue = environment.PATH ?? "";
  const searchDirs = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];

  for (const dir of searchDirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // Continue searching PATH.
      }
    }
  }

  return false;
}

function resolveLocalBin(rootDir, name) {
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const extension of extensions) {
    const candidate = path.join(rootDir, "node_modules", ".bin", `${name}${extension}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolvePackageInstalled(rootDir, name) {
  let currentDir = path.resolve(rootDir);
  while (true) {
    if (fs.existsSync(path.join(currentDir, "node_modules", name, "package.json"))) {
      return true;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return false;
    }
    currentDir = parentDir;
  }
}

function resolvePlaywrightCli(rootDir) {
  const candidate = path.join(rootDir, "node_modules", "playwright", "cli.js");
  return fs.existsSync(candidate) ? candidate : null;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8"
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

function parseEnvFile(filePath) {
  const raw = readTextIfExists(filePath);
  if (!raw) {
    return {};
  }

  const entries = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }
  return entries;
}

function relativeRepoPath(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replace(/\\/g, "/") || ".";
}

function createCheck(id, title, status, summary, details = [], remediation = []) {
  return { id, title, status, summary, details, remediation };
}

function collectDependencyCheck(context) {
  const checks = [];
  const nodeModulesDir = path.join(context.repoRoot, "node_modules");
  const requiredPackages = ["tsx", "typescript", "vite", "@playwright/test"];
  const missingPackages = requiredPackages.filter((name) => !context.packageInstalled(name));

  if (missingPackages.length > 0 && !fs.existsSync(nodeModulesDir)) {
    checks.push(
      createCheck(
        "dependency-install",
        "Dependency install state",
        "fail",
        "node_modules is missing, so repo commands that depend on local packages will not run.",
        [],
        ["Run `npm ci --no-audit --no-fund` from the repo root."]
      )
    );
    return checks;
  }

  if (missingPackages.length > 0) {
    checks.push(
      createCheck(
        "dependency-install",
        "Dependency install state",
        "fail",
        `node_modules exists but required packages are missing: ${missingPackages.join(", ")}.`,
        [],
        ["Run `npm ci --no-audit --no-fund` to rebuild a clean dependency tree."]
      )
    );
    return checks;
  }

  checks.push(
    createCheck(
      "dependency-install",
      "Dependency install state",
      "pass",
      fs.existsSync(nodeModulesDir)
        ? "node_modules and the core local toolchain packages are present."
        : "Core local toolchain packages resolve from an ancestor node_modules directory."
    )
  );
  return checks;
}

function collectBaselineHintChecks(context) {
  const checks = [];
  const envPath = path.join(context.repoRoot, ".env");
  const envFile = context.envFile;
  if (!fs.existsSync(envPath)) {
    checks.push(
      createCheck(
        "env-baseline",
        "Local env defaults",
        "info",
        "No `.env` file found. That is fine for the baseline quickstart path.",
        ["MySQL persistence, backup automation, and some release/auth flows only need `.env` when you opt into them."],
        ["Copy `.env.example` to `.env` only when you need to configure MySQL or pipeline-specific secrets."]
      )
    );
    return checks;
  }

  const configuredKeys = Object.keys(envFile).filter((key) => key.startsWith("VEIL_") || key.startsWith("WECHAT_"));
  checks.push(
    createCheck(
      "env-baseline",
      "Local env defaults",
      "pass",
      `.env is present with ${configuredKeys.length} VEIL_/WECHAT_ overrides.`,
      configuredKeys.length > 0 ? [`Configured keys: ${configuredKeys.sort().join(", ")}`] : []
    )
  );
  return checks;
}

function hasNonPlaceholderValue(value) {
  if (!value) {
    return false;
  }
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  return !["change_me", "your-app-id", "your-app-secret"].includes(normalized.toLowerCase());
}

function getPlaywrightCacheDirs(context) {
  const dirs = [];
  const configuredPath = context.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (configuredPath && configuredPath !== "0") {
    dirs.push(configuredPath);
  }

  const homeDir = context.env.HOME || context.env.USERPROFILE;
  if (process.platform === "linux" && homeDir) {
    dirs.push(path.join(homeDir, ".cache", "ms-playwright"));
  }
  if (process.platform === "darwin" && homeDir) {
    dirs.push(path.join(homeDir, "Library", "Caches", "ms-playwright"));
  }
  if (process.platform === "win32" && context.env.LOCALAPPDATA) {
    dirs.push(path.join(context.env.LOCALAPPDATA, "ms-playwright"));
  }

  dirs.push(path.join(context.repoRoot, "node_modules", "playwright-core", ".local-browsers"));
  return [...new Set(dirs)];
}

function collectE2EChecks(context) {
  const checks = [];
  if (!context.packageInstalled("@playwright/test")) {
    checks.push(
      createCheck(
        "playwright-cli",
        "Playwright package",
        "fail",
        "The Playwright test dependency is missing.",
        [],
        ["Run `npm ci --no-audit --no-fund` to install the repo dependencies."]
      )
    );
    return checks;
  }

  const browserPaths = [];
  for (const cacheDir of getPlaywrightCacheDirs(context)) {
    if (!fs.existsSync(cacheDir)) {
      continue;
    }
    for (const entry of fs.readdirSync(cacheDir)) {
      if (/^(chromium|chromium_headless_shell|firefox|webkit|ffmpeg)-/.test(entry)) {
        browserPaths.push(path.join(cacheDir, entry));
      }
    }
  }

  if (browserPaths.length === 0) {
    checks.push(
      createCheck(
        "playwright-browsers",
        "Playwright browsers",
        "fail",
        "No installed Playwright browser binaries were detected.",
        [],
        ["Run `npx playwright install --with-deps chromium` before `npm test -- e2e:smoke`."]
      )
    );
    return checks;
  }

  checks.push(
    createCheck(
      "playwright-browsers",
      "Playwright browsers",
      "pass",
      `Detected ${browserPaths.length} Playwright browser runtime entries.`,
      browserPaths.map((entry) => `Installed browser artifact: ${entry}`)
    )
  );
  return checks;
}

function collectRedisChecks(context) {
  const checks = [];
  const composeFile = path.join(context.repoRoot, "docker-compose.redis.yml");
  const hasRedisServer = context.commandExists("redis-server");
  const dockerAvailable = context.commandExists("docker");
  let dockerComposeReady = false;

  if (dockerAvailable) {
    const composeResult = context.runCommand("docker", ["compose", "version"]);
    dockerComposeReady = composeResult.status === 0;
  }

  if (hasRedisServer || dockerComposeReady) {
    checks.push(
      createCheck(
        "redis-availability",
        "Redis flow tooling",
        "pass",
        hasRedisServer
          ? "A local `redis-server` binary is available for Redis-backed scaling checks."
          : "Docker Compose is available for the bundled Redis bootstrap flow.",
        fs.existsSync(composeFile)
          ? [`Bundled compose file: ${relativeRepoPath(context.repoRoot, composeFile)}`]
          : []
      )
    );
  } else {
    checks.push(
      createCheck(
        "redis-availability",
        "Redis flow tooling",
        "fail",
        "Neither a local `redis-server` binary nor `docker compose` is available.",
        fs.existsSync(composeFile)
          ? [`The repo ships ${relativeRepoPath(context.repoRoot, composeFile)} for the containerized Redis path.`]
          : [],
        [
          "Install Redis locally, or install Docker Compose support and run `docker compose -f docker-compose.redis.yml up -d`.",
          "After Redis is available, rerun `REDIS_URL=redis://127.0.0.1:6379/0 npm run validate -- redis-scaling`."
        ]
      )
    );
  }

  checks.push(
    createCheck(
      "redis-env",
      "Redis env hint",
      "info",
      "Redis-backed Colyseus scaling only activates when `REDIS_URL` is set.",
      ["Without `REDIS_URL`, the dev server stays on the single-process in-memory path."],
      ["Use the same `REDIS_URL` for both server nodes before running `npm run validate -- redis-scaling`."]
    )
  );

  return checks;
}

function collectMySqlChecks(context) {
  const checks = [];
  const envFile = context.envFile;
  const mysqlKeys = ["VEIL_MYSQL_HOST", "VEIL_MYSQL_USER", "VEIL_MYSQL_PASSWORD"];
  const missingMysqlKeys = mysqlKeys.filter((key) => !hasNonPlaceholderValue(envFile[key]));
  const backupBucketConfigured = hasNonPlaceholderValue(envFile.VEIL_BACKUP_S3_BUCKET);
  const mysqlBinary = context.commandExists("mysql");
  const mysqlDumpBinary = context.commandExists("mysqldump");
  const awsBinary = context.commandExists("aws");

  if (missingMysqlKeys.length > 0) {
    checks.push(
      createCheck(
        "mysql-env",
        "MySQL persistence env",
        "warn",
        `MySQL persistence is not fully configured in .env (${missingMysqlKeys.join(", ")} missing).`,
        [],
        ["Copy `.env.example` to `.env`, fill the `VEIL_MYSQL_*` values, then run `npm run db -- migrate`."]
      )
    );
  } else {
    checks.push(
      createCheck(
        "mysql-env",
        "MySQL persistence env",
        "pass",
        "The required `VEIL_MYSQL_*` connection settings are present in .env.",
        ["Run `npm run db -- migrate` before starting the server in MySQL-backed mode."]
      )
    );
  }

  if (mysqlBinary) {
    checks.push(
      createCheck(
        "mysql-cli",
        "MySQL CLI",
        "pass",
        "A local `mysql` client is available."
      )
    );
  } else {
    checks.push(
      createCheck(
        "mysql-cli",
        "MySQL CLI",
        "info",
        "No local `mysql` client was detected.",
        ["The Node migration scripts can still connect to a reachable MySQL server without the CLI."],
        ["Install a local MySQL client if you want interactive inspection or manual schema debugging."]
      )
    );
  }

  if (mysqlDumpBinary && awsBinary && backupBucketConfigured) {
    checks.push(
      createCheck(
        "mysql-backup",
        "MySQL backup tooling",
        "pass",
        "Backup prerequisites are present for `./scripts/db-backup.sh`.",
        ["Detected `mysqldump`, `aws`, and `VEIL_BACKUP_S3_BUCKET`."]
      )
    );
  } else {
    const missingParts = [
      mysqlDumpBinary ? null : "`mysqldump`",
      awsBinary ? null : "`aws` CLI",
      backupBucketConfigured ? null : "`VEIL_BACKUP_S3_BUCKET`"
    ].filter(Boolean);
    checks.push(
      createCheck(
        "mysql-backup",
        "MySQL backup tooling",
        "info",
        `Backup automation is not fully configured (${missingParts.join(", ")} missing).`,
        ["This only matters if you plan to run the persistence backup/recovery pipeline."],
        ["Install the missing tools, set the `VEIL_BACKUP_*` values, and dry-run `./scripts/db-backup.sh`."]
      )
    );
  }

  return checks;
}

function collectReleaseChecks(context) {
  const checks = [];
  const envFile = context.envFile;
  const buildConfigPath = path.join(context.repoRoot, "apps", "cocos-client", "wechat-minigame.build.json");
  const templateDir = path.join(context.repoRoot, "apps", "cocos-client", "build-templates", "wechatgame");

  if (context.packageInstalled("miniprogram-ci")) {
    checks.push(
      createCheck(
        "release-deps",
        "Release packaging dependencies",
        "pass",
        "The `miniprogram-ci` dependency is installed for WeChat release packaging flows."
      )
    );
  } else {
    checks.push(
      createCheck(
        "release-deps",
        "Release packaging dependencies",
        "fail",
        "The `miniprogram-ci` dependency is missing from node_modules.",
        [],
        ["Run `npm ci --no-audit --no-fund` before using the WeChat packaging scripts."]
      )
    );
  }

  if (fs.existsSync(buildConfigPath) && fs.existsSync(templateDir)) {
    checks.push(
      createCheck(
        "release-config",
        "Release config files",
        "pass",
        "WeChat/Cocos release config files are present in the repo.",
        [
          `Build config: ${relativeRepoPath(context.repoRoot, buildConfigPath)}`,
          `Template dir: ${relativeRepoPath(context.repoRoot, templateDir)}`
        ]
      )
    );
  } else {
    checks.push(
      createCheck(
        "release-config",
        "Release config files",
        "warn",
        "Expected WeChat release config files are missing from the repo checkout.",
        [],
        ["Refresh the checkout and rerun `npm run check:wechat-build`."]
      )
    );
  }

  const missingWechatKeys = ["WECHAT_APP_ID", "WECHAT_APP_SECRET"].filter((key) => !hasNonPlaceholderValue(envFile[key]));
  checks.push(
    createCheck(
      "release-env",
      "Release/auth env hint",
      missingWechatKeys.length === 0 ? "pass" : "info",
      missingWechatKeys.length === 0
        ? "WeChat auth env keys are present in .env."
        : `WeChat auth env keys are not configured (${missingWechatKeys.join(", ")}).`,
      ["These values are only needed for real WeChat login or release-adjacent mini-game flows."],
      missingWechatKeys.length === 0
        ? ["Run `npm run check:wechat-build` for the repo-side packaging validation."]
        : [
            "Add `WECHAT_APP_ID` / `WECHAT_APP_SECRET` only when you need the real WeChat auth path.",
            "Doctor cannot verify the manual Cocos Creator 3.8.x export step; use `npm run check:wechat-build` plus the README workflow."
          ]
    )
  );

  return checks;
}

function createSystemContext(overrides = {}) {
  const resolvedRepoRoot = overrides.repoRoot ?? repoRoot;
  const envFile = parseEnvFile(path.join(resolvedRepoRoot, ".env"));
  const runtimeContract =
    overrides.runtimeContract ??
    (overrides.packageJson
      ? {
          repoRoot: resolvedRepoRoot,
          packageJsonPath: path.join(resolvedRepoRoot, "package.json"),
          nvmrcPath: path.join(resolvedRepoRoot, ".nvmrc"),
          readmePath: path.join(resolvedRepoRoot, "README.md"),
          packageJson: overrides.packageJson,
          nvmrcValue: overrides.nvmrcValue ?? null,
          readmePrerequisites: overrides.readmePrerequisites ?? { node: null, npm: null },
          nodeEngine: overrides.packageJson.engines?.node ?? null,
          npmEngine: overrides.packageJson.engines?.npm ?? null,
          packageManager: overrides.packageJson.packageManager ?? null,
          expectedNpmVersion: parsePackageManagerVersion(overrides.packageJson.packageManager)
        }
      : loadRuntimeContract(resolvedRepoRoot));
  const detectedRuntime = detectRuntimeVersions({
    repoRoot: resolvedRepoRoot,
    env: process.env,
    runCommandImpl: runCommand
  });

  return {
    repoRoot: resolvedRepoRoot,
    packageJson: runtimeContract.packageJson,
    runtimeContract,
    envFile,
    env: process.env,
    nodeVersion: detectedRuntime.nodeVersion,
    npmVersion: detectedRuntime.npmVersion,
    commandExists: (command) => commandExists(command),
    localBinPath: (name) => resolveLocalBin(resolvedRepoRoot, name),
    packageInstalled: (name) => resolvePackageInstalled(resolvedRepoRoot, name),
    playwrightCliPath: resolvePlaywrightCli(resolvedRepoRoot),
    runCommand,
    ...overrides
  };
}

export function collectDoctorReport(options = {}, contextOverrides = {}) {
  const parsedArgs = options.flows ? { help: false, flows: options.flows } : parseArgs(process.argv.slice(2));
  const context = createSystemContext(contextOverrides);
  const runtimeReport = evaluateRuntimePreflight({
    contract: context.runtimeContract,
    nodeVersion: context.nodeVersion,
    npmVersion: context.npmVersion
  });

  const checks = [
    ...createRuntimePreflightCheckRecords(runtimeReport).map((check) =>
      createCheck(check.id, check.title, check.status, check.summary, check.details, check.remediation)
    ),
    ...collectDependencyCheck(context),
    ...collectBaselineHintChecks(context)
  ];

  if (parsedArgs.flows.includes("e2e")) {
    checks.push(...collectE2EChecks(context));
  }
  if (parsedArgs.flows.includes("redis")) {
    checks.push(...collectRedisChecks(context));
  }
  if (parsedArgs.flows.includes("mysql")) {
    checks.push(...collectMySqlChecks(context));
  }
  if (parsedArgs.flows.includes("release")) {
    checks.push(...collectReleaseChecks(context));
  }

  const counts = {
    pass: checks.filter((check) => check.status === "pass").length,
    info: checks.filter((check) => check.status === "info").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length
  };

  return {
    flows: parsedArgs.flows,
    checks,
    counts,
    overallStatus: counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass"
  };
}

export function renderDoctorReport(report) {
  const lines = [];
  lines.push("Project Veil doctor");
  lines.push(`Flows: ${report.flows.join(", ")}`);
  lines.push("");

  const checks = [...report.checks].sort((left, right) => STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status));
  for (const check of checks) {
    lines.push(`[${check.status.toUpperCase()}] ${check.title}`);
    lines.push(`  ${check.summary}`);
    for (const detail of check.details) {
      lines.push(`  Detail: ${detail}`);
    }
    for (const remediation of check.remediation) {
      lines.push(`  Fix: ${remediation}`);
    }
    lines.push("");
  }

  lines.push(
    `Summary: ${report.counts.pass} passed, ${report.counts.info} info, ${report.counts.warn} warned, ${report.counts.fail} failed`
  );

  if (report.counts.fail > 0) {
    lines.push("Doctor result: failed");
  } else if (report.counts.warn > 0) {
    lines.push("Doctor result: passed with warnings");
  } else {
    lines.push("Doctor result: passed");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function usage() {
  return [
    "Usage: npm run doctor -- [--flow <baseline|e2e|mysql|redis|release>]",
    "",
    "Examples:",
    "  npm run doctor",
    "  npm run doctor -- --flow e2e --flow redis",
    "  npm run doctor -- --flow mysql --flow release"
  ].join("\n");
}

function main() {
  let parsedArgs;
  try {
    parsedArgs = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[doctor] ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (parsedArgs.help) {
    console.log(usage());
    return;
  }

  const report = collectDoctorReport({ flows: parsedArgs.flows });
  process.stdout.write(renderDoctorReport(report));
  process.exitCode = report.counts.fail > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
