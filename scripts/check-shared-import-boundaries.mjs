import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT_DIR = resolve(new URL("../", import.meta.url).pathname);
const APPS_DIR = resolve(ROOT_DIR, "apps");
const SOURCE_FILE_PATTERN = /\.(ts|tsx)$/;

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

const violations = [];

for (const filePath of listSourceFiles(APPS_DIR)) {
  const sourceText = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const specifier = statement.moduleSpecifier.text;
    const { line } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
    const location = `${relative(ROOT_DIR, filePath)}:${line + 1}`;

    if (specifier.includes("packages/shared/src/")) {
      violations.push(`${location} uses forbidden relative shared source import: ${specifier}`);
      continue;
    }

    if (specifier === "@veil/shared" || specifier === "@project-veil/shared") {
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
