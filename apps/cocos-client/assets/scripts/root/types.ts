import type { CocosBattleFeedbackView } from "../cocos-battle-feedback.ts";
import type { CocosCampaignSummary } from "../cocos-lobby.ts";

export interface BattleSettlementSnapshot {
  label: string;
  detail: string;
  badge: string;
  tone: CocosBattleFeedbackView["tone"];
  summaryLines: string[];
}

export interface TutorialCampaignGuidance {
  mission: NonNullable<CocosCampaignSummary["missions"]>[number] | null;
  objectivePreview: string[];
  phaseLabel: string;
}

export interface GlobalErrorBoundaryEvent {
  message?: string;
  error?: unknown;
  reason?: unknown;
}
