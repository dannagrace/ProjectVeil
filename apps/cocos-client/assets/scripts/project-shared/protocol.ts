import type { BattleAction, BattleState, MovementPlan, Vec2, WorldAction, WorldEvent } from "./models.ts";
import type { PlayerWorldViewPayload } from "./map-sync.ts";

export type SessionStateReason = "surrender" | "afk_forfeit" | "normal" | (string & {});

export interface SessionStatePayload {
  world: PlayerWorldViewPayload;
  battle: BattleState | null;
  events: WorldEvent[];
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
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
    };
