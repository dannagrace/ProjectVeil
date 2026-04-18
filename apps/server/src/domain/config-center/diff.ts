import type {
  ConfigDiff,
  ConfigDiffChangeKind,
  ConfigDiffEntry,
  ConfigDiffPreview,
  ConfigDiffPreviewAddedEntry,
  ConfigDiffPreviewModifiedEntry,
  ConfigDiffPreviewRemovedEntry,
  ConfigDocumentId,
  ConfigImpactSummary
} from "./types";
import { BASE_SCHEMA_IMPACT, BASE_VALUE_IMPACT, CONFIG_IMPACT_RULES, CONFIG_RUNTIME_IMPACT } from "./constants";
import {
  classifyDiffKind,
  flattenConfigValue,
  parseJsonPath,
  uniqueStrings
} from "./helpers";
import {
  CONFIG_DOCUMENT_SCHEMAS,
  describeSchemaPath,
  flattenConfigValueWithSchema,
  isSchemaPathRequired,
  schemaNodeForPath,
  typeLabelForSchema
} from "./schemas";

export function buildBlastRadius(id: ConfigDocumentId, kind: ConfigDiffChangeKind): string[] {
  const base = kind === "value" ? BASE_VALUE_IMPACT : BASE_SCHEMA_IMPACT;
  const scoped = kind === "value" ? [] : CONFIG_RUNTIME_IMPACT[id] ?? [];
  return Array.from(new Set([...base, ...scoped]));
}

export function buildConfigImpactSummary(
  id: ConfigDocumentId,
  title: string,
  diffEntries: ConfigDiffEntry[]
): ConfigImpactSummary | null {
  if (diffEntries.length === 0) {
    return null;
  }

  const rule = CONFIG_IMPACT_RULES[id];
  const changedFields = uniqueStrings(diffEntries.map((entry) => entry.path)).slice(0, 4);
  const impactedModules = uniqueStrings([
    ...rule.impactedModules,
    ...diffEntries.flatMap((entry) => entry.blastRadius),
    ...(CONFIG_RUNTIME_IMPACT[id] ?? [])
  ]);
  const structuralCount = diffEntries.filter((entry) => entry.kind !== "value").length;
  let riskLevel = rule.defaultRisk;

  if (id === "mapObjects") {
    const highSignal = changedFields.some((entry) =>
      /(buildings|neutralArmies|guaranteedResources|reward|recruitCount|income|unitTemplateId)/.test(entry)
    );
    if (highSignal || structuralCount > 0 || diffEntries.length >= 8) {
      riskLevel = "high";
    }
  } else if (id === "units") {
    const highSignal = changedFields.some((entry) =>
      /(attack|defense|minDamage|maxDamage|maxHp|initiative|skills|templateId)/.test(entry)
    );
    if (highSignal || structuralCount > 0 || diffEntries.length >= 10) {
      riskLevel = "high";
    }
  }

  const riskHints = uniqueStrings([
    structuralCount > 0 ? `包含 ${structuralCount} 项结构变更，需留意 Schema/运行时兼容性。` : "",
    riskLevel === "high" ? "命中高敏感配置域，建议在发布前补一次联动回归。" : "",
    changedFields.some((entry) => /(width|height|heroes|resourceSpawn)/.test(entry))
      ? "世界生成参数已变更，地图尺寸、出生点或资源刷率可能一起波动。"
      : "",
    changedFields.some((entry) => /(neutralArmies|buildings|guaranteedResources)/.test(entry))
      ? "地图对象已调整，守军、建筑或资源点分布可能改变探索与招募节奏。"
      : "",
    changedFields.some((entry) => /(attack|defense|minDamage|maxDamage|maxHp|initiative)/.test(entry))
      ? "单位面板已调整，战斗节奏和招募价值可能出现连锁变化。"
      : "",
    changedFields.some((entry) => /(cooldown|damageMultiplier|grantedStatusId|onHitStatusId|statuses)/.test(entry))
      ? "技能或状态参数已调整，技能链和状态覆盖率需要重点复核。"
      : "",
    changedFields.some((entry) => /(damage|environment|eloK|trap|blocker)/.test(entry))
      ? "战斗公式或环境机关已调整，伤害结算与 PVP 评分可能漂移。"
      : ""
  ]);

  return {
    documentId: id,
    title,
    summary:
      structuralCount > 0
        ? `${diffEntries.length} 项字段变更，其中 ${structuralCount} 项为结构风险。`
        : `${diffEntries.length} 项字段变更，主要关注 ${changedFields.join(", ")}。`,
    riskLevel,
    changedFields,
    impactedModules,
    riskHints,
    suggestedValidationActions: [...rule.suggestedValidationActions]
  };
}

export function buildConfigDiffEntries(
  id: ConfigDocumentId,
  previousContent: string,
  nextContent: string
): ConfigDiffEntry[] {
  const previousMap = new Map(
    flattenConfigValue(JSON.parse(previousContent))
      .filter((entry) => entry.path)
      .map((entry) => [entry.path, entry])
  );
  const nextMap = new Map(
    flattenConfigValue(JSON.parse(nextContent))
      .filter((entry) => entry.path)
      .map((entry) => [entry.path, entry])
  );
  const schema = CONFIG_DOCUMENT_SCHEMAS[id];
  const allPaths = new Set([...previousMap.keys(), ...nextMap.keys()]);

  return [...allPaths]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((path) => {
      const previousEntry = previousMap.get(path);
      const nextEntry = nextMap.get(path);

      if (previousEntry?.jsonValue === nextEntry?.jsonValue) {
        return [];
      }

      const node = schemaNodeForPath(schema, path);
      const description = node
        ? describeSchemaPath(schema, path)
        : "自定义字段，Schema 未定义。";
      const fieldType = node
        ? typeLabelForSchema(node)
        : nextEntry?.type ?? previousEntry?.type ?? "unknown";
      const kind = classifyDiffKind(previousEntry, nextEntry, node);

      return [
        {
          path,
          change: previousEntry == null ? "added" : nextEntry == null ? "removed" : "updated",
          previousValue: previousEntry?.jsonValue ?? "",
          nextValue: nextEntry?.jsonValue ?? "",
          kind,
          required: isSchemaPathRequired(schema, path),
          fieldType,
          description,
          blastRadius: buildBlastRadius(id, kind)
        }
      ];
    });
}

export function createConfigDiffPreview(entries: ConfigDiffEntry[]): Pick<
  ConfigDiffPreview,
  "added" | "modified" | "removed" | "changeCount" | "structuralChangeCount"
> {
  const added: ConfigDiffPreviewAddedEntry[] = [];
  const modified: ConfigDiffPreviewModifiedEntry[] = [];
  const removed: ConfigDiffPreviewRemovedEntry[] = [];

  for (const entry of entries) {
    const base = {
      kind: entry.kind,
      required: entry.required,
      fieldType: entry.fieldType,
      description: entry.description,
      blastRadius: [...entry.blastRadius]
    };
    if (entry.change === "added") {
      added.push({
        key: entry.path,
        after: entry.nextValue,
        ...base
      });
      continue;
    }
    if (entry.change === "removed") {
      removed.push({
        key: entry.path,
        before: entry.previousValue,
        ...base
      });
      continue;
    }
    modified.push({
      key: entry.path,
      before: entry.previousValue,
      after: entry.nextValue,
      ...base
    });
  }

  return {
    added,
    modified,
    removed,
    changeCount: entries.length,
    structuralChangeCount: entries.filter((entry) => entry.kind !== "value").length
  };
}

