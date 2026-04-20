import assetConfigJson from "../../../../configs/assets.json";
import { type AssetStage, parseAssetConfig, summarizeAssetMetadata } from "@veil/shared/assets-config";
import {
  cocosPresentationConfig,
  type CocosAnimationDeliveryMode,
  type CocosPresentationAssetStage
} from "./cocos-presentation-config.ts";

export type CocosPresentationReadinessStage = "missing" | "placeholder" | "mixed" | "production";

export interface CocosPresentationReadinessSection {
  label: string;
  stage: CocosPresentationReadinessStage;
  headline: string;
  detail: string;
  shortLabel: string;
}

export interface CocosAnimationReadinessSection extends CocosPresentationReadinessSection {
  deliveryModes: Record<CocosAnimationDeliveryMode, number>;
}

export interface CocosBattleJourneyReadinessSection extends CocosPresentationReadinessSection {
  verifiedStages: Array<"entry" | "command" | "impact" | "resolution">;
}

export interface CocosPresentationReadiness {
  summary: string;
  nextStep: string;
  pixel: CocosPresentationReadinessSection;
  audio: CocosPresentationReadinessSection;
  animation: CocosAnimationReadinessSection;
  battleJourney: CocosBattleJourneyReadinessSection;
}

export interface CocosPresentationReleaseGate {
  ready: boolean;
  blockers: string[];
}

const assetConfig = parseAssetConfig(assetConfigJson);

function resolveReadinessStage(placeholderCount: number, productionCount: number): CocosPresentationReadinessStage {
  const total = placeholderCount + productionCount;
  if (total === 0) {
    return "missing";
  }
  if (placeholderCount > 0 && productionCount > 0) {
    return "mixed";
  }
  return productionCount > 0 ? "production" : "placeholder";
}

function formatReadinessStageLabel(stage: CocosPresentationReadinessStage): string {
  switch (stage) {
    case "production":
      return "正式";
    case "mixed":
      return "混合";
    case "missing":
      return "缺失";
    default:
      return "占位";
  }
}

function summarizeConfigStages(stages: CocosPresentationAssetStage[]): { stage: CocosPresentationReadinessStage; placeholder: number; production: number } {
  const placeholder = stages.filter((stage) => stage === "placeholder").length;
  const production = stages.filter((stage) => stage === "production").length;
  return {
    stage: resolveReadinessStage(placeholder, production),
    placeholder,
    production
  };
}

function buildPixelReadiness(): CocosPresentationReadinessSection {
  const metadata = summarizeAssetMetadata(assetConfig);
  const terrainCount = Object.keys(assetConfig.showcaseTerrain).length;
  const heroCount = Object.keys(assetConfig.heroes).length;
  const unitCount = Object.keys(assetConfig.units).length + Object.keys(assetConfig.showcaseUnits).length;
  const buildingCount = new Set([
    ...Object.keys(assetConfig.buildings),
    ...Object.keys(assetConfig.showcaseBuildings)
  ]).size;
  const stage = resolveReadinessStage(metadata.byStage.placeholder, metadata.byStage.production);
  return {
    label: "像素",
    stage,
    headline: `像素 ${terrainCount} 地形 / ${heroCount} 英雄 / ${unitCount} 单位 / ${buildingCount} 建筑`,
    detail: `${metadata.byStage.production} 正式 / ${metadata.byStage.placeholder} 占位 · H5 / Cocos 共用资源清单`,
    shortLabel: `像素 ${formatReadinessStageLabel(stage)} ${metadata.byStage.production}/${metadata.total}`
  };
}

function buildAudioReadiness(): CocosPresentationReadinessSection {
  const musicEntries = Object.values(cocosPresentationConfig.audio.music);
  const cueEntries = Object.values(cocosPresentationConfig.audio.cues);
  const stageSummary = summarizeConfigStages([...musicEntries, ...cueEntries].map((entry) => entry.assetStage));
  return {
    label: "音频",
    stage: stageSummary.stage,
    headline: `音频 ${musicEntries.length} 首 BGM / ${cueEntries.length} 组 SFX`,
    detail: `${stageSummary.production} 正式 / ${stageSummary.placeholder} 占位 · 资源音频优先，缺失时回退合成`,
    shortLabel: `音频 ${formatReadinessStageLabel(stageSummary.stage)} ${stageSummary.production}/${musicEntries.length + cueEntries.length}`
  };
}

function buildAnimationReadiness(): CocosAnimationReadinessSection {
  const profiles = Object.values(cocosPresentationConfig.animationProfiles);
  const deliveryModes: Record<CocosAnimationDeliveryMode, number> = {
    fallback: 0,
    sequence: 0,
    clip: 0,
    spine: 0
  };
  for (const profile of profiles) {
    deliveryModes[profile.deliveryMode] += 1;
  }
  const stageSummary = summarizeConfigStages(profiles.map((profile) => profile.assetStage));
  return {
    label: "动画",
    stage: stageSummary.stage,
    headline: `动画 ${profiles.length} 模板 · Spine ${deliveryModes.spine} / Clip ${deliveryModes.clip} / 序列 ${deliveryModes.sequence} / 回退 ${deliveryModes.fallback}`,
    detail: `${stageSummary.production} 正式 / ${stageSummary.placeholder} 占位 · idle / attack / hit / victory / defeat 命名已收口`,
    shortLabel: deliveryModes.spine > 0
      ? `动画 Spine ${deliveryModes.spine}/${profiles.length}`
      : deliveryModes.clip > 0
        ? `动画 Clip ${deliveryModes.clip}/${profiles.length}`
        : deliveryModes.sequence > 0
          ? `动画 序列 ${deliveryModes.sequence}/${profiles.length}`
          : `动画 回退 ${deliveryModes.fallback}/${profiles.length}`,
    deliveryModes
  };
}

function buildBattleJourneyReadiness(): CocosBattleJourneyReadinessSection {
  const verifiedStages: CocosBattleJourneyReadinessSection["verifiedStages"] = ["entry", "command", "impact", "resolution"];
  return {
    label: "战斗流程",
    stage: "production",
    headline: "战斗主流程已正式化 · 进场 / 指令 / 受击 / 结算",
    detail: "Battle panel 与 transition feedback 已明确暴露阶段标签、badge、下一步提示与中性结算回写壳，剩余占位风险转入资产层追踪",
    shortLabel: "战斗流程 正式 4/4",
    verifiedStages
  };
}

function buildNextStep(
  pixel: CocosPresentationReadinessSection,
  audio: CocosPresentationReadinessSection,
  animation: CocosAnimationReadinessSection,
  battleJourney: CocosBattleJourneyReadinessSection
): string {
  const blockers = getCocosPresentationReleaseGate({
    pixel,
    audio,
    animation
  }).blockers;
  return blockers.length > 0
    ? `${battleJourney.shortLabel} · 待替换 ${blockers.join(" / ")}`
    : "战斗流程与表现资源均已达到正式阶段";
}

export function buildCocosPresentationReadiness(): CocosPresentationReadiness {
  const pixel = buildPixelReadiness();
  const audio = buildAudioReadiness();
  const animation = buildAnimationReadiness();
  const battleJourney = buildBattleJourneyReadiness();
  return {
    pixel,
    audio,
    animation,
    battleJourney,
    summary: formatPresentationReadinessSummary({ pixel, audio, animation }),
    nextStep: buildNextStep(pixel, audio, animation, battleJourney)
  };
}

export function formatPresentationReadinessSummary(readiness: Pick<CocosPresentationReadiness, "pixel" | "audio" | "animation">): string {
  return `${readiness.pixel.shortLabel} · ${readiness.audio.shortLabel} · ${readiness.animation.shortLabel}`;
}

export function getCocosPresentationReleaseGate(
  readiness: Pick<CocosPresentationReadiness, "pixel" | "audio" | "animation">
): CocosPresentationReleaseGate {
  const blockers: string[] = [];
  if (readiness.pixel.stage !== "production") {
    blockers.push("正式像素美术");
  }
  if (readiness.audio.stage !== "production") {
    blockers.push("真实 BGM/SFX");
  }
  if (readiness.animation.stage !== "production") {
    blockers.push("正式动画资产");
  }
  if (readiness.animation.deliveryModes.fallback > 0) {
    blockers.push("动画回退交付");
  }

  return {
    ready: blockers.length === 0,
    blockers
  };
}

export const cocosPresentationReadiness = buildCocosPresentationReadiness();
