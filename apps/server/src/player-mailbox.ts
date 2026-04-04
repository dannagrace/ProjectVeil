import {
  getEquipmentDefinition,
  resolveCosmeticCatalog,
  summarizePlayerMailbox,
  isPlayerMailboxMessageExpired,
  type CosmeticId,
  type EquipmentId,
  type EventLogEntry,
  type PlayerMailboxGrant,
  type PlayerMailboxMessage,
  type PlayerMailboxSummary,
  type ResourceLedger
} from "../../../packages/shared/src/index";

export interface NormalizedMailboxGrant {
  gems: number;
  resources: ResourceLedger;
  equipmentIds: EquipmentId[];
  cosmeticIds: CosmeticId[];
  seasonPassPremium: boolean;
}

export interface PlayerMailboxDeliveryInput {
  playerIds: string[];
  message: Partial<PlayerMailboxMessage> & Pick<PlayerMailboxMessage, "id" | "title" | "body">;
}

export interface PlayerMailboxDeliveryResult {
  deliveredPlayerIds: string[];
  skippedPlayerIds: string[];
  message: PlayerMailboxMessage;
}

export interface PlayerMailboxClaimResult {
  claimed: boolean;
  reason?: "not_found" | "already_claimed" | "expired" | "no_grant";
  message?: PlayerMailboxMessage;
  mailbox: PlayerMailboxMessage[];
  summary: PlayerMailboxSummary;
  granted?: NormalizedMailboxGrant;
}

export interface PlayerMailboxClaimAllResult {
  claimed: boolean;
  claimedMessageIds: string[];
  mailbox: PlayerMailboxMessage[];
  summary: PlayerMailboxSummary;
  granted: NormalizedMailboxGrant[];
}

function normalizeTimestamp(value: string | null | undefined, field: string, required = false): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    if (required) {
      throw new Error(`${field} is required`);
    }
    return undefined;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }

  return parsed.toISOString();
}

function normalizeMailboxText(value: string | null | undefined, field: string, maxLength: number): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} must not be empty`);
  }

  return normalized.slice(0, maxLength);
}

export function normalizePlayerMailboxGrant(grant?: PlayerMailboxGrant | null): NormalizedMailboxGrant {
  const equipmentIds = Array.from(
    new Set(
      (grant?.equipmentIds ?? [])
        .map((equipmentId) => equipmentId?.trim())
        .filter((equipmentId): equipmentId is EquipmentId => Boolean(equipmentId))
    )
  );
  for (const equipmentId of equipmentIds) {
    if (!getEquipmentDefinition(equipmentId)) {
      throw new Error(`unknown mailbox equipment grant: ${equipmentId}`);
    }
  }

  const cosmeticCatalogIds = new Set(resolveCosmeticCatalog().map((entry) => entry.id));
  const cosmeticIds = Array.from(
    new Set(
      (grant?.cosmeticIds ?? [])
        .map((cosmeticId) => cosmeticId?.trim())
        .filter((cosmeticId): cosmeticId is CosmeticId => Boolean(cosmeticId))
    )
  );
  for (const cosmeticId of cosmeticIds) {
    if (!cosmeticCatalogIds.has(cosmeticId)) {
      throw new Error(`unknown mailbox cosmetic grant: ${cosmeticId}`);
    }
  }

  return {
    gems: Math.max(0, Math.floor(grant?.gems ?? 0)),
    resources: {
      gold: Math.max(0, Math.floor(grant?.resources?.gold ?? 0)),
      wood: Math.max(0, Math.floor(grant?.resources?.wood ?? 0)),
      ore: Math.max(0, Math.floor(grant?.resources?.ore ?? 0))
    },
    equipmentIds,
    cosmeticIds,
    seasonPassPremium: grant?.seasonPassPremium === true
  };
}

export function hasMailboxGrant(grant?: PlayerMailboxGrant | null): boolean {
  const normalized = normalizePlayerMailboxGrant(grant);
  return (
    normalized.gems > 0 ||
    normalized.resources.gold > 0 ||
    normalized.resources.wood > 0 ||
    normalized.resources.ore > 0 ||
    normalized.equipmentIds.length > 0 ||
    normalized.cosmeticIds.length > 0 ||
    normalized.seasonPassPremium
  );
}

export function normalizePlayerMailboxMessage(
  message: Partial<PlayerMailboxMessage> & Pick<PlayerMailboxMessage, "id" | "title" | "body">,
  now = new Date()
): PlayerMailboxMessage {
  const sentAt = normalizeTimestamp(message.sentAt, "message.sentAt") ?? now.toISOString();
  const normalizedGrant = hasMailboxGrant(message.grant) ? normalizePlayerMailboxGrant(message.grant) : null;

  return {
    id: normalizeMailboxText(message.id, "message.id", 191),
    kind: message.kind === "compensation" || message.kind === "announcement" ? message.kind : "system",
    title: normalizeMailboxText(message.title, "message.title", 120),
    body: normalizeMailboxText(message.body, "message.body", 4000),
    sentAt,
    ...(normalizeTimestamp(message.expiresAt, "message.expiresAt") ? { expiresAt: normalizeTimestamp(message.expiresAt, "message.expiresAt")! } : {}),
    ...(normalizeTimestamp(message.readAt, "message.readAt") ? { readAt: normalizeTimestamp(message.readAt, "message.readAt")! } : {}),
    ...(normalizeTimestamp(message.claimedAt, "message.claimedAt") ? { claimedAt: normalizeTimestamp(message.claimedAt, "message.claimedAt")! } : {}),
    ...(normalizedGrant
      ? {
          grant: {
            ...(normalizedGrant.gems > 0 ? { gems: normalizedGrant.gems } : {}),
            ...(normalizedGrant.resources.gold > 0 || normalizedGrant.resources.wood > 0 || normalizedGrant.resources.ore > 0
              ? { resources: normalizedGrant.resources }
              : {}),
            ...(normalizedGrant.equipmentIds.length > 0 ? { equipmentIds: normalizedGrant.equipmentIds } : {}),
            ...(normalizedGrant.cosmeticIds.length > 0 ? { cosmeticIds: normalizedGrant.cosmeticIds } : {}),
            ...(normalizedGrant.seasonPassPremium ? { seasonPassPremium: true } : {})
          }
        }
      : {})
  };
}

export function sortMailboxMessages(mailbox?: PlayerMailboxMessage[] | null): PlayerMailboxMessage[] {
  return [...(mailbox ?? [])].sort((left, right) => right.sentAt.localeCompare(left.sentAt) || left.id.localeCompare(right.id));
}

export function deliverPlayerMailboxMessage(
  mailbox: PlayerMailboxMessage[] | null | undefined,
  message: PlayerMailboxMessage
): { delivered: boolean; mailbox: PlayerMailboxMessage[] } {
  const normalizedMailbox = sortMailboxMessages(mailbox);
  if (normalizedMailbox.some((entry) => entry.id === message.id)) {
    return {
      delivered: false,
      mailbox: normalizedMailbox
    };
  }

  return {
    delivered: true,
    mailbox: sortMailboxMessages([...normalizedMailbox, message])
  };
}

export function claimPlayerMailboxMessage(
  mailbox: PlayerMailboxMessage[] | null | undefined,
  messageId: string,
  now = new Date()
): PlayerMailboxClaimResult {
  const normalizedMailbox = sortMailboxMessages(mailbox);
  const normalizedMessageId = normalizeMailboxText(messageId, "messageId", 191);
  const message = normalizedMailbox.find((entry) => entry.id === normalizedMessageId);
  if (!message) {
    return {
      claimed: false,
      reason: "not_found",
      mailbox: normalizedMailbox,
      summary: summarizePlayerMailbox(normalizedMailbox, now)
    };
  }

  if (message.claimedAt) {
    return {
      claimed: false,
      reason: "already_claimed",
      message,
      mailbox: normalizedMailbox,
      summary: summarizePlayerMailbox(normalizedMailbox, now)
    };
  }

  if (isPlayerMailboxMessageExpired(message, now)) {
    return {
      claimed: false,
      reason: "expired",
      message,
      mailbox: normalizedMailbox,
      summary: summarizePlayerMailbox(normalizedMailbox, now)
    };
  }

  if (!hasMailboxGrant(message.grant)) {
    return {
      claimed: false,
      reason: "no_grant",
      message,
      mailbox: normalizedMailbox,
      summary: summarizePlayerMailbox(normalizedMailbox, now)
    };
  }

  const claimedAt = now.toISOString();
  const granted = normalizePlayerMailboxGrant(message.grant);
  const nextMailbox = normalizedMailbox.map((entry) =>
    entry.id === normalizedMessageId
      ? {
          ...entry,
          ...(entry.readAt ? {} : { readAt: claimedAt }),
          claimedAt
        }
      : entry
  );
  const nextMessage = nextMailbox.find((entry) => entry.id === normalizedMessageId);
  if (!nextMessage) {
    throw new Error("mailbox_claim_state_corrupted");
  }

  return {
    claimed: true,
    message: nextMessage,
    mailbox: nextMailbox,
    summary: summarizePlayerMailbox(nextMailbox, now),
    granted
  };
}

export function claimAllPlayerMailboxMessages(
  mailbox: PlayerMailboxMessage[] | null | undefined,
  now = new Date()
): PlayerMailboxClaimAllResult {
  let nextMailbox = sortMailboxMessages(mailbox);
  const claimedMessageIds: string[] = [];
  const granted: NormalizedMailboxGrant[] = [];

  for (const entry of nextMailbox) {
    const result = claimPlayerMailboxMessage(nextMailbox, entry.id, now);
    if (!result.claimed || !result.message || !result.granted) {
      continue;
    }
    nextMailbox = result.mailbox;
    claimedMessageIds.push(result.message.id);
    granted.push(result.granted);
  }

  return {
    claimed: claimedMessageIds.length > 0,
    claimedMessageIds,
    mailbox: nextMailbox,
    summary: summarizePlayerMailbox(nextMailbox, now),
    granted
  };
}

export function pruneExpiredPlayerMailboxMessages(
  mailbox: PlayerMailboxMessage[] | null | undefined,
  referenceTime = new Date()
): { mailbox: PlayerMailboxMessage[]; removedCount: number } {
  const nextMailbox = sortMailboxMessages(mailbox).filter((entry) => !isPlayerMailboxMessageExpired(entry, referenceTime));
  return {
    mailbox: nextMailbox,
    removedCount: Math.max(0, (mailbox?.length ?? 0) - nextMailbox.length)
  };
}

export function createMailboxClaimEventLogEntry(
  playerId: string,
  message: Pick<PlayerMailboxMessage, "id" | "title">,
  granted: NormalizedMailboxGrant,
  processedAt: string
): EventLogEntry {
  const rewards = [
    granted.gems > 0 ? { type: "resource" as const, label: "gems", amount: granted.gems } : null,
    granted.resources.gold > 0 ? { type: "resource" as const, label: "gold", amount: granted.resources.gold } : null,
    granted.resources.wood > 0 ? { type: "resource" as const, label: "wood", amount: granted.resources.wood } : null,
    granted.resources.ore > 0 ? { type: "resource" as const, label: "ore", amount: granted.resources.ore } : null,
    ...granted.equipmentIds.map((equipmentId) => ({ type: "badge" as const, label: equipmentId })),
    ...granted.cosmeticIds.map((cosmeticId) => ({ type: "badge" as const, label: cosmeticId }))
  ].filter((reward): reward is NonNullable<typeof reward> => Boolean(reward));

  return {
    id: `${playerId}:${processedAt}:mailbox:${message.id}`,
    timestamp: processedAt,
    roomId: "mailbox",
    playerId,
    category: "account",
    description: `Claimed mailbox reward: ${message.title}.`,
    rewards
  };
}
