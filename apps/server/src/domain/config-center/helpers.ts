import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BattleBalanceConfig, BattleSkillCatalogConfig, MapObjectsConfig, ResourceKind, TerrainType, UnitCatalogConfig, WorldGenerationConfig } from "@veil/shared/models";
import type { LeaderboardTierThresholdsConfigDocument } from "../../leaderboard-tier-thresholds";
import type {
  ConfigDefinition,
  ConfigDocumentId,
  ConfigDiffChangeKind,
  ConfigDocument,
  ErrorPayload,
  ParsedConfigDocument,
  RuntimeConfigDocumentId,
  ValidationIssue
} from "./types";
import type { ConfigCenterLibraryState, FlattenedConfigEntry, JsonSchemaNode } from "./constants";
import { CONFIG_DEFINITIONS, RUNTIME_CONFIG_DOCUMENT_IDS } from "./constants";

export function createEmptyLibraryState(): ConfigCenterLibraryState {
  return {
    filesystemVersions: {},
    filesystemExports: {},
    snapshots: {},
    presets: {},
    stagedDraft: null,
    publishHistory: {},
    publishAuditHistory: []
  };
}

export function buildAutomaticSnapshotLabel(title: string, version: number): string {
  return `${title} 自动保存 v${version}`;
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function detectSyntaxLine(errorMessage: string, content: string): number | undefined {
  const match = errorMessage.match(/position\s+(\d+)/i);
  const position = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(position)) {
    return undefined;
  }

  return content.slice(0, position).split("\n").length;
}

export function pushIssue(
  issues: ValidationIssue[],
  issue: Omit<ValidationIssue, "severity"> & { severity?: "error" | "warning" }
): void {
  issues.push({
    severity: issue.severity ?? "error",
    ...issue
  });
}

export function parseJsonPath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const normalized = path.replace(/\[(\d+)\]/g, ".$1");
  for (const part of normalized.split(".")) {
    if (!part) {
      continue;
    }

    const maybeIndex = Number(part);
    segments.push(Number.isInteger(maybeIndex) && `${maybeIndex}` === part ? maybeIndex : part);
  }

  return segments;
}

export function setValueAtPath(target: unknown, path: string, value: unknown): unknown {
  const segments = parseJsonPath(path);
  if (segments.length === 0) {
    return value;
  }

  let cursor = target as Record<string, unknown> | unknown[];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment == null) {
      throw new Error(`Invalid import path: ${path}`);
    }
    const isLast = index === segments.length - 1;
    const nextSegment = segments[index + 1];

    if (typeof segment === "number") {
      if (!Array.isArray(cursor)) {
        throw new Error(`Expected array while importing path ${path}`);
      }

      if (isLast) {
        cursor[segment] = value;
        continue;
      }

      if (cursor[segment] == null) {
        cursor[segment] = typeof nextSegment === "number" ? [] : {};
      }

      cursor = cursor[segment] as Record<string, unknown> | unknown[];
      continue;
    }

    if (Array.isArray(cursor)) {
      throw new Error(`Unexpected object segment while importing path ${path}`);
    }

    if (isLast) {
      cursor[segment] = value;
      continue;
    }

    if (cursor[segment] == null) {
      cursor[segment] = typeof nextSegment === "number" ? [] : {};
    }

    cursor = cursor[segment] as Record<string, unknown> | unknown[];
  }

  return target;
}

export function flattenConfigValue(value: unknown, path = ""): FlattenedConfigEntry[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [
        {
          path,
          type: "array",
          displayValue: "[]",
          jsonValue: "[]"
        }
      ];
    }

    return value.flatMap((item, index) => flattenConfigValue(item, `${path}[${index}]`));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [
        {
          path,
          type: "object",
          displayValue: "{}",
          jsonValue: "{}"
        }
      ];
    }

    return entries.flatMap(([key, nested]) => flattenConfigValue(nested, path ? `${path}.${key}` : key));
  }

  return [
    {
      path,
      type: value === null ? "null" : typeof value,
      displayValue: value == null ? "null" : typeof value === "string" ? value : JSON.stringify(value),
      jsonValue: JSON.stringify(value)
    }
  ];
}

export function classifyDiffKind(
  previousEntry: FlattenedConfigEntry | undefined,
  nextEntry: FlattenedConfigEntry | undefined,
  schemaNode: JsonSchemaNode | undefined
): ConfigDiffChangeKind {
  if (!previousEntry && nextEntry) {
    return "field_added";
  }
  if (previousEntry && !nextEntry) {
    return "field_removed";
  }
  if (previousEntry && nextEntry && previousEntry.type !== nextEntry.type) {
    return "type_changed";
  }
  if (
    schemaNode?.enum &&
    previousEntry &&
    nextEntry &&
    previousEntry.jsonValue !== nextEntry.jsonValue
  ) {
    return "enum_changed";
  }
  return "value";
}

export function uniqueStrings(items: Iterable<string>): string[] {
  return Array.from(
    new Set(
      [...items]
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
}

export function createConfigHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof Error) {
    return {
      code: "request_failed",
      message: error.message
    };
  }

  return {
    code: "request_failed",
    message: "Unknown error"
  };
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "Config document not found"
    }
  });
}

export function configDefinitionFor(id: string): ConfigDefinition | undefined {
  return CONFIG_DEFINITIONS.find((item) => item.id === id);
}

export function buildSummary(id: ConfigDocumentId, parsed: unknown): string {
  if (id === "world") {
    const config = parsed as WorldGenerationConfig;
    return `${config.width}x${config.height} · ${config.heroes.length} hero(es)`;
  }

  if (id === "mapObjects") {
    const config = parsed as MapObjectsConfig;
    return `${config.neutralArmies.length} neutral army(ies) · ${config.guaranteedResources.length} guaranteed resource(s) · ${config.buildings.length} building(s)`;
  }

  if (id === "units") {
    const config = parsed as UnitCatalogConfig;
    return `${config.templates.length} unit template(s)`;
  }

  if (id === "battleSkills") {
    const config = parsed as BattleSkillCatalogConfig;
    return `${config.skills.length} skill(s) · ${config.statuses.length} status(es)`;
  }

  if (id === "leaderboardTierThresholds") {
    const config = parsed as LeaderboardTierThresholdsConfigDocument;
    return `${config.tiers.length} tier(s) · ${config.key}`;
  }

  const config = parsed as BattleBalanceConfig;
  return `damage/env/timer/pvp · ${config.turnTimerSeconds}s/${config.afkStrikesBeforeForfeit} AFK · K=${config.pvp.eloK} · trap=${config.environment.trapDamage}`;
}

export function isRuntimeConfigDocumentId(id: ConfigDocumentId): id is RuntimeConfigDocumentId {
  return (RUNTIME_CONFIG_DOCUMENT_IDS as readonly string[]).includes(id);
}

export function normalizeJsonContent(
  parsed: ParsedConfigDocument
): string {
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function positionKey(position: { x: number; y: number }): string {
  return `${position.x},${position.y}`;
}

export function createTerrainCountRecord(): Record<TerrainType, number> {
  return {
    grass: 0,
    dirt: 0,
    sand: 0,
    water: 0,
    swamp: 0
  };
}

export function createResourceCountRecord(): Record<ResourceKind, number> {
  return {
    gold: 0,
    wood: 0,
    ore: 0
  };
}

export function normalizePreviewSeed(seed: unknown, fallback = 1001): number {
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    return fallback;
  }

  return Math.max(0, Math.floor(seed));
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function formatTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

