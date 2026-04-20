import { recordRuntimeErrorEvent } from "@server/domain/ops/observability";
import { captureServerError } from "@server/domain/ops/error-monitoring";
import {
  buildAuthoritativeRoomErrorContext,
  type AuthoritativeWorldRoom
} from "@server/index";
import type { BackgroundTaskType } from "@server/transport/colyseus-room/types";

export function formatBackgroundTaskDetail(taskType: BackgroundTaskType, error: unknown, extras: Record<string, string | number | null> = {}): string {
  const detailParts = [`task=${taskType}`];
  for (const [key, value] of Object.entries(extras)) {
    if (value == null) {
      continue;
    }
    detailParts.push(`${key}=${value}`);
  }
  detailParts.push(`error=${error instanceof Error ? error.message : String(error)}`);
  return detailParts.join(" ");
}

export function reportBackgroundTaskFailure(input: {
  taskType: BackgroundTaskType;
  errorCode: string;
  message: string;
  logMessage: string;
  error: unknown;
  roomId?: string | null;
  playerId?: string | null;
  roomDay?: number | null;
  detail?: string | null;
}): void {
  const detail = input.detail ?? formatBackgroundTaskDetail(input.taskType, input.error);

  console.error(input.logMessage, {
    ...(input.roomId ? { roomId: input.roomId } : {}),
    ...(input.playerId ? { playerId: input.playerId } : {}),
    ...(input.roomDay != null ? { roomDay: input.roomDay } : {}),
    error: input.error
  });

  recordRuntimeErrorEvent({
    id: `${input.errorCode}:${input.roomId ?? "global"}:${Date.now()}`,
    recordedAt: new Date().toISOString(),
    source: "server",
    surface: "colyseus-room",
    candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "workspace",
    featureArea: "runtime",
    ownerArea: "multiplayer",
    severity: "error",
    errorCode: input.errorCode,
    message: input.message,
    context: {
      roomId: input.roomId ?? null,
      playerId: input.playerId ?? null,
      requestId: null,
      route: null,
      action: input.taskType,
      statusCode: null,
      crash: false,
      detail
    }
  });

  void captureServerError({
    errorCode: input.errorCode,
    message: input.message,
    error: input.error,
    severity: "error",
    featureArea: "runtime",
    ownerArea: "multiplayer",
    surface: "colyseus-room",
    context: {
      roomId: input.roomId ?? null,
      playerId: input.playerId ?? null,
      action: input.taskType,
      roomDay: input.roomDay ?? null,
      detail
    }
  });
}

export function reportPersistenceSaveFailure(
  room: AuthoritativeWorldRoom,
  playerId: string,
  requestId: string,
  action: string,
  error: unknown
): void {
  const roomContext = buildAuthoritativeRoomErrorContext(room, playerId);
  const detail = error instanceof Error ? error.message : String(error);

  recordRuntimeErrorEvent({
    id: `${roomContext.roomId}:${playerId}:${requestId}:persistence_save_failed`,
    recordedAt: new Date().toISOString(),
    source: "server",
    surface: "colyseus-room",
    candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    featureArea: "runtime",
    ownerArea: "multiplayer",
    severity: "error",
    errorCode: "persistence_save_failed",
    message: "Room state persistence failed and the action was rolled back.",
    tags: ["room-persistence", action],
    context: {
      roomId: roomContext.roomId,
      playerId: roomContext.playerId,
      requestId,
      route: null,
      action,
      statusCode: null,
      crash: false,
      detail: `battleId=${roomContext.battleId ?? "none"} heroId=${roomContext.heroId ?? "none"} day=${roomContext.day} error=${detail}`
    }
  });

  void captureServerError({
    errorCode: "persistence_save_failed",
    message: "Room state persistence failed and the action was rolled back.",
    error,
    severity: "error",
    featureArea: "runtime",
    ownerArea: "multiplayer",
    surface: "colyseus-room",
    tags: ["room-persistence", action],
    context: {
      roomId: roomContext.roomId,
      playerId: roomContext.playerId,
      requestId,
      action,
      roomDay: roomContext.day,
      battleId: roomContext.battleId,
      heroId: roomContext.heroId,
      detail
    }
  });
}
