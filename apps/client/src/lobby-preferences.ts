import { resolveRuntimeServerHttpUrl } from "./runtime-targets";

const LOBBY_PREFERENCES_STORAGE_KEY = "project-veil:lobby-preferences";
const DEFAULT_LOBBY_ROOM_ID = "room-alpha";
const LOBBY_REQUEST_TIMEOUT_MS = 1200;

export interface LobbyPreferences {
  playerId: string;
  roomId: string;
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

interface LobbyRoomsApiPayload {
  items?: LobbyRoomSummary[];
}

function getLobbyStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveLobbyApiBaseUrl(): string {
  return resolveRuntimeServerHttpUrl();
}

function normalizePlayerId(value?: string | null): string {
  return value?.trim() ?? "";
}

function normalizeRoomId(value?: string | null): string {
  return value?.trim() ?? "";
}

function readStoredLobbyPreferencesUnsafe(storage: Pick<Storage, "getItem">): Partial<LobbyPreferences> | null {
  const raw = storage.getItem(LOBBY_PREFERENCES_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { playerId?: unknown; roomId?: unknown };
    return {
      ...(typeof parsed.playerId === "string" ? { playerId: parsed.playerId } : {}),
      ...(typeof parsed.roomId === "string" ? { roomId: parsed.roomId } : {})
    };
  } catch {
    return null;
  }
}

export function getLobbyPreferencesStorageKey(): string {
  return LOBBY_PREFERENCES_STORAGE_KEY;
}

export function createGuestPlayerId(randomValue = Math.random()): string {
  return `guest-${Math.floor(Math.max(0, Math.min(0.999999, randomValue)) * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
}

export function createLobbyPreferences(
  overrides: Partial<LobbyPreferences> = {},
  randomValue?: number
): LobbyPreferences {
  const storage = getLobbyStorage();
  const stored = storage ? readStoredLobbyPreferencesUnsafe(storage) : null;
  const playerId =
    normalizePlayerId(overrides.playerId) || normalizePlayerId(stored?.playerId) || createGuestPlayerId(randomValue);
  const roomId = normalizeRoomId(overrides.roomId) || normalizeRoomId(stored?.roomId) || DEFAULT_LOBBY_ROOM_ID;
  return { playerId, roomId };
}

export function saveLobbyPreferences(playerId: string, roomId: string, randomValue?: number): LobbyPreferences {
  const nextPreferences = createLobbyPreferences({ playerId, roomId }, randomValue);
  const storage = getLobbyStorage();
  if (storage) {
    storage.setItem(LOBBY_PREFERENCES_STORAGE_KEY, JSON.stringify(nextPreferences));
  }
  return nextPreferences;
}

export async function loadLobbyRooms(limit = 12): Promise<LobbyRoomSummary[]> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LOBBY_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${resolveLobbyApiBaseUrl()}/api/lobby/rooms?limit=${encodeURIComponent(String(limit))}`,
      {
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`lobby_request_failed:${response.status}`);
    }

    const payload = (await response.json()) as LobbyRoomsApiPayload;
    return Array.isArray(payload.items) ? payload.items : [];
  } finally {
    window.clearTimeout(timeout);
  }
}
