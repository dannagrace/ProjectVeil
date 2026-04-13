import {
  findDisplayNameModerationViolation,
  type DisplayNameModerationViolation,
  type DisplayNameValidationRules
} from "./display-name-validation";

const DEFAULT_GUILD_CHAT_MAX_MESSAGE_LENGTH = 500;

export const GUILD_CHAT_MAX_MESSAGE_LENGTH = DEFAULT_GUILD_CHAT_MAX_MESSAGE_LENGTH;

export interface GuildChatMessage {
  messageId: string;
  guildId: string;
  authorPlayerId: string;
  authorDisplayName: string;
  content: string;
  createdAt: string;
  expiresAt: string;
}

export interface GuildChatSendAction {
  content: string;
}

export interface GuildChatHistoryPage {
  items: GuildChatMessage[];
  nextCursor?: string;
}

const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/;

export class GuildChatContentViolationError extends Error {
  readonly violation: DisplayNameModerationViolation;

  constructor(content: string, violation: DisplayNameModerationViolation) {
    super(buildGuildChatContentViolationMessage(content, violation));
    this.name = "guild_chat_content_violation";
    this.violation = violation;
  }
}

export function normalizeGuildChatMessageContent(content: string, maxLength = GUILD_CHAT_MAX_MESSAGE_LENGTH): string {
  const normalized = content.trim();
  if (!normalized) {
    throw new Error("guild_chat_message_required");
  }

  if (Array.from(normalized).length > maxLength) {
    throw new Error(`guild_chat_message_too_long: max ${maxLength} characters`);
  }

  if (HTML_TAG_PATTERN.test(normalized)) {
    throw new Error("guild_chat_message_html_not_allowed");
  }

  return normalized;
}

export function findGuildChatContentModerationViolation(
  content: string,
  rules?: DisplayNameValidationRules
): DisplayNameModerationViolation | null {
  const violation = findDisplayNameModerationViolation(content, rules);
  if (!violation || violation.reason === "game_rule") {
    return null;
  }

  return violation;
}

export function validateGuildChatMessageContentOrThrow(
  content: string,
  rules?: DisplayNameValidationRules,
  maxLength = GUILD_CHAT_MAX_MESSAGE_LENGTH
): string {
  const normalized = normalizeGuildChatMessageContent(content, maxLength);
  const violation = findGuildChatContentModerationViolation(normalized, rules);
  if (violation) {
    throw new GuildChatContentViolationError(normalized, violation);
  }

  return normalized;
}

function buildGuildChatContentViolationMessage(
  content: string,
  violation: DisplayNameModerationViolation
): string {
  if (violation.reason === "reserved") {
    return `Guild chat message "${content}" contains a reserved term`;
  }

  if (violation.reason === "profanity") {
    return `Guild chat message "${content}" contains banned content`;
  }

  return `Guild chat message "${content}" violates current moderation rules`;
}
