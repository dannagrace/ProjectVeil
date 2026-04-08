import { getDefaultBossEncounterTemplateCatalog } from "../../../../packages/shared/src/world-config.ts";
import type { BossEncounterPhaseConfig } from "../../../../packages/shared/src/models.ts";
import type { BattleState } from "./VeilCocosSession.ts";

export interface CocosBossPhaseDescriptor {
  key: string;
  templateId: string;
  bossUnitId: string;
  bossName: string;
  phaseId: string;
  phaseLabel: string;
  phaseIndex: number;
  totalPhases: number;
  thresholdPercent: number;
  detail: string;
  nextThresholdPercent: number | null;
}

export interface CocosBossPhaseTransitionEvent {
  key: string;
  templateId: string;
  bossUnitId: string;
  bossName: string;
  previousPhaseId: string;
  previousPhaseLabel: string;
  nextPhaseId: string;
  nextPhaseLabel: string;
  nextPhaseIndex: number;
  totalPhases: number;
  thresholdPercent: number;
  bannerTitle: string;
  bannerDetail: string;
  summaryLines: string[];
}

export interface CocosBossPhaseTrackerMarker {
  key: string;
  label: string;
  thresholdPercent: number;
  active: boolean;
  reached: boolean;
}

export interface CocosBossPhaseTrackerView {
  title: string;
  detail: string;
  markers: CocosBossPhaseTrackerMarker[];
}

export function buildBossPhaseDescriptor(battle: BattleState | null): CocosBossPhaseDescriptor | null {
  if (!battle?.bossEncounter) {
    return null;
  }

  const template = getBossTemplate(battle.bossEncounter.templateId);
  const phaseIndex = template.phases.findIndex((phase) => phase.id === battle.bossEncounter?.activePhaseId);
  if (phaseIndex < 0) {
    return null;
  }

  const phase = template.phases[phaseIndex]!;
  const bossUnit = battle.units[battle.bossEncounter.bossUnitId];
  const bossName = bossUnit?.stackName ?? template.name;
  const nextPhase = template.phases[phaseIndex + 1] ?? null;
  return {
    key: `${battle.id}:${phase.id}`,
    templateId: template.id,
    bossUnitId: battle.bossEncounter.bossUnitId,
    bossName,
    phaseId: phase.id,
    phaseLabel: formatBossPhaseLabel(phase.id, phaseIndex),
    phaseIndex,
    totalPhases: template.phases.length,
    thresholdPercent: toPercent(phase.hpThreshold),
    detail: buildBossPhaseDetail(phase),
    nextThresholdPercent: nextPhase ? toPercent(nextPhase.hpThreshold) : null
  };
}

export function buildBossPhaseTransitionEvent(
  previousBattle: BattleState | null,
  nextBattle: BattleState | null
): CocosBossPhaseTransitionEvent | null {
  if (!previousBattle?.bossEncounter || !nextBattle?.bossEncounter) {
    return null;
  }

  if (previousBattle.bossEncounter.templateId !== nextBattle.bossEncounter.templateId) {
    return null;
  }

  if (previousBattle.bossEncounter.activePhaseId === nextBattle.bossEncounter.activePhaseId) {
    return null;
  }

  const previousDescriptor = buildBossPhaseDescriptor(previousBattle);
  const nextDescriptor = buildBossPhaseDescriptor(nextBattle);
  if (!previousDescriptor || !nextDescriptor) {
    return null;
  }

  return {
    key: `${nextBattle.id}:${previousDescriptor.phaseId}->${nextDescriptor.phaseId}`,
    templateId: nextDescriptor.templateId,
    bossUnitId: nextDescriptor.bossUnitId,
    bossName: nextDescriptor.bossName,
    previousPhaseId: previousDescriptor.phaseId,
    previousPhaseLabel: previousDescriptor.phaseLabel,
    nextPhaseId: nextDescriptor.phaseId,
    nextPhaseLabel: nextDescriptor.phaseLabel,
    nextPhaseIndex: nextDescriptor.phaseIndex,
    totalPhases: nextDescriptor.totalPhases,
    thresholdPercent: nextDescriptor.thresholdPercent,
    bannerTitle: `${nextDescriptor.bossName} · ${nextDescriptor.phaseLabel}`,
    bannerDetail: `血线跌破 ${nextDescriptor.thresholdPercent}% · ${nextDescriptor.detail}`,
    summaryLines: [
      `首领阶段切换：${previousDescriptor.phaseLabel} -> ${nextDescriptor.phaseLabel}`,
      `阈值：${nextDescriptor.thresholdPercent}% HP · ${nextDescriptor.detail}`
    ]
  };
}

export function buildBossPhaseTracker(battle: BattleState | null): CocosBossPhaseTrackerView | null {
  const descriptor = buildBossPhaseDescriptor(battle);
  if (!descriptor || !battle?.bossEncounter) {
    return null;
  }

  const template = getBossTemplate(descriptor.templateId);
  const bossUnit = battle.units[battle.bossEncounter.bossUnitId];
  const currentHp = bossUnit?.currentHp ?? 0;
  const maxHp = battle.bossEncounter.maxBossHp;
  const markers = template.phases.map((phase, index) => ({
    key: phase.id,
    label: formatBossPhaseLabel(phase.id, index),
    thresholdPercent: toPercent(phase.hpThreshold),
    active: phase.id === descriptor.phaseId,
    reached: currentHp <= Math.ceil(maxHp * phase.hpThreshold) || phase.id === descriptor.phaseId
  }));
  const nextThreshold =
    descriptor.nextThresholdPercent === null ? "已进入最终阶段" : `下一次切换 ${descriptor.nextThresholdPercent}%`;
  return {
    title: `${descriptor.bossName} · ${descriptor.phaseLabel}`,
    detail: `当前血量 ${currentHp}/${maxHp} HP · ${nextThreshold} · ${descriptor.detail}`,
    markers
  };
}

function getBossTemplate(templateId: string) {
  const template = getDefaultBossEncounterTemplateCatalog().templates.find((entry) => entry.id === templateId);
  if (!template) {
    throw new Error(`Missing boss encounter template for Cocos phase UI: ${templateId}`);
  }
  return template;
}

function formatBossPhaseLabel(phaseId: string, phaseIndex: number): string {
  return `阶段 ${phaseIndex + 1} · ${formatToken(phaseId.replace(/^phase-\d+-/, ""))}`;
}

function buildBossPhaseDetail(phase: BossEncounterPhaseConfig): string {
  const environment = phase.environmentalEffects?.[0];
  if (environment?.description) {
    return environment.description;
  }
  if (environment?.name) {
    return `环境变化：${environment.name}`;
  }
  const scriptedAbility = phase.scriptedAbilities?.[0];
  if (scriptedAbility) {
    return `脚本能力：${formatToken(scriptedAbility.id)}`;
  }
  const skillIds = phase.skillOverrides?.replaceSkillIds ?? [];
  if (skillIds.length > 0) {
    return `技能组：${skillIds.map(formatToken).join(" / ")}`;
  }
  return "首领正在重构当前战斗节奏。";
}

function formatToken(value: string): string {
  return value
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function toPercent(value: number): number {
  return Math.round(value * 100);
}
