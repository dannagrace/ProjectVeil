import type { CocosPlayerAccountProfile } from "./cocos-lobby.ts";
import type { PlayerTileView, SessionUpdate } from "./VeilCocosSession.ts";

export interface CocosWorldFocusView {
  headline: string;
  detail: string;
  badge: string;
  summaryLines: string[];
}

export interface CocosWorldFocusInput {
  update: SessionUpdate | null;
  interaction: {
    title: string;
    detail: string;
    actions: Array<{
      id: string;
      label: string;
    }>;
  } | null;
  predictionStatus: string;
  levelUpNotice: {
    title: string;
    detail: string;
  } | null;
  account: Pick<CocosPlayerAccountProfile, "recentBattleReplays">;
}

export function buildCocosWorldFocusView(input: CocosWorldFocusInput): CocosWorldFocusView | null {
  const update = input.update;
  const world = update?.world;
  const hero = world?.ownHeroes[0] ?? null;
  if (!world || !hero || update?.battle) {
    return null;
  }

  const reachableAhead =
    update?.reachableTiles.filter((tile) => tile.x !== hero.position.x || tile.y !== hero.position.y).length ?? 0;
  const currentTile =
    world.map.tiles.find((tile) => tile.position.x === hero.position.x && tile.position.y === hero.position.y) ?? null;
  const tileLabel = describeCurrentTile(currentTile);
  const recentReplay = input.account.recentBattleReplays[0] ?? null;

  if (input.levelUpNotice) {
    return {
      headline: "成长窗口已打开",
      detail: input.levelUpNotice.detail,
      badge: "成长",
      summaryLines: [
        `当前英雄：${hero.name} · Lv ${hero.progression.level} · 技能点 ${hero.progression.skillPoints}`,
        tileLabel ? `当前位置：${tileLabel}` : "当前位置：等待地图同步",
        "建议：先分配成长或确认装备，再继续推进本日目标。"
      ]
    };
  }

  if (input.interaction) {
    const primaryAction = input.interaction.actions[0]?.label ?? "继续交互";
    return {
      headline: `正在处理 ${input.interaction.title}`,
      detail: input.interaction.detail,
      badge: "交互",
      summaryLines: [
        tileLabel ? `当前位置：${tileLabel}` : "当前位置：交互目标附近",
        `建议动作：${primaryAction}`,
        input.interaction.actions.length > 1
          ? `可选操作：${input.interaction.actions.map((action) => action.label).join(" / ")}`
          : "可选操作：当前只有一个推荐动作。"
      ]
    };
  }

  if (hero.move.remaining <= 0) {
    return {
      headline: "今日行动已收尾",
      detail: "移动力已经耗尽，接下来更适合结算收益、整理成长，或推进到下一天。",
      badge: "收尾",
      summaryLines: [
        tileLabel ? `当前位置：${tileLabel}` : "当前位置：等待地图同步",
        recentReplay ? `最近战斗：${recentReplay.battleKind === "hero" ? "PVP" : "PVE"} · ${formatReplayResultLabel(recentReplay.result)}` : "最近战斗：本日尚无新的战报。",
        "建议：优先领取可见奖励，再点击“推进一天”。"
      ]
    };
  }

  if (currentTile?.building) {
    return {
      headline: `驻留 ${currentTile.building.label}`,
      detail: describeBuildingFocus(currentTile),
      badge: "驻留",
      summaryLines: [
        `当前位置：${tileLabel}`,
        reachableAhead > 0 ? `周边仍有 ${reachableAhead} 格可继续推进。` : "周边已没有额外可达格。",
        "建议：先处理脚下建筑收益，再决定是否继续探索。"
      ]
    };
  }

  if (currentTile?.resource) {
    return {
      headline: "脚下有可收集资源",
      detail: `当前格包含 ${formatResourceLabel(currentTile.resource.kind)} ${currentTile.resource.amount}，这是最直接的本日收益。`,
      badge: "采集",
      summaryLines: [
        `当前位置：${tileLabel}`,
        reachableAhead > 0 ? `周边仍有 ${reachableAhead} 格可达。` : "周边已没有额外可达格。",
        "建议：先采集当前资源，再继续推进主线。"
      ]
    };
  }

  if (input.predictionStatus.trim().length > 0) {
    return {
      headline: "等待世界态确认",
      detail: input.predictionStatus,
      badge: "同步",
      summaryLines: [
        tileLabel ? `当前位置：${tileLabel}` : "当前位置：等待地图同步",
        reachableAhead > 0 ? `周边仍有 ${reachableAhead} 格可达。` : "周边已没有额外可达格。",
        "建议：等同步结束后再做下一次地图操作。"
      ]
    };
  }

  return {
    headline: "继续推进本日探索",
    detail:
      reachableAhead > 0
        ? `你当前仍有 ${reachableAhead} 格可达，适合继续探索、靠近建筑或触发下一次遭遇。`
        : "当前可达格已经很少，适合回到据点、领取奖励或整理成长。",
    badge: reachableAhead > 0 ? "推进" : "整理",
    summaryLines: [
      tileLabel ? `当前位置：${tileLabel}` : "当前位置：等待地图同步",
      `英雄状态：${hero.name} · 移动力 ${hero.move.remaining}/${hero.move.total} · 部队 ${hero.armyCount}`,
      recentReplay ? `最近战斗：${formatReplayResultLabel(recentReplay.result)}` : "最近战斗：尚未生成新的战报。"
    ]
  };
}

function describeCurrentTile(tile: PlayerTileView | null): string {
  if (!tile) {
    return "未知地块";
  }

  if (tile.building) {
    return `${formatTerrainLabel(tile.terrain)} · ${tile.building.label}`;
  }

  if (tile.resource) {
    return `${formatTerrainLabel(tile.terrain)} · ${formatResourceLabel(tile.resource.kind)} ${tile.resource.amount}`;
  }

  if (tile.occupant?.kind === "neutral") {
    return `${formatTerrainLabel(tile.terrain)} · 中立守军`;
  }

  if (tile.occupant?.kind === "hero") {
    return `${formatTerrainLabel(tile.terrain)} · 英雄遭遇点`;
  }

  return `${formatTerrainLabel(tile.terrain)} · 空地`;
}

function describeBuildingFocus(tile: PlayerTileView): string {
  const building = tile.building;
  if (!building) {
    return "当前地块没有建筑。";
  }

  switch (building.kind) {
    case "recruitment_post":
      return `这里可以补充 ${building.label} 的驻军与战力，适合在推进前整备部队。`;
    case "attribute_shrine":
      return "这里能提供英雄属性成长，是推进章节前的稳定强化点。";
    case "resource_mine":
      return `这里会持续产出 ${formatResourceLabel(building.resourceKind)}，适合优先占领。`;
    case "watchtower":
      return "这里能扩展视野，让下一段探索更安全。";
    default:
      return "当前建筑可以提供持续推进价值。";
  }
}

function formatTerrainLabel(terrain: PlayerTileView["terrain"]): string {
  switch (terrain) {
    case "grass":
      return "草地";
    case "dirt":
      return "荒地";
    case "sand":
      return "沙地";
    case "water":
      return "水域";
    case "swamp":
      return "沼泽";
    default:
      return "未知地形";
  }
}

function formatResourceLabel(kind: "gold" | "wood" | "ore"): string {
  switch (kind) {
    case "gold":
      return "金币";
    case "wood":
      return "木材";
    case "ore":
      return "矿石";
    default:
      return kind;
  }
}

function formatReplayResultLabel(result: "attacker_victory" | "defender_victory"): string {
  return result === "attacker_victory" ? "战斗胜利" : "战斗失利";
}
