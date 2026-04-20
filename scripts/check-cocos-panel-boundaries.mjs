import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { cocosPanelAuthoringTargets } from "./cocos-panel-authoring-registry.mjs";

const repoRoot = process.cwd();
const allowedValueImportPatterns = [
  /^cc$/,
  /^@veil\/shared(?:\/.*)?$/,
  /^\.\/cocos-[^"]+\.ts$/,
  /^\.\/project-shared\/[^"]+\.ts$/,
];

function isTypeOnlyImport(node) {
  if (node.importClause?.isTypeOnly) {
    return true;
  }

  const importClause = node.importClause;
  if (!importClause) {
    return false;
  }

  if (importClause.name || importClause.namedBindings?.kind === ts.SyntaxKind.NamespaceImport) {
    return false;
  }

  if (importClause.namedBindings?.kind === ts.SyntaxKind.NamedImports) {
    return importClause.namedBindings.elements.every((element) => element.isTypeOnly);
  }

  return false;
}

function formatFailure(file, message) {
  return `${path.relative(repoRoot, file)}: ${message}`;
}

const failures = [];

for (const target of cocosPanelAuthoringTargets) {
  const file = path.resolve(repoRoot, target.viewFile);
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(target.modelImport)) {
    failures.push(formatFailure(file, `missing required model import ${target.modelImport}`));
  }

  const targetAllowedValueImportPatterns = [
    ...allowedValueImportPatterns,
    ...(target.allowedValueImports ?? []).map(
      (specifier) => new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
    )
  ];

  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) {
      continue;
    }

    if (isTypeOnlyImport(statement)) {
      continue;
    }

    const moduleName = specifier.text;
    const allowed = targetAllowedValueImportPatterns.some((pattern) => pattern.test(moduleName));
    if (!allowed) {
      failures.push(
        formatFailure(
          file,
          `value import ${moduleName} is outside the allowed panel/view-model boundary`
        )
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Cocos panel boundary check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Cocos panel boundary check passed for ${cocosPanelAuthoringTargets.length} view surfaces.`);
