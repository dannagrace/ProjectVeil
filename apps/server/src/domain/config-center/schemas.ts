import type {
  ConfigDocumentId,
  ConfigSchemaSummary,
  ValidationIssue
} from "@server/domain/config-center/types";
import type { JsonSchemaNode, FlattenedConfigEntry } from "@server/domain/config-center/constants";
import { CONFIG_SCHEMA_VERSION } from "@server/domain/config-center/constants";
import { parseJsonPath, pushIssue } from "@server/domain/config-center/helpers";

export const CONFIG_DOCUMENT_SCHEMAS: Record<ConfigDocumentId, JsonSchemaNode> = {
  world: {
    type: "object",
    title: "World Config",
    description: "世界生成配置，包含地图尺寸、英雄出生点和随机资源概率。",
    required: ["width", "height", "heroes", "resourceSpawn"],
    properties: {
      width: { type: "integer", minimum: 1, description: "地图宽度，单位为格子。" },
      height: { type: "integer", minimum: 1, description: "地图高度，单位为格子。" },
      heroes: {
        type: "array",
        minItems: 1,
        description: "初始英雄列表。",
        items: {
          type: "object",
          required: ["id", "playerId", "name", "position", "vision", "move", "stats", "progression", "armyTemplateId", "armyCount"],
          properties: {
            id: { type: "string", description: "英雄唯一 id。" },
            playerId: { type: "string", description: "所属玩家 id。" },
            name: { type: "string", description: "英雄显示名。" },
            position: {
              type: "object",
              required: ["x", "y"],
              properties: {
                x: { type: "integer", minimum: 0, description: "英雄初始 X 坐标。" },
                y: { type: "integer", minimum: 0, description: "英雄初始 Y 坐标。" }
              }
            },
            vision: { type: "integer", minimum: 0, description: "初始视野范围。" },
            move: {
              type: "object",
              required: ["total", "remaining"],
              properties: {
                total: { type: "integer", minimum: 1, description: "每日总移动力。" },
                remaining: { type: "integer", minimum: 0, description: "当前剩余移动力。" }
              }
            },
            stats: {
              type: "object",
              required: ["attack", "defense", "power", "knowledge", "hp", "maxHp"],
              properties: {
                attack: { type: "integer", minimum: 0, description: "攻击属性。" },
                defense: { type: "integer", minimum: 0, description: "防御属性。" },
                power: { type: "integer", minimum: 0, description: "力量属性。" },
                knowledge: { type: "integer", minimum: 0, description: "知识属性。" },
                hp: { type: "integer", minimum: 1, description: "当前生命值。" },
                maxHp: { type: "integer", minimum: 1, description: "最大生命值。" }
              }
            },
            progression: {
              type: "object",
              required: ["level", "experience", "battlesWon", "neutralBattlesWon", "pvpBattlesWon"],
              properties: {
                level: { type: "integer", minimum: 1, description: "英雄等级。" },
                experience: { type: "integer", minimum: 0, description: "累计经验值。" },
                battlesWon: { type: "integer", minimum: 0, description: "总胜场。" },
                neutralBattlesWon: { type: "integer", minimum: 0, description: "PVE 胜场。" },
                pvpBattlesWon: { type: "integer", minimum: 0, description: "PVP 胜场。" }
              }
            },
            armyTemplateId: { type: "string", description: "初始携带兵种模板 id。" },
            armyCount: { type: "integer", minimum: 1, description: "初始部队数量。" }
          }
        }
      },
      resourceSpawn: {
        type: "object",
        description: "随机资源生成概率。",
        required: ["goldChance", "woodChance", "oreChance"],
        properties: {
          goldChance: { type: "number", minimum: 0, description: "金币资源点生成概率。" },
          woodChance: { type: "number", minimum: 0, description: "木材资源点生成概率。" },
          oreChance: { type: "number", minimum: 0, description: "矿石资源点生成概率。" }
        }
      }
    }
  },
  mapObjects: {
    type: "object",
    title: "Map Objects Config",
    description: "地图物件配置，包含中立怪、保底资源和建筑。",
    required: ["neutralArmies", "guaranteedResources", "buildings"],
    properties: {
      neutralArmies: {
        type: "array",
        description: "中立军队布置。",
        items: {
          type: "object",
          required: ["id", "position", "stacks"],
          properties: {
            id: { type: "string", description: "中立军队 id。" },
            position: {
              type: "object",
              required: ["x", "y"],
              properties: {
                x: { type: "integer", minimum: 0, description: "X 坐标。" },
                y: { type: "integer", minimum: 0, description: "Y 坐标。" }
              }
            },
            stacks: {
              type: "array",
              minItems: 1,
              description: "守军兵堆。",
              items: {
                type: "object",
                required: ["templateId", "count"],
                properties: {
                  templateId: { type: "string", description: "兵种模板 id。" },
                  count: { type: "integer", minimum: 1, description: "该兵堆数量。" }
                }
              }
            }
          }
        }
      },
      guaranteedResources: {
        type: "array",
        description: "保底资源点。",
        items: {
          type: "object",
          required: ["position", "resource"],
          properties: {
            position: {
              type: "object",
              required: ["x", "y"],
              properties: {
                x: { type: "integer", minimum: 0, description: "X 坐标。" },
                y: { type: "integer", minimum: 0, description: "Y 坐标。" }
              }
            },
            resource: {
              type: "object",
              required: ["kind", "amount"],
              properties: {
                kind: { type: "string", enum: ["gold", "wood", "ore"], description: "资源类型。" },
                amount: { type: "integer", minimum: 1, description: "资源数量。" }
              }
            }
          }
        }
      },
      buildings: {
        type: "array",
        description: "地图建筑配置。",
        items: {
          type: "object",
          required: ["id", "kind", "position", "label"],
          properties: {
            id: { type: "string", description: "建筑 id。" },
            kind: { type: "string", enum: ["recruitment_post", "attribute_shrine", "resource_mine", "watchtower"], description: "建筑种类。" },
            label: { type: "string", description: "建筑显示名。" },
            position: {
              type: "object",
              required: ["x", "y"],
              properties: {
                x: { type: "integer", minimum: 0, description: "X 坐标。" },
                y: { type: "integer", minimum: 0, description: "Y 坐标。" }
              }
            },
            unitTemplateId: { type: "string", description: "招募建筑使用的兵种模板 id。" },
            recruitCount: { type: "integer", minimum: 1, description: "招募建筑每次提供的兵力数量。" },
            cost: { type: "object", description: "招募建筑的资源消耗。" },
            bonus: { type: "object", description: "属性神殿提供的永久属性加成。" },
            resourceKind: { type: "string", enum: ["gold", "wood", "ore"], description: "资源矿场的产出类型。" },
            income: { type: "integer", minimum: 1, description: "资源矿场的每日产出。" },
            visionBonus: { type: "integer", minimum: 1, description: "瞭望塔提供的永久视野加成。" }
          }
        }
      }
    }
  },
  units: {
    type: "object",
    title: "Units Config",
    description: "兵种模板配置，用于世界生成、招募和战斗数值。",
    required: ["templates"],
    properties: {
      templates: {
        type: "array",
        minItems: 1,
        description: "兵种模板列表。",
        items: {
          type: "object",
          required: ["id", "stackName", "faction", "rarity", "initiative", "attack", "defense", "minDamage", "maxDamage", "maxHp"],
          properties: {
            id: { type: "string", description: "兵种模板 id。" },
            stackName: { type: "string", description: "堆叠显示名。" },
            faction: { type: "string", description: "阵营。" },
            rarity: { type: "string", description: "品质。" },
            initiative: { type: "integer", minimum: 1, description: "先攻值。" },
            attack: { type: "integer", minimum: 1, description: "攻击值。" },
            defense: { type: "integer", minimum: 1, description: "防御值。" },
            minDamage: { type: "integer", minimum: 1, description: "最小伤害。" },
            maxDamage: { type: "integer", minimum: 1, description: "最大伤害。" },
            maxHp: { type: "integer", minimum: 1, description: "最大生命值。" },
            battleSkills: {
              type: "array",
              description: "技能 id 列表。",
              items: { type: "string", description: "技能 id。" }
            }
          }
        }
      }
    }
  },
  battleSkills: {
    type: "object",
    title: "Battle Skills Config",
    description: "战斗技能和持续状态配置。",
    required: ["skills", "statuses"],
    properties: {
      skills: {
        type: "array",
        description: "技能列表。",
        items: {
          type: "object",
          required: ["id", "name", "description", "kind", "target", "cooldown"],
          properties: {
            id: { type: "string", description: "技能 id。" },
            name: { type: "string", description: "技能名称。" },
            description: { type: "string", description: "技能描述。" },
            kind: { type: "string", enum: ["active", "passive"], description: "技能种类。" },
            target: { type: "string", enum: ["enemy", "self", "ally"], description: "技能目标。" },
            cooldown: { type: "integer", minimum: 0, description: "冷却回合。" },
            effects: {
              type: "object",
              description: "技能效果集合。",
              properties: {
                damageMultiplier: { type: "number", minimum: 0, description: "伤害倍率。" },
                allowRetaliation: { type: "boolean", description: "是否允许反击。" },
                grantedStatusId: { type: "string", description: "施加给自身的状态 id。" },
                onHitStatusId: { type: "string", description: "命中附加的状态 id。" }
              }
            }
          }
        }
      },
      statuses: {
        type: "array",
        description: "状态列表。",
        items: {
          type: "object",
          required: ["id", "name", "description", "duration", "attackModifier", "defenseModifier", "damagePerTurn"],
          properties: {
            id: { type: "string", description: "状态 id。" },
            name: { type: "string", description: "状态名称。" },
            description: { type: "string", description: "状态描述。" },
            duration: { type: "integer", minimum: 1, description: "持续回合。" },
            attackModifier: { type: "integer", description: "攻击修正。" },
            defenseModifier: { type: "integer", description: "防御修正。" },
            damagePerTurn: { type: "integer", minimum: 0, description: "每回合伤害。" }
          }
        }
      }
    }
  },
  battleBalance: {
    type: "object",
    title: "Battle Balance Config",
    description: "战斗公式、环境生成阈值和 PVP 参数。",
    required: ["damage", "environment", "turnTimerSeconds", "afkStrikesBeforeForfeit", "pvp"],
    properties: {
      damage: {
        type: "object",
        description: "伤害公式参数。",
        required: [
          "defendingDefenseBonus",
          "offenseAdvantageStep",
          "minimumOffenseMultiplier",
          "varianceBase",
          "varianceRange"
        ],
        properties: {
          defendingDefenseBonus: { type: "number", description: "防守指令提供的额外防御值。" },
          offenseAdvantageStep: { type: "number", description: "攻防差每点带来的伤害修正步进。" },
          minimumOffenseMultiplier: { type: "number", minimum: 0.01, description: "伤害倍率下限。" },
          varianceBase: { type: "number", minimum: 0.01, description: "伤害波动基础值。" },
          varianceRange: { type: "number", minimum: 0, description: "伤害波动区间。" }
        }
      },
      environment: {
        type: "object",
        description: "遭遇战环境生成参数。",
        required: [
          "blockerSpawnThreshold",
          "blockerDurability",
          "trapSpawnThreshold",
          "trapDamage",
          "trapCharges"
        ],
        properties: {
          blockerSpawnThreshold: { type: "number", minimum: 0, description: "路障生成阈值，范围 0-1。" },
          blockerDurability: { type: "integer", minimum: 1, description: "路障耐久。" },
          trapSpawnThreshold: { type: "number", minimum: 0, description: "陷阱生成阈值，范围 0-1。" },
          trapDamage: { type: "integer", minimum: 0, description: "伤害型陷阱的基础伤害。" },
          trapCharges: { type: "integer", minimum: 1, description: "陷阱可触发次数。" },
          trapGrantedStatusId: { type: "string", description: "伤害型陷阱附加的状态 id，可选。" }
        }
      },
      turnTimerSeconds: { type: "integer", minimum: 1, description: "PVP 回合倒计时秒数。" },
      afkStrikesBeforeForfeit: { type: "integer", minimum: 1, description: "同一局内累计几次挂机后直接判负。" },
      pvp: {
        type: "object",
        description: "PVP 匹配与结算参数。",
        required: ["eloK"],
        properties: {
          eloK: { type: "integer", minimum: 1, description: "ELO K 因子。" }
        }
      }
    }
  },
  leaderboardTierThresholds: {
    type: "object",
    title: "Leaderboard Tier Thresholds",
    description: "排行榜段位阈值配置，发布 key 为 leaderboard.tier_thresholds。",
    required: ["key", "tiers"],
    properties: {
      key: {
        type: "string",
        enum: ["leaderboard.tier_thresholds"],
        description: "配置中心发布 key。"
      },
      tiers: {
        type: "array",
        minItems: 5,
        description: "按 bronze -> diamond 顺序定义的连续段位阈值。",
        items: {
          type: "object",
          required: ["tier", "minRating"],
          properties: {
            tier: {
              type: "string",
              enum: ["bronze", "silver", "gold", "platinum", "diamond"],
              description: "段位名。"
            },
            minRating: { type: "integer", minimum: 0, description: "该段位的最低评分。" },
            maxRating: { type: "integer", minimum: 0, description: "该段位的最高评分；最后一档留空表示无上限。" }
          }
        }
      }
    }
  },
  ugcBannedKeywords: {
    type: "object",
    title: "UGC Banned Keywords",
    description: "UGC 人工复核阈值、白名单词与候选敏感词。",
    required: ["schemaVersion", "reviewThreshold", "approvedTerms", "candidateTerms"],
    properties: {
      schemaVersion: { type: "integer", minimum: 1, description: "配置格式版本。" },
      reviewThreshold: { type: "integer", minimum: 10, description: "进入人工复核队列的最低分。" },
      approvedTerms: {
        type: "array",
        description: "审核通过的白名单词。",
        items: { type: "string", description: "白名单词。" }
      },
      candidateTerms: {
        type: "array",
        description: "人工拒绝后沉淀的候选敏感词。",
        items: { type: "string", description: "候选敏感词。" }
      }
    }
  }
};

export function isSchemaPathRequired(schema: JsonSchemaNode, path: string): boolean {
  if (!path) {
    return false;
  }

  const segments = parseJsonPath(path);
  let current: JsonSchemaNode | undefined = schema;
  let required = false;

  for (const segment of segments) {
    if (!current) {
      return false;
    }

    if (typeof segment === "number") {
      current = current.items;
      required = false;
      continue;
    }

    required = Boolean(current.required?.includes(segment));
    current = current.properties?.[segment];
  }

  return required;
}

export function typeLabelForSchema(node: JsonSchemaNode): string {
  if (node.enum) {
    return `enum(${node.enum.join(", ")})`;
  }

  return node.type ?? "unknown";
}

export function describeSchemaRequirement(node: JsonSchemaNode): string {
  const parts = [typeLabelForSchema(node)];
  if (node.minimum != null) {
    parts.push(`>= ${node.minimum}`);
  }
  if (node.minItems != null) {
    parts.push(`items >= ${node.minItems}`);
  }
  return parts.join(" · ");
}

export function buildSchemaSummary(id: ConfigDocumentId): ConfigSchemaSummary {
  const schema = CONFIG_DOCUMENT_SCHEMAS[id];
  return {
    id: `project-veil.config-center.${id}`,
    title: schema.title ?? id,
    version: CONFIG_SCHEMA_VERSION,
    description: schema.description ?? `${id} config schema`,
    required: schema.required ?? []
  };
}

export function schemaNodeForPath(schema: JsonSchemaNode, path: string): JsonSchemaNode | undefined {
  if (!path) {
    return schema;
  }

  let current: JsonSchemaNode | undefined = schema;
  for (const segment of parseJsonPath(path)) {
    if (!current) {
      return undefined;
    }

    if (typeof segment === "number") {
      current = current.items;
      continue;
    }

    current = current.properties?.[segment];
  }

  return current;
}

export function describeSchemaPath(schema: JsonSchemaNode, path: string): string {
  const node = schemaNodeForPath(schema, path);
  if (!node) {
    return "";
  }

  const parts = [node.description ?? ""];
  const requirement = describeSchemaRequirement(node);
  if (requirement && requirement !== "unknown") {
    parts.push(requirement);
  }

  return parts.filter(Boolean).join(" | ");
}

export function flattenConfigValueWithSchema(value: unknown, schema: JsonSchemaNode, path = ""): FlattenedConfigEntry[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [
        {
          path,
          type: "array",
          displayValue: "[]",
          jsonValue: "[]",
          description: describeSchemaPath(schema, path)
        }
      ];
    }

    return value.flatMap((item, index) => flattenConfigValueWithSchema(item, schema, `${path}[${index}]`));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [
        {
          path,
          type: "object",
          displayValue: "{}",
          jsonValue: "{}",
          description: describeSchemaPath(schema, path)
        }
      ];
    }

    return entries.flatMap(([key, nested]) => flattenConfigValueWithSchema(nested, schema, path ? `${path}.${key}` : key));
  }

  return [
    {
      path,
      type: value === null ? "null" : typeof value,
      displayValue: value == null ? "null" : typeof value === "string" ? value : JSON.stringify(value),
      jsonValue: JSON.stringify(value),
      description: describeSchemaPath(schema, path)
    }
  ];
}

export function validateSchemaNode(value: unknown, schema: JsonSchemaNode, path: string, issues: ValidationIssue[]): void {
  const location = path || "$";
  const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;

  if (schema.type === "object") {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      pushIssue(issues, {
        path: location,
        message: `字段需要 object，当前为 ${actualType}。`,
        suggestion: `按 ${describeSchemaRequirement(schema)} 修正该字段结构。`
      });
      return;
    }

    const record = value as Record<string, unknown>;
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in record)) {
        const childPath = path ? `${path}.${requiredKey}` : requiredKey;
        const childSchema = schema.properties?.[requiredKey];
        pushIssue(issues, {
          path: childPath,
          message: `缺少必填字段 ${requiredKey}。`,
          suggestion: childSchema?.description ?? "补齐该字段后再保存。"
        });
      }
    }

    for (const [key, childValue] of Object.entries(record)) {
      const childSchema = schema.properties?.[key];
      if (!childSchema) {
        continue;
      }
      validateSchemaNode(childValue, childSchema, path ? `${path}.${key}` : key, issues);
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      pushIssue(issues, {
        path: location,
        message: `字段需要 array，当前为 ${actualType}。`,
        suggestion: `按 ${describeSchemaRequirement(schema)} 修正该字段结构。`
      });
      return;
    }

    if (schema.minItems != null && value.length < schema.minItems) {
      pushIssue(issues, {
        path: location,
        message: `数组至少需要 ${schema.minItems} 项，当前只有 ${value.length} 项。`,
        suggestion: "补齐数组项后再保存。"
      });
    }

    value.forEach((item, index) => {
      if (schema.items) {
        validateSchemaNode(item, schema.items, `${path}[${index}]`, issues);
      }
    });
    return;
  }

  if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      pushIssue(issues, {
        path: location,
        message: `字段需要 integer，当前为 ${actualType}。`,
        suggestion: `按 ${describeSchemaRequirement(schema)} 调整为整数。`
      });
      return;
    }
  } else if (schema.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      pushIssue(issues, {
        path: location,
        message: `字段需要 number，当前为 ${actualType}。`,
        suggestion: `按 ${describeSchemaRequirement(schema)} 调整为数值。`
      });
      return;
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string") {
      pushIssue(issues, {
        path: location,
        message: `字段需要 string，当前为 ${actualType}。`,
        suggestion: "调整为字符串。"
      });
      return;
    }
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      pushIssue(issues, {
        path: location,
        message: `字段需要 boolean，当前为 ${actualType}。`,
        suggestion: "调整为 true 或 false。"
      });
      return;
    }
  }

  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) {
    pushIssue(issues, {
      path: location,
      message: `字段值不能小于 ${schema.minimum}。`,
      suggestion: `将值调到 ${schema.minimum} 或更高。`
    });
  }

  if (schema.enum && typeof value === "string" && !schema.enum.includes(value)) {
    pushIssue(issues, {
      path: location,
      message: `字段值必须是 ${schema.enum.join(" / ")} 之一。`,
      suggestion: "改成允许的枚举值。"
    });
  }
}
