import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT_DIR = resolve(SCRIPT_DIR, "..");
export const SHARED_ROOT_RELATIVE_PATH = "packages/shared/src";
export const PROJECT_SHARED_ROOT_RELATIVE_PATH = "apps/cocos-client/assets/scripts/project-shared";

export const PROJECT_SHARED_ROOT_ENTRYPOINT_FILES = [
  "analytics-events.ts",
  "achievement-ui.ts",
  "action-precheck.ts",
  "assets-config.ts",
  "auth-ui.ts",
  "battle-replay.ts",
  "battle-report.ts",
  "battle.ts",
  "client-version.ts",
  "config-cross-file-validation.ts",
  "cosmetics.ts",
  "daily-quests.ts",
  "deterministic-rng.ts",
  "equipment.ts",
  "error-codes.ts",
  "event-log.ts",
  "feedback.ts",
  "hero-progression.ts",
  "hero-skills.ts",
  "invariant.ts",
  "map-sync.ts",
  "models.ts",
  "player-account.ts",
  "protocol.ts",
  "reconnect-observability.ts",
  "runtime-diagnostics.ts",
  "tutorial.ts",
  "world-config.ts"
];

function toPosixPath(value) {
  return value.split(sep).join("/");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function normalizeText(value) {
  return ensureTrailingNewline(value.replace(/\r\n/g, "\n"));
}

function listWorldMirrorRelativePaths(rootDir) {
  const worldDir = resolve(rootDir, SHARED_ROOT_RELATIVE_PATH, "world");
  return readdirSync(worldDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => `world/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function parseRelativeSpecifiers(sourceText) {
  const specifiers = new Set();

  for (const match of sourceText.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
    specifiers.add(match[1]);
  }

  for (const match of sourceText.matchAll(/^\s*import\s+["'](\.[^"']+)["'];/gm)) {
    specifiers.add(match[1]);
  }

  return [...specifiers];
}

function resolveSharedRelativeImport(sharedRootDir, importerRelativePath, specifier) {
  const importerDir = resolve(sharedRootDir, dirname(importerRelativePath));
  const candidateBase = resolve(importerDir, specifier);
  const candidates = [candidateBase, `${candidateBase}.ts`, resolve(candidateBase, "index.ts")];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const candidateRelativePath = toPosixPath(relative(sharedRootDir, candidate));
    if (!candidateRelativePath.startsWith("../")) {
      return candidateRelativePath;
    }
  }

  return undefined;
}

function listRootMirrorRelativePaths(rootDir) {
  const sharedRootDir = resolve(rootDir, SHARED_ROOT_RELATIVE_PATH);
  const discovered = new Set(PROJECT_SHARED_ROOT_ENTRYPOINT_FILES);
  const pending = [...PROJECT_SHARED_ROOT_ENTRYPOINT_FILES];

  while (pending.length > 0) {
    const relativeSourcePath = pending.shift();
    const sourceText = readFileSync(resolve(sharedRootDir, relativeSourcePath), "utf8");

    for (const specifier of parseRelativeSpecifiers(sourceText)) {
      const resolvedImportPath = resolveSharedRelativeImport(sharedRootDir, relativeSourcePath, specifier);
      if (!resolvedImportPath || resolvedImportPath.startsWith("world/") || discovered.has(resolvedImportPath)) {
        continue;
      }

      discovered.add(resolvedImportPath);
      pending.push(resolvedImportPath);
    }
  }

  return [...discovered].sort((left, right) => left.localeCompare(right));
}

function buildRootMirrorEntries(rootDir) {
  return listRootMirrorRelativePaths(rootDir).map((filePath) => ({
    id: `root:${filePath}`,
    kind: "copy",
    source: `${SHARED_ROOT_RELATIVE_PATH}/${filePath}`,
    target: `${PROJECT_SHARED_ROOT_RELATIVE_PATH}/${filePath}`
  }));
}

function buildWorldMirrorEntries(rootDir) {
  return listWorldMirrorRelativePaths(rootDir).map((filePath) => ({
    id: `world:${filePath}`,
    kind: "copy",
    source: `${SHARED_ROOT_RELATIVE_PATH}/${filePath}`,
    target: `${PROJECT_SHARED_ROOT_RELATIVE_PATH}/${filePath}`
  }));
}

export function buildProjectSharedMirrorManifest(options = {}) {
  const rootDir = resolve(options.rootDir ?? DEFAULT_ROOT_DIR);
  return [
    ...buildRootMirrorEntries(rootDir),
    ...buildWorldMirrorEntries(rootDir),
    {
      id: "compat:map",
      kind: "generated-map-compat",
      source: `${SHARED_ROOT_RELATIVE_PATH}/world/index.ts`,
      target: `${PROJECT_SHARED_ROOT_RELATIVE_PATH}/map.ts`
    },
    {
      id: "compat:index",
      kind: "generated-index",
      source: `${SHARED_ROOT_RELATIVE_PATH}/index.ts`,
      target: `${PROJECT_SHARED_ROOT_RELATIVE_PATH}/index.ts`
    }
  ];
}

function rewriteConfigImports(sourceText, sourceAbsolutePath, targetAbsolutePath, rootDir) {
  const configsDir = resolve(rootDir, "configs");
  const sourcePrefix = `${toPosixPath(relative(dirname(sourceAbsolutePath), configsDir))}/`;
  const targetPrefix = `${toPosixPath(relative(dirname(targetAbsolutePath), configsDir))}/`;

  if (sourcePrefix === targetPrefix || !sourceText.includes(sourcePrefix)) {
    return sourceText;
  }

  return sourceText.split(sourcePrefix).join(targetPrefix);
}

function renderCopiedFile(entry, rootDir) {
  const sourceAbsolutePath = resolve(rootDir, entry.source);
  const targetAbsolutePath = resolve(rootDir, entry.target);
  const sourceText = readFileSync(sourceAbsolutePath, "utf8");
  return normalizeText(rewriteConfigImports(sourceText, sourceAbsolutePath, targetAbsolutePath, rootDir));
}

function renderMapCompatFile() {
  return 'export * from "./world/index.ts";\n';
}

function parseBarrelExports(sourceText) {
  const exports = [];

  for (const line of normalizeText(sourceText).split("\n")) {
    const match = line.match(/^export \* from "(.+)";$/);
    if (match) {
      exports.push(match[1]);
    }
  }

  return exports;
}

function renderProjectSharedIndex(entry, rootDir) {
  const sourceAbsolutePath = resolve(rootDir, entry.source);
  const rootFileSet = new Set(listRootMirrorRelativePaths(rootDir));
  const lines = [];

  for (const specifier of parseBarrelExports(readFileSync(sourceAbsolutePath, "utf8"))) {
    if (specifier === "./world/index.ts") {
      lines.push('export * from "./map.ts";');
      continue;
    }

    const fileName = specifier.startsWith("./") ? specifier.slice(2) : specifier;
    if (rootFileSet.has(fileName)) {
      lines.push(`export * from "${specifier}";`);
    }
  }

  return ensureTrailingNewline(lines.join("\n"));
}

function renderEntry(entry, rootDir) {
  if (entry.kind === "copy") {
    return renderCopiedFile(entry, rootDir);
  }

  if (entry.kind === "generated-map-compat") {
    return renderMapCompatFile();
  }

  if (entry.kind === "generated-index") {
    return renderProjectSharedIndex(entry, rootDir);
  }

  throw new Error(`Unknown project-shared mirror entry kind: ${entry.kind}`);
}

function listMirroredTypeScriptFiles(rootDir) {
  const mirrorDir = resolve(rootDir, PROJECT_SHARED_ROOT_RELATIVE_PATH);
  const discovered = [];

  function walk(currentDirectory, relativeDirectory = "") {
    if (!existsSync(currentDirectory)) {
      return;
    }

    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const absolutePath = resolve(currentDirectory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        discovered.push(`${PROJECT_SHARED_ROOT_RELATIVE_PATH}/${relativePath}`);
      }
    }
  }

  walk(mirrorDir);
  return discovered.sort((left, right) => left.localeCompare(right));
}

export function buildExpectedProjectSharedFiles(options = {}) {
  const rootDir = resolve(options.rootDir ?? DEFAULT_ROOT_DIR);
  const expectedFiles = new Map();

  for (const entry of buildProjectSharedMirrorManifest({ rootDir })) {
    expectedFiles.set(entry.target, renderEntry(entry, rootDir));
  }

  return expectedFiles;
}

export function syncProjectShared(options = {}) {
  const rootDir = resolve(options.rootDir ?? DEFAULT_ROOT_DIR);
  const expectedFiles = buildExpectedProjectSharedFiles({ rootDir });
  const changedFiles = [];
  const actualFiles = listMirroredTypeScriptFiles(rootDir);

  for (const [relativeTargetPath, expectedContent] of expectedFiles.entries()) {
    const targetAbsolutePath = resolve(rootDir, relativeTargetPath);
    mkdirSync(dirname(targetAbsolutePath), { recursive: true });
    const currentContent = existsSync(targetAbsolutePath)
      ? normalizeText(readFileSync(targetAbsolutePath, "utf8"))
      : undefined;

    if (currentContent === expectedContent) {
      continue;
    }

    writeFileSync(targetAbsolutePath, expectedContent, "utf8");
    changedFiles.push(relativeTargetPath);
  }

  for (const relativeTargetPath of actualFiles) {
    if (expectedFiles.has(relativeTargetPath)) {
      continue;
    }

    rmSync(resolve(rootDir, relativeTargetPath), { force: true });
    changedFiles.push(relativeTargetPath);
  }

  return {
    changedFiles,
    manifest: buildProjectSharedMirrorManifest({ rootDir })
  };
}

function firstDiffLine(expectedText, actualText) {
  const expectedLines = normalizeText(expectedText).split("\n");
  const actualLines = normalizeText(actualText).split("\n");
  const maxLength = Math.max(expectedLines.length, actualLines.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return index + 1;
    }
  }

  return 0;
}

export function checkProjectSharedParity(options = {}) {
  const rootDir = resolve(options.rootDir ?? DEFAULT_ROOT_DIR);
  const expectedFiles = buildExpectedProjectSharedFiles({ rootDir });
  const actualFiles = listMirroredTypeScriptFiles(rootDir);
  const expectedPaths = [...expectedFiles.keys()].sort((left, right) => left.localeCompare(right));
  const actualFileSet = new Set(actualFiles);

  const missingFiles = expectedPaths.filter((filePath) => !actualFileSet.has(filePath));
  const unexpectedFiles = actualFiles.filter((filePath) => !expectedFiles.has(filePath));
  const driftedFiles = [];

  for (const relativeTargetPath of expectedPaths) {
    if (!actualFileSet.has(relativeTargetPath)) {
      continue;
    }

    const actualContent = normalizeText(readFileSync(resolve(rootDir, relativeTargetPath), "utf8"));
    const expectedContent = expectedFiles.get(relativeTargetPath);
    if (actualContent !== expectedContent) {
      driftedFiles.push({
        filePath: relativeTargetPath,
        firstDiffLine: firstDiffLine(expectedContent, actualContent)
      });
    }
  }

  return {
    manifest: buildProjectSharedMirrorManifest({ rootDir }),
    expectedFiles,
    missingFiles,
    unexpectedFiles,
    driftedFiles,
    hasViolations: missingFiles.length > 0 || unexpectedFiles.length > 0 || driftedFiles.length > 0
  };
}
