import * as XLSX from "xlsx";
import type { ConfigDocument } from "./types";
import { parseJsonPath, setValueAtPath } from "./helpers";
import {
  buildSchemaSummary,
  CONFIG_DOCUMENT_SCHEMAS,
  describeSchemaRequirement,
  flattenConfigValueWithSchema,
  schemaNodeForPath
} from "./schemas";

export function buildTabularRowsForDocument(document: ConfigDocument): Array<Record<string, string>> {
  const schema = CONFIG_DOCUMENT_SCHEMAS[document.id];
  const content = JSON.parse(document.content) as unknown;
  return flattenConfigValueWithSchema(content, schema).map((entry) => {
    const segments = parseJsonPath(entry.path);
    const leaf = segments.length === 0 ? "$" : String(segments.at(-1));
    const parent = segments.length <= 1 ? "$" : segments.slice(0, -1).join(".");
    return {
      Section: parent,
      Field: leaf,
      Path: entry.path || "$",
      Type: entry.type,
      Schema: describeSchemaRequirement(schemaNodeForPath(schema, entry.path) ?? {}),
      Description: entry.description ?? "",
      Value: entry.displayValue,
      JSON: entry.jsonValue
    };
  });
}

export function buildWorkbookForDocument(document: ConfigDocument): Buffer {
  const workbook = XLSX.utils.book_new();
  const schema = buildSchemaSummary(document.id);
  const rows = buildTabularRowsForDocument(document);
  const metadataRows = [
    ["Document", document.id],
    ["Title", document.title],
    ["Version", String(document.version ?? 1)],
    ["UpdatedAt", document.updatedAt],
    ["Summary", document.summary],
    ["SchemaId", schema.id],
    ["SchemaVersion", schema.version]
  ];
  const schemaRows = [
    ["SchemaId", schema.id],
    ["Title", schema.title],
    ["Version", schema.version],
    ["Description", schema.description],
    ["RequiredRoots", schema.required.join(", ")]
  ];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metadataRows), "Meta");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(schemaRows), "Schema");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Fields");

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer"
  }) as Buffer;
}

export function buildCsvForDocument(document: ConfigDocument): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(buildTabularRowsForDocument(document));
  return Buffer.from(XLSX.utils.sheet_to_csv(worksheet), "utf8");
}

export function buildCommentedJson(document: ConfigDocument): Buffer {
  const header = [
    `// Project Veil Config Center export`,
    `// Document: ${document.id} (${document.title})`,
    `// Version: v${document.version ?? 1}`,
    `// Updated: ${document.updatedAt}`,
    `// Summary: ${document.summary}`,
    ""
  ].join("\n");

  return Buffer.from(`${header}${document.content}`, "utf8");
}

export function parseWorkbookToContent(workbookBuffer: Buffer): string {
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find((name) => name === "Fields" || name === "Config") ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new Error("Workbook does not contain a Config sheet");
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  let root: unknown = {};
  for (const row of rows) {
    const path = String(row.Path ?? row.path ?? "").trim();
    const normalizedPath = path === "$" ? "" : path;
    const rawJson = String(row.JSON ?? row.json ?? "").trim();
    if (!normalizedPath && rawJson) {
      root = JSON.parse(rawJson);
      continue;
    }

    if (!normalizedPath) {
      continue;
    }

    const parsedValue = rawJson ? JSON.parse(rawJson) : row.Value;
    if (root == null || typeof root !== "object") {
      root = {};
    }
    setValueAtPath(root, normalizedPath, parsedValue);
  }

  return `${JSON.stringify(root, null, 2)}\n`;
}

