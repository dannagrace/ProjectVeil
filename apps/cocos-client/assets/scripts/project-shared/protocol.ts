import type {
  BattleAction,
  BattleState,
  CosmeticId,
  EquippedCosmetics,
  FriendLeaderboardEntry,
  GroupChallenge,
  MovementPlan,
  Vec2,
  WorldAction,
  WorldEvent
} from "./models.ts";
import type { ActionValidationFailure } from "./action-precheck.ts";
import type { FeatureFlags } from "./feature-flags.ts";
import type { GuildRosterView, GuildSummaryView } from "./guilds.ts";
import type { PlayerWorldViewPayload } from "./map-sync.ts";
import type { RuntimeConfigBundle } from "./world-config.ts";

export type SessionStateReason = "surrender" | "afk_forfeit" | "normal" | (string & {});

export interface TutorialProgressAction {
  step: number | null;
  reason?: "advance" | "skip" | "complete";
}

export interface CampaignDialogueAckAction {
  missionId: string;
  sequence: "intro" | "outro";
  dialogueLineId: string;
}

export interface EventProgressUpdatePayload {
  eventId: string;
  points: number;
  delta: number;
  objectiveId: string;
}

export interface SessionStatePayload {
  world: PlayerWorldViewPayload;
  battle: BattleState | null;
  events: WorldEvent[];
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
  featureFlags: FeatureFlags;
  reason?: SessionStateReason;
  rejection?: ActionValidationFailure;
}

export type PlayerReportReason = "cheating" | "harassment" | "afk";
export type PlayerReportStatus = "pending" | "dismissed" | "warned" | "banned";

export interface GuildCreateAction {
  name: string;
  tag: string;
  description?: string;
  memberLimit?: number;
}

export interface GuildJoinAction {
  guildId: string;
}

export interface GuildLeaveAction {
  guildId: string;
}

export interface GuildGetAction {
  guildId: string;
}

export type ClientMessage =
  | {
      type: "connect";
      requestId: string;
      roomId: string;
      playerId: string;
      clientVersion?: string;
      clientChannel?: string;
      displayName?: string;
      authToken?: string;
      seed?: number;
    }
  | {
      type: "TOKEN_REFRESH";
      requestId: string;
      authToken: string;
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
      type: "SHARE_ACTIVITY";
      requestId: string;
      activity: "battle_victory" | "group_challenge";
      roomId?: string;
      challengeToken?: string;
    }
  | {
      type: "FRIEND_LEADERBOARD_REQUEST";
      requestId: string;
      friendIds?: string[];
    }
  | {
      type: "campaign.dialogue.ack";
      requestId: string;
      action: CampaignDialogueAckAction;
    }
  | {
      type: "guild.create";
      requestId: string;
      action: GuildCreateAction;
    }
  | {
      type: "guild.join";
      requestId: string;
      action: GuildJoinAction;
    }
  | {
      type: "guild.leave";
      requestId: string;
      action: GuildLeaveAction;
    }
  | {
      type: "guild.list";
      requestId: string;
    }
  | {
      type: "guild.get";
      requestId: string;
      action: GuildGetAction;
    }
  | {
      type: "guild.roster";
      requestId: string;
      action: GuildGetAction;
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
      minorProtection?: {
        enforced: boolean;
        localDate: string;
        normalizedDailyPlayMinutes: number;
        dailyLimitMinutes: number;
        restrictedHours: boolean;
        dailyLimitReached: boolean;
        wouldBlock: boolean;
        reason: "minor_restricted_hours" | "minor_daily_limit_reached" | null;
        currentServerTime: string;
        currentLocalTime: string;
        timeZone: string;
        restrictedWindow: {
          startHour: number;
          endHour: number;
        };
        remainingDailyMinutes: number;
        nextAllowedAt: string | null;
        nextAllowedLocalTime: string | null;
        nextAllowedCountdownSeconds: number | null;
      };
    }
  | {
      type: "SESSION_EXPIRED";
      requestId: string;
      delivery: "push";
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
      type: "config.update";
      requestId: "push";
      delivery: "push";
      payload: { bundle: RuntimeConfigBundle };
    }
  | {
      type: "event.progress.update";
      requestId: "push";
      delivery: "push";
      payload: EventProgressUpdatePayload;
    }
  | {
      type: "guild.list";
      requestId: string;
      items: GuildSummaryView[];
    }
  | {
      type: "guild.get";
      requestId: string;
      guild: GuildSummaryView;
    }
  | {
      type: "guild.roster";
      requestId: string;
      roster: GuildRosterView;
    }
  | {
      type: "FRIEND_LEADERBOARD_REQUEST";
      requestId: string;
      items: FriendLeaderboardEntry[];
      friendCount: number;
    }
  | {
      type: "SHARE_ACTIVITY";
      requestId: string;
      activity: "battle_victory" | "group_challenge";
      roomId: string;
      shareUrl: string;
      shareMessage: string;
      challenge?: GroupChallenge;
      challengeToken?: string;
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
