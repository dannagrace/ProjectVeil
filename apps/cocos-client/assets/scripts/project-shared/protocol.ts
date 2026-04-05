import type {
  BattleAction,
  BattleState,
  CosmeticId,
  EquippedCosmetics,
  MovementPlan,
  Vec2,
  WorldAction,
  WorldEvent
} from "./models.ts";
import type { PlayerWorldViewPayload } from "./map-sync.ts";

export type SessionStateReason = "surrender" | "afk_forfeit" | "normal" | (string & {});
export interface TutorialProgressAction {
  step: number | null;
  reason?: "advance" | "skip" | "complete";
}
export interface FeatureFlags {
  quest_system_enabled: boolean;
  battle_pass_enabled: boolean;
  pve_enabled: boolean;
  tutorial_enabled: boolean;
}

export interface SessionStatePayload {
  world: PlayerWorldViewPayload;
  battle: BattleState | null;
  events: WorldEvent[];
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
  featureFlags: FeatureFlags;
  reason?: SessionStateReason;
}

export type PlayerReportReason = "cheating" | "harassment" | "afk";
export type PlayerReportStatus = "pending" | "dismissed" | "warned" | "banned";

export type ClientMessage =
  | {
      type: "connect";
      requestId: string;
      roomId: string;
      playerId: string;
      displayName?: string;
      authToken?: string;
      seed?: number;
    }
  | {
      type: "world.action";
      requestId: string;
      action: WorldAction;
    }
  | {
      type: "battle.action";
      requestId: string;
      action: BattleAction;
    }
  | {
      type: "world.preview";
      requestId: string;
      heroId: string;
      destination: Vec2;
    }
  | {
      type: "world.reachable";
      requestId: string;
      heroId: string;
    }
  | {
      type: "report.player";
      requestId: string;
      targetPlayerId: string;
      reason: PlayerReportReason;
      description?: string;
    }
  | {
      type: "tutorial.progress";
      requestId: string;
      action: TutorialProgressAction;
    }
  | {
      type: "BUY_COSMETIC";
      requestId: string;
      cosmeticId: CosmeticId;
    }
  | {
      type: "EQUIP_COSMETIC";
      requestId: string;
      cosmeticId: CosmeticId;
    }
  | {
      type: "USE_EMOTE";
      requestId: string;
      emoteId: CosmeticId;
    };

export type ServerMessage =
  | {
      type: "session.state";
      requestId: string;
      delivery: "reply" | "push";
      payload: SessionStatePayload;
    }
  | {
      type: "turn.timer";
      requestId: "push";
      delivery: "push";
      remainingMs: number;
      turnOwnerPlayerId: string;
    }
  | {
      type: "world.preview";
      requestId: string;
      movementPlan: MovementPlan | null;
    }
  | {
      type: "world.reachable";
      requestId: string;
      reachableTiles: Vec2[];
    }
  | {
      type: "error";
      requestId: string;
      reason: string;
    }
  | {
      type: "report.player";
      requestId: string;
      reportId: string;
      targetPlayerId: string;
      reason: PlayerReportReason;
      status: PlayerReportStatus;
      createdAt: string;
    }
  | {
      type: "event.progress.update";
      requestId: "push";
      delivery: "push";
      payload: {
        eventId: string;
        points: number;
        delta: number;
        objectiveId: string;
      };
    }
  | {
      type: "COSMETIC_APPLIED";
      requestId: string;
      delivery: "reply" | "push";
      playerId: string;
      cosmeticId: CosmeticId;
      action: "purchased" | "equipped" | "emote";
      equippedCosmetics?: EquippedCosmetics;
    };
