import type { WorldEvent } from "./VeilCocosSession.ts";

export interface BattleTransitionCopy {
  badge: string;
  title: string;
  subtitle: string;
  tone: "enter" | "victory" | "defeat";
}

function formatResourceKindLabel(kind: "gold" | "wood" | "ore"): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
}

export function buildBattleEnterCopy(events: WorldEvent[]): BattleTransitionCopy {
  const event = events.find((item) => item.type === "battle.started");
  if (!event) {
    return {
      badge: "ENCOUNTER",
      title: "遭遇战",
      subtitle: "切入战斗场景",
      tone: "enter"
    };
  }

  if (event.encounterKind === "hero") {
    return {
      badge: "PVP",
      title: event.defenderHeroId ? `敌方英雄 ${event.defenderHeroId}` : "敌方英雄遭遇",
      subtitle: event.initiator === "neutral" ? "对手抢先切入，准备迎战" : "双方部队展开接战",
      tone: "enter"
    };
  }

  return {
    badge: event.initiator === "neutral" ? "AMBUSH" : "PVE",
    title: event.initiator === "neutral" ? "中立守军主动来袭" : "遭遇中立守军",
    subtitle: event.neutralArmyId ? `目标 ${event.neutralArmyId}，切入战斗场景` : "切入战斗场景",
    tone: "enter"
  };
}

export function buildBattleExitCopy(events: WorldEvent[], didWin: boolean): BattleTransitionCopy {
  const summaryParts: string[] = [];

  for (const event of events) {
    if (event.type === "hero.collected") {
      summaryParts.push(`${formatResourceKindLabel(event.resource.kind)} +${event.resource.amount}`);
      continue;
    }

    if (event.type === "hero.equipmentFound") {
      summaryParts.push(`战利品 ${event.equipmentName}`);
      continue;
    }

    if (event.type === "hero.progressed") {
      summaryParts.push(
        event.levelsGained > 0 ? `Lv ${event.level}` : `XP +${event.experienceGained}`
      );
    }
  }

  if (!didWin) {
    return {
      badge: "RETREAT",
      title: "战斗失利",
      subtitle: summaryParts.join(" · ") || "部队需要整顿后再战",
      tone: "defeat"
    };
  }

  return {
    badge: "VICTORY",
    title: "战斗胜利",
    subtitle: summaryParts.join(" · ") || "返回世界地图，继续推进前线",
    tone: "victory"
  };
}
