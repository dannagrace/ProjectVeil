import type { RoomPersistenceSnapshot } from "../../index";
import type { RoomSnapshotStore } from "../../persistence";
import type { ServerMessage } from "../../../../../packages/shared/src/index";
import type { WechatSubscribeTemplateKey } from "../../adapters/wechat-subscribe";

export type MessageOfType<T extends ServerMessage["type"]> = Omit<Extract<ServerMessage, { type: T }>, "type">;

export interface VeilRoomMetadata {
  logicalRoomId: string;
}

export interface VeilRoomOptions {
  metadata: VeilRoomMetadata;
}

export interface JoinOptions {
  logicalRoomId?: string;
  playerId?: string;
  seed?: number;
}

export type BackgroundTaskType = "minor_playtime" | "turn_timer" | "zombie_room_cleanup";

export interface RoomTimerHandle {
  unref?(): void;
}

export interface RoomRuntimeDependencies {
  setInterval(handler: () => void, delayMs: number): RoomTimerHandle;
  clearInterval(handle: RoomTimerHandle): void;
  isMySqlSnapshotStore(store: RoomSnapshotStore | null): boolean;
  now(): number;
  sendWechatSubscribeMessage(
    playerId: string,
    templateKey: WechatSubscribeTemplateKey,
    data: Record<string, unknown>,
    options?: { store?: RoomSnapshotStore | null }
  ): Promise<boolean>;
  sendMobilePushNotification(
    playerId: string,
    templateKey: WechatSubscribeTemplateKey,
    data: Record<string, unknown>,
    options?: { store?: RoomSnapshotStore | null }
  ): Promise<boolean>;
}

export interface WebSocketActionRateLimitConfig {
  windowMs: number;
  max: number;
}

export interface SuspiciousActionAlertConfig {
  windowMs: number;
  threshold: number;
}

export interface SuspiciousActionTracker {
  timestamps: number[];
  lastAlertAt: number | null;
}

export type IdempotentActionReply = Extract<ServerMessage, { type: "session.state" | "error" }>;

export interface IdempotentActionReplayEntry {
  fingerprint: string;
  reply: IdempotentActionReply;
}

export interface PendingIdempotentActionReplayEntry {
  fingerprint: string;
  promise: Promise<IdempotentActionReply>;
}

export interface LobbyRoomSummary {
  roomId: string;
  seed: number;
  day: number;
  connectedPlayers: number;
  disconnectedPlayers: number;
  heroCount: number;
  activeBattles: number;
  statusLabel: string;
  updatedAt: string;
}
