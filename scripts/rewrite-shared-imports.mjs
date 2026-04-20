import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT_DIR = resolve(new URL("../", import.meta.url).pathname);
const APPS_DIR = resolve(ROOT_DIR, "apps");
const SHARED_DIR = resolve(ROOT_DIR, "packages/shared/src");
const SHARED_INDEX_FILE = resolve(SHARED_DIR, "index.ts");
const SOURCE_FILE_PATTERN = /\.(ts|tsx)$/;

const BATTLE_ORIGINS = new Set(["action-precheck", "battle", "battle-replay", "battle-report", "deterministic-rng", "feedback"]);
const WORLD_ORIGINS = new Set([
  "content-pack-validation",
  "map-sync",
  "world-config",
  "world/index",
  "world/action-prediction",
  "world/battle-outcome",
  "world/fog-of-war",
  "world/pathfinding",
  "world/tile-mutations",
  "world/world-builders"
]);
const PROGRESSION_ORIGINS = new Set([
  "achievement-ui",
  "campaign",
  "competitive-season",
  "daily-dungeons",
  "daily-quest-rotation",
  "daily-quests",
  "hero-progression",
  "player-account",
  "tutorial"
]);
const ECONOMY_ORIGINS = new Set(["cosmetics", "equipment"]);
const SOCIAL_ORIGINS = new Set(["guild-chat", "guilds", "matchmaking"]);
const PLATFORM_ORIGINS = new Set([
  "analytics-events",
  "auth-ui",
  "client-version",
  "display-name-validation",
  "error-codes",
  "feature-flags",
  "reconnect-observability",
  "runtime-diagnostics"
]);

const exportCache = new Map();

function listSourceFiles(directoryPath) {
  const sourceFiles = [];

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      sourceFiles.push(...listSourceFiles(entryPath));
      continue;
    }

    if (SOURCE_FILE_PATTERN.test(entry.name)) {
      sourceFiles.push(entryPath);
    }
  }

  return sourceFiles;
}

function resolveSharedModule(specifier, fromFile) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const basePath = resolve(fromFile, "..", specifier);
  for (const candidate of [basePath, `${basePath}.ts`, join(basePath, "index.ts")]) {
    if (candidate.startsWith(SHARED_DIR) && ts.sys.fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function collectExports(filePath) {
  const normalizedPath = resolve(filePath);
  if (exportCache.has(normalizedPath)) {
    return exportCache.get(normalizedPath);
  }

  const sourceText = readFileSync(normalizedPath, "utf8");
  const sourceFile = ts.createSourceFile(normalizedPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exports = new Map();
  exportCache.set(normalizedPath, exports);

  for (const statement of sourceFile.statements) {
    const modifiers = ts.getModifiers(statement) ?? [];
    const isExported = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      isExported &&
      statement.name
    ) {
      exports.set(statement.name.text, normalizedPath);
      continue;
    }

    if (ts.isVariableStatement(statement) && isExported) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.set(declaration.name.text, normalizedPath);
        }
      }
      continue;
    }

    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const targetPath = resolveSharedModule(statement.moduleSpecifier.text, normalizedPath);
    if (!targetPath) {
      continue;
    }

    const targetExports = collectExports(targetPath);
    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        exports.set(element.name.text, targetExports.get(importedName) ?? targetPath);
      }
      continue;
    }

    for (const [name, originPath] of targetExports.entries()) {
      if (!exports.has(name)) {
        exports.set(name, originPath);
      }
    }
  }

  return exports;
}

function classifyOrigin(origin) {
  if (BATTLE_ORIGINS.has(origin)) {
    return "@veil/shared/battle";
  }
  if (WORLD_ORIGINS.has(origin)) {
    return "@veil/shared/world";
  }
  if (PROGRESSION_ORIGINS.has(origin)) {
    return "@veil/shared/progression";
  }
  if (ECONOMY_ORIGINS.has(origin)) {
    return "@veil/shared/economy";
  }
  if (SOCIAL_ORIGINS.has(origin)) {
    return "@veil/shared/social";
  }
  if (PLATFORM_ORIGINS.has(origin)) {
    return "@veil/shared/platform";
  }

  return `@veil/shared/${origin.replace(/\/index$/, "")}`;
}

function normalizeOriginPath(filePath) {
  return relative(SHARED_DIR, filePath).replace(/\\/g, "/").replace(/\.ts$/, "");
}

function formatImportDeclaration(target, specifiers) {
  const allTypeOnly = specifiers.every((specifier) => specifier.typeOnly);
  const sortedSpecifiers = [...specifiers].sort((left, right) => left.imported.localeCompare(right.imported));
  const namedBindings = sortedSpecifiers
    .map((specifier) => {
      const binding = specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`;
      if (allTypeOnly) {
        return binding;
      }
      return specifier.typeOnly ? `type ${binding}` : binding;
    })
    .join(", ");

  return `${allTypeOnly ? "import type" : "import"} { ${namedBindings} } from "${target}";`;
}

function rewriteFile(filePath, exportMap) {
  const sourceText = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const replacements = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const specifier = statement.moduleSpecifier.text;
    if (
      !specifier.includes("packages/shared/src/") &&
      specifier !== "@project-veil/shared" &&
      !specifier.startsWith("@project-veil/shared/")
    ) {
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause?.namedBindings || !ts.isNamedImports(importClause.namedBindings)) {
      throw new Error(`Unsupported shared import shape in ${relative(ROOT_DIR, filePath)}: ${statement.getText(sourceFile)}`);
    }

    const groups = new Map();
    const fromIndex = specifier.includes("packages/shared/src/index") || specifier === "@project-veil/shared";

    if (fromIndex) {
      for (const element of importClause.namedBindings.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        if (importedName === "PlayerAccountSnapshot") {
          throw new Error(
            `PlayerAccountSnapshot should not be imported from shared index in ${relative(ROOT_DIR, filePath)}; fix this file manually.`
          );
        }
        const originPath = exportMap.get(importedName);
        if (!originPath) {
          throw new Error(`Could not resolve shared export ${importedName} in ${relative(ROOT_DIR, filePath)}`);
        }
        const target = classifyOrigin(normalizeOriginPath(originPath));
        const specifiers = groups.get(target) ?? [];
        specifiers.push({
          imported: importedName,
          local: element.name.text,
          typeOnly: importClause.isTypeOnly || element.isTypeOnly
        });
        groups.set(target, specifiers);
      }
    } else {
      const targetPath =
        specifier.startsWith("@project-veil/shared/")
          ? classifyOrigin(specifier.replace(/^@project-veil\/shared\//, ""))
          : classifyOrigin(normalizeOriginPath(resolveSharedModule(specifier, filePath)));
      const specifiers = groups.get(targetPath) ?? [];
      for (const element of importClause.namedBindings.elements) {
        specifiers.push({
          imported: (element.propertyName ?? element.name).text,
          local: element.name.text,
          typeOnly: importClause.isTypeOnly || element.isTypeOnly
        });
      }
      groups.set(targetPath, specifiers);
    }

    const rewrittenImportBlock = [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, specifiers]) => formatImportDeclaration(target, specifiers))
      .join("\n");

    replacements.push({
      start: statement.getStart(sourceFile),
      end: statement.getEnd(),
      text: rewrittenImportBlock
    });
  }

  if (replacements.length === 0) {
    return false;
  }

  let nextSourceText = sourceText;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    nextSourceText = `${nextSourceText.slice(0, replacement.start)}${replacement.text}${nextSourceText.slice(replacement.end)}`;
  }

  writeFileSync(filePath, nextSourceText);
  return true;
}

const exportMap = collectExports(SHARED_INDEX_FILE);
let changedFiles = 0;

for (const filePath of listSourceFiles(APPS_DIR)) {
  if (rewriteFile(filePath, exportMap)) {
    changedFiles += 1;
    console.log(`rewrote ${relative(ROOT_DIR, filePath)}`);
  }
}

console.log(`rewrote ${changedFiles} files`);
