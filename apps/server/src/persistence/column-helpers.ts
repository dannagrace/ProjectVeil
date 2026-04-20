export function normalizePlayerId(playerId: string): string {
  const normalized = playerId.trim();
  if (normalized.length === 0) {
    throw new Error("playerId must not be empty");
  }

  return normalized;
}

export function formatTimestamp(value: Date | string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString();
}

export function parseJsonColumn<T>(value: string | T): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value;
}
