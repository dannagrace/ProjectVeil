import type { RowDataPacket } from "mysql2/promise";
import type {
  BattleState,
  PlayerMailboxGrant,
  PlayerMailboxMessage,
  Vec2
} from "../../../../packages/shared/src/index";
import {
  formatTimestamp,
  normalizePlayerId,
  parseJsonColumn
} from "./column-helpers";

export type BattleSnapshotStatus = "active" | "resolved" | "compensated" | "aborted";

export interface BattleSnapshotCompensation {
  mailboxMessageId: string;
  playerIds: string[];
  title: string;
  body: string;
  kind: PlayerMailboxMessage["kind"];
  grant?: PlayerMailboxGrant;
}

export interface BattleSnapshotRecord {
  roomId: string;
  battleId: string;
  heroId: string;
  attackerPlayerId: string;
  defenderPlayerId?: string;
  defenderHeroId?: string;
  neutralArmyId?: string;
  encounterKind: "neutral" | "hero";
  initiator?: "hero" | "neutral";
  path: Vec2[];
  moveCost: number;
  playerIds: string[];
  initialState: BattleState;
  estimatedCompensationGrant?: PlayerMailboxGrant;
  status: BattleSnapshotStatus;
  result?: "attacker_victory" | "defender_victory";
  resolutionReason?: string;
  compensation?: BattleSnapshotCompensation;
  startedAt: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BattleSnapshotStartInput {
  roomId: string;
  battleId: string;
  heroId: string;
  attackerPlayerId: string;
  defenderPlayerId?: string;
  defenderHeroId?: string;
  neutralArmyId?: string;
  encounterKind: "neutral" | "hero";
  initiator?: "hero" | "neutral";
  path: Vec2[];
  moveCost: number;
  playerIds: string[];
  initialState: BattleState;
  estimatedCompensationGrant?: PlayerMailboxGrant;
  startedAt?: string;
}

export interface BattleSnapshotResolutionInput {
  roomId: string;
  battleId: string;
  result: "attacker_victory" | "defender_victory";
  resolutionReason?: string;
  resolvedAt?: string;
}

export interface BattleSnapshotInterruptedSettlementInput {
  roomId: string;
  battleId: string;
  status: Extract<BattleSnapshotStatus, "compensated" | "aborted">;
  resolutionReason: string;
  compensation?: BattleSnapshotCompensation;
  resolvedAt?: string;
}

export interface BattleSnapshotListOptions {
  statuses?: BattleSnapshotStatus[];
  limit?: number;
}

export interface BattleSnapshotRow extends RowDataPacket {
  room_id: string;
  battle_id: string;
  hero_id: string;
  attacker_player_id: string;
  defender_player_id: string | null;
  defender_hero_id: string | null;
  neutral_army_id: string | null;
  encounter_kind: "neutral" | "hero";
  initiator: "hero" | "neutral" | null;
  path_json: string | Vec2[];
  move_cost: number;
  player_ids_json: string | string[];
  initial_state_json: string | BattleState;
  estimated_compensation_grant_json: string | PlayerMailboxGrant | null;
  status: BattleSnapshotStatus;
  result: "attacker_victory" | "defender_victory" | null;
  resolution_reason: string | null;
  compensation_json: string | BattleSnapshotCompensation | null;
  started_at: Date | string;
  resolved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export function normalizeBattleSnapshotStatus(status: BattleSnapshotStatus): BattleSnapshotStatus {
  if (status !== "active" && status !== "resolved" && status !== "compensated" && status !== "aborted") {
    throw new Error("battle snapshot status is invalid");
  }

  return status;
}

export function normalizeBattleSnapshotPlayerIds(playerIds: string[]): string[] {
  const normalized = Array.from(new Set(playerIds.map((playerId) => normalizePlayerId(playerId))));
  if (normalized.length === 0) {
    throw new Error("battle snapshot must include at least one playerId");
  }

  return normalized;
}

export function toBattleSnapshotRecord(row: BattleSnapshotRow): BattleSnapshotRecord {
  const startedAt = formatTimestamp(row.started_at);
  const createdAt = formatTimestamp(row.created_at);
  const updatedAt = formatTimestamp(row.updated_at);
  if (!startedAt || !createdAt || !updatedAt) {
    throw new Error("battle snapshot timestamps must be present");
  }

  const resolvedAt = formatTimestamp(row.resolved_at);
  const compensation = row.compensation_json
    ? parseJsonColumn<BattleSnapshotCompensation>(row.compensation_json)
    : null;

  return {
    roomId: row.room_id,
    battleId: row.battle_id,
    heroId: row.hero_id,
    attackerPlayerId: normalizePlayerId(row.attacker_player_id),
    ...(row.defender_player_id ? { defenderPlayerId: normalizePlayerId(row.defender_player_id) } : {}),
    ...(row.defender_hero_id ? { defenderHeroId: row.defender_hero_id } : {}),
    ...(row.neutral_army_id ? { neutralArmyId: row.neutral_army_id } : {}),
    encounterKind: row.encounter_kind,
    ...(row.initiator ? { initiator: row.initiator } : {}),
    path: parseJsonColumn<Vec2[]>(row.path_json),
    moveCost: Math.max(0, Math.floor(row.move_cost)),
    playerIds: normalizeBattleSnapshotPlayerIds(parseJsonColumn<string[]>(row.player_ids_json)),
    initialState: parseJsonColumn<BattleState>(row.initial_state_json),
    ...(row.estimated_compensation_grant_json
      ? { estimatedCompensationGrant: parseJsonColumn<PlayerMailboxGrant>(row.estimated_compensation_grant_json) }
      : {}),
    status: normalizeBattleSnapshotStatus(row.status),
    ...(row.result ? { result: row.result } : {}),
    ...(row.resolution_reason ? { resolutionReason: row.resolution_reason } : {}),
    ...(compensation ? { compensation } : {}),
    startedAt,
    ...(resolvedAt ? { resolvedAt } : {}),
    createdAt,
    updatedAt
  };
}
