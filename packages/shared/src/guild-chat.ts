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
