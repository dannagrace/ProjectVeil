import type { BattleAction, BattleState, MovementPlan, PlayerWorldView, Vec2, WorldAction, WorldEvent } from "./models";

export interface SessionStatePayload {
  world: PlayerWorldView;
  battle: BattleState | null;
  events: WorldEvent[];
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
  reason?: string;
}

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
    };

export type ServerMessage =
  | {
      type: "session.state";
      requestId: string;
      delivery: "reply" | "push";
      payload: SessionStatePayload;
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
    };
