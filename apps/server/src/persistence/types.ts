import type {
  BattleState,
  PlayerMailboxGrant,
  PlayerMailboxMessage,
  Vec2
} from "../../../../packages/shared/src/index";

export interface SeasonSnapshot {
  seasonId: string;
  status: "active" | "closed";
  startedAt: string;
  endedAt?: string;
  rewardDistributedAt?: string;
}

export interface SeasonListOptions {
  status?: "active" | "closed" | "all";
  limit?: number;
}

export interface SeasonCloseSummary {
  seasonId: string;
  playersRewarded: number;
  totalGemsGranted: number;
}

export interface LeaderboardSeasonArchiveEntry {
  seasonId: string;
  rank: number;
  playerId: string;
  displayName: string;
  finalRating: number;
  tier: string;
  archivedAt: string;
}

export interface PlayerReferralClaimResult {
  claimed: boolean;
  rewardGems: number;
  referrerId: string;
  newPlayerId: string;
}

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

export interface SnapshotRetentionPolicy {
  ttlHours: number | null;
  cleanupIntervalMinutes: number | null;
}

export interface PlayerNameHistoryRetentionPolicy {
  ttlDays: number | null;
  cleanupIntervalMinutes: number | null;
  cleanupBatchSize: number;
}
