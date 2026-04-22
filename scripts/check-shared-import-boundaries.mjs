import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT_DIR = resolve(new URL("../", import.meta.url).pathname);
const APPS_DIR = resolve(ROOT_DIR, "apps");
const SOURCE_FILE_PATTERN = /\.(ts|tsx)$/;
const FORBIDDEN_TOP_LEVEL_SHARED_IMPORTS = new Set([
  "@veil/shared",
  "@veil/shared/index",
  "@project-veil/shared",
  "@project-veil/shared/index"
]);

let ts = null;

const FALLBACK_MODULE_SPECIFIER_PATTERNS = [
  /^\s*import(?:\s+.+?\s+from\s+)?\s*["']([^"']+)["']/,
  /^\s*export(?:\s+.+?\s+from\s+)\s*["']([^"']+)["']/
];

try {
  ({ default: ts } = await import("typescript"));
} catch {
  ts = null;
}

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

function listStaticImportSpecifiers(filePath, sourceText) {
  if (ts) {
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const imports = [];

    for (const statement of sourceFile.statements) {
      const moduleSpecifier = ts.isImportDeclaration(statement)
        ? statement.moduleSpecifier
        : ts.isExportDeclaration(statement)
          ? statement.moduleSpecifier
          : undefined;
      if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) {
        continue;
      }

      const { line } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
      imports.push({
        line: line + 1,
        specifier: moduleSpecifier.text
      });
    }

    return imports;
  }

  return sourceText
    .split(/\r?\n/g)
    .flatMap((lineText, index) => {
      const match = FALLBACK_MODULE_SPECIFIER_PATTERNS
        .map((pattern) => lineText.match(pattern))
        .find((candidate) => candidate);
      return match
        ? [
            {
              line: index + 1,
              specifier: match[1]
            }
          ]
        : [];
    });
}

const violations = [];

for (const filePath of listSourceFiles(APPS_DIR)) {
  const sourceText = readFileSync(filePath, "utf8");
  for (const { specifier, line } of listStaticImportSpecifiers(filePath, sourceText)) {
    const location = `${relative(ROOT_DIR, filePath)}:${line}`;

    if (specifier.includes("packages/shared/src/")) {
      violations.push(`${location} uses forbidden relative shared source import: ${specifier}`);
      continue;
    }

    if (FORBIDDEN_TOP_LEVEL_SHARED_IMPORTS.has(specifier)) {
      violations.push(`${location} uses forbidden top-level shared barrel import: ${specifier}`);
      continue;
    }

    if (specifier.startsWith("@project-veil/shared/")) {
      violations.push(`${location} uses deprecated shared alias: ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Shared import boundary violations found:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}
