import { sys } from "cc";

export interface Vec2 {
  x: number;
  y: number;
}

export interface ResourceLedger {
  gold: number;
  wood: number;
  ore: number;
}

export type FogState = "hidden" | "explored" | "visible";
export type TerrainType = "grass" | "dirt" | "sand" | "water" | "unknown";
export type OccupantKind = "hero" | "neutral" | "building";
export type BuildingKind = "recruitment_post" | "attribute_shrine" | "resource_mine";

export interface HeroProgression {
  level: number;
  experience: number;
  skillPoints: number;
  battlesWon: number;
  neutralBattlesWon: number;
  pvpBattlesWon: number;
}

export interface HeroLearnedSkillState {
  skillId: string;
  rank: number;
}

export interface HeroStats {
  attack: number;
  defense: number;
  power: number;
  knowledge: number;
  hp: number;
  maxHp: number;
}

export interface HeroBattleSkillState {
  skillId: string;
  rank: number;
}

export interface HeroEquipmentState {
  weaponId?: string;
  armorId?: string;
  accessoryId?: string;
  trinketIds: string[];
}

export interface HeroLoadout {
  learnedSkills: HeroBattleSkillState[];
  equipment: HeroEquipmentState;
}

export type HeroStatBonus = Pick<HeroStats, "attack" | "defense" | "power" | "knowledge">;

export interface HeroView {
  id: string;
  playerId: string;
  name: string;
  position: Vec2;
  vision: number;
  move: {
    total: number;
    remaining: number;
  };
  stats: HeroStats;
  progression: HeroProgression;
  loadout: HeroLoadout;
  armyCount: number;
  armyTemplateId: string;
  learnedSkills: HeroLearnedSkillState[];
}

export interface PlayerWorldView {
  meta: {
    roomId: string;
    seed: number;
    day: number;
  };
  map: {
    width: number;
    height: number;
    tiles: PlayerTileView[];
  };
  ownHeroes: HeroView[];
  visibleHeroes: Array<{
    id: string;
    playerId: string;
    name: string;
    position: Vec2;
  }>;
  resources: ResourceLedger;
  playerId: string;
}

interface EncodedPlayerMapOverlay {
  index: number;
  resource?: ResourceNode;
  occupant?: OccupantState;
  building?: PlayerBuildingView;
}

interface EncodedPlayerMapTiles {
  format: "typed-array-v1";
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  terrain: string;
  fog: string;
  walkable: string;
  overlays: EncodedPlayerMapOverlay[];
}

interface PlayerWorldViewPayload extends Omit<PlayerWorldView, "map"> {
  map: {
    width: number;
    height: number;
    tiles?: PlayerTileView[];
    encodedTiles?: EncodedPlayerMapTiles;
  };
}

export interface OccupantState {
  kind: OccupantKind;
  refId: string;
}

export interface RecruitmentBuildingView {
  id: string;
  kind: "recruitment_post";
  label: string;
  unitTemplateId: string;
  recruitCount: number;
  availableCount: number;
  cost: ResourceLedger;
}

export interface AttributeShrineBuildingView {
  id: string;
  kind: "attribute_shrine";
  label: string;
  bonus: HeroStatBonus;
  lastUsedDay?: number;
}

export interface ResourceMineBuildingView {
  id: string;
  kind: "resource_mine";
  label: string;
  resourceKind: keyof ResourceLedger;
  income: number;
  lastHarvestDay?: number;
}

export type PlayerBuildingView =
  | RecruitmentBuildingView
  | AttributeShrineBuildingView
  | ResourceMineBuildingView;

export interface UnitStack {
  id: string;
  templateId: string;
  camp: "attacker" | "defender";
  lane: number;
  stackName: string;
  initiative: number;
  attack: number;
  defense: number;
  minDamage: number;
  maxDamage: number;
  count: number;
  currentHp: number;
  maxHp: number;
  hasRetaliated: boolean;
  defending: boolean;
  skills?: BattleSkillState[];
  statusEffects?: BattleStatusEffectState[];
}

export type BattleSkillId = string;

export interface BattleSkillState {
  id: BattleSkillId;
  name: string;
  description: string;
  kind: "active" | "passive";
  target: "enemy" | "self";
  delivery?: "contact" | "ranged";
  cooldown: number;
  remainingCooldown: number;
}

export interface BattleStatusEffectState {
  id: string;
  name: string;
  description: string;
  durationRemaining: number;
  attackModifier: number;
  defenseModifier: number;
  damagePerTurn: number;
  initiativeModifier: number;
  blocksActiveSkills: boolean;
  sourceUnitId?: string;
}

export interface DeterministicRngState {
  seed: number;
  cursor: number;
}

export interface BattleBlockerState {
  id: string;
  kind: "blocker";
  lane: number;
  name: string;
  description: string;
  durability: number;
  maxDurability: number;
}

export interface BattleTrapState {
  id: string;
  kind: "trap";
  lane: number;
  effect: "damage" | "slow" | "silence";
  name: string;
  description: string;
  damage: number;
  charges: number;
  revealed: boolean;
  triggered: boolean;
  grantedStatusId?: string;
  triggeredByCamp?: "attacker" | "defender" | "both";
}

export type BattleHazardState = BattleBlockerState | BattleTrapState;

export interface ResourceNode {
  kind: keyof ResourceLedger;
  amount: number;
}

export type NeutralMoveReason = "patrol" | "return" | "chase";

export interface PlayerTileView {
  position: Vec2;
  fog: FogState;
  terrain: TerrainType;
  walkable: boolean;
  resource: ResourceNode | undefined;
  occupant: OccupantState | undefined;
  building: PlayerBuildingView | undefined;
}

export interface BattleState {
  id: string;
  round: number;
  lanes: number;
  activeUnitId: string | null;
  turnOrder: string[];
  units: Record<string, UnitStack>;
  environment: BattleHazardState[];
  log: string[];
  rng: DeterministicRngState;
  worldHeroId?: string;
  neutralArmyId?: string;
  defenderHeroId?: string;
  encounterPosition?: Vec2;
}

export interface MovementPlan {
  heroId: string;
  destination: Vec2;
  path: Vec2[];
  travelPath: Vec2[];
  moveCost: number;
  endsInEncounter: boolean;
  encounterKind: "none" | "neutral" | "hero";
  encounterRefId?: string;
}

export type WorldEvent =
  | {
      type: "hero.moved";
      heroId: string;
      path: Vec2[];
      moveCost: number;
    }
  | {
      type: "hero.collected";
      heroId: string;
      resource: ResourceNode;
    }
  | {
      type: "hero.recruited";
      heroId: string;
      buildingId: string;
      buildingKind: BuildingKind;
      unitTemplateId: string;
      count: number;
      cost: ResourceLedger;
    }
  | {
      type: "hero.visited";
      heroId: string;
      buildingId: string;
      buildingKind: "attribute_shrine";
      bonus: HeroStatBonus;
    }
  | {
      type: "hero.claimedMine";
      heroId: string;
      buildingId: string;
      buildingKind: "resource_mine";
      resourceKind: keyof ResourceLedger;
      income: number;
      ownerPlayerId: string;
    }
  | {
      type: "resource.produced";
      playerId: string;
      buildingId: string;
      buildingKind: "resource_mine";
      resource: ResourceNode;
    }
  | {
      type: "neutral.moved";
      neutralArmyId: string;
      from: Vec2;
      to: Vec2;
      reason: NeutralMoveReason;
      targetHeroId?: string;
    }
  | {
      type: "hero.progressed";
      heroId: string;
      battleId: string;
      battleKind: "neutral" | "hero";
      experienceGained: number;
      totalExperience: number;
      level: number;
      levelsGained: number;
      skillPointsAwarded: number;
      availableSkillPoints: number;
    }
  | {
      type: "hero.skillLearned";
      heroId: string;
      skillId: string;
      branchId: string;
      skillName: string;
      branchName: string;
      newRank: number;
      spentPoint: number;
      remainingSkillPoints: number;
      newlyGrantedBattleSkillIds: BattleSkillId[];
    }
  | {
      type: "battle.started";
      heroId: string;
      encounterKind: "neutral" | "hero";
      neutralArmyId?: string;
      defenderHeroId?: string;
      initiator?: "hero" | "neutral";
      battleId: string;
      path: Vec2[];
      moveCost: number;
    }
  | {
      type: "turn.advanced";
      day: number;
    }
  | {
      type: "battle.resolved";
      heroId: string;
      defenderHeroId?: string;
      battleId: string;
      result: "attacker_victory" | "defender_victory";
    };

export interface SessionUpdate {
  world: PlayerWorldView;
  battle: BattleState | null;
  events: WorldEvent[];
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
  reason?: string;
}

export type ConnectionEvent = "reconnecting" | "reconnected" | "reconnect_failed";

export interface VeilCocosSessionOptions {
  remoteUrl?: string;
  onPushUpdate?: (update: SessionUpdate) => void;
  onConnectionEvent?: (event: ConnectionEvent) => void;
  getDisplayName?: () => string | null;
  getAuthToken?: () => string | null;
}

interface ColyseusCloseCodes {
  CONSENTED: number;
  FAILED_TO_RECONNECT: number;
  MAY_TRY_RECONNECT: number;
}

interface ColyseusRoomLike {
  reconnectionToken?: string;
  onMessage(type: string, callback: (type: string, payload: unknown) => void): void;
  onDrop(callback: () => void): void;
  onReconnect(callback: () => void): void;
  onLeave(callback: (code: number) => void): void;
  leave(): Promise<unknown>;
  send(type: string, payload: unknown): void;
}

interface ColyseusClientLike {
  reconnect(reconnectionToken: string): Promise<ColyseusRoomLike>;
  joinOrCreate(roomName: string, options: {
    logicalRoomId: string;
    playerId: string;
    seed: number;
  }): Promise<ColyseusRoomLike>;
}

interface ColyseusSdkRuntime {
  Client: new (endpoint: string) => ColyseusClientLike;
  CloseCode: ColyseusCloseCodes;
}

type WorldAction =
  | {
      type: "hero.move";
      heroId: string;
      destination: Vec2;
    }
  | {
      type: "hero.collect";
      heroId: string;
      position: Vec2;
    }
  | {
      type: "hero.recruit";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.visit";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.claimMine";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.learnSkill";
      heroId: string;
      skillId: string;
    }
  | {
      type: "turn.endDay";
    };

export type BattleAction =
  | {
      type: "battle.attack";
      attackerId: string;
      defenderId: string;
    }
  | {
      type: "battle.wait";
      unitId: string;
    }
  | {
      type: "battle.defend";
      unitId: string;
    }
  | {
      type: "battle.skill";
      unitId: string;
      skillId: BattleSkillId;
      targetId?: string;
    };

type ClientMessage =
  | {
      type: "connect";
      requestId: string;
      roomId: string;
      playerId: string;
      displayName?: string;
      authToken?: string;
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
      type: "world.reachable";
      requestId: string;
      heroId: string;
    };

interface SessionStatePayload {
  world: PlayerWorldViewPayload;
  battle: BattleState | null;
  events: WorldEvent[];
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
  reason?: string;
}

type ServerMessage =
  | {
      type: "session.state";
      requestId: string;
      delivery?: "reply" | "push";
      payload: SessionStatePayload;
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
    };

const RECONNECTION_TOKEN_PREFIX = "project-veil:cocos:reconnection";
const SESSION_REPLAY_PREFIX = "project-veil:cocos:session-replay";
const SESSION_REPLAY_VERSION = 1;
const REMOTE_CONNECT_TIMEOUT_MS = 1500;
const REMOTE_RECOVERY_RETRY_MS = 1500;
const REMOTE_REQUEST_TIMEOUT_MS = 3000;
let cachedColyseusSdkPromise: Promise<ColyseusSdkRuntime> | null = null;

interface StoredSessionReplayEnvelope {
  version: number;
  storedAt: number;
  update: SessionUpdate;
}

const TERRAIN_VALUES: TerrainType[] = ["grass", "dirt", "sand", "water", "unknown"];
const FOG_VALUES: FogState[] = ["hidden", "explored", "visible"];

function decodeBase64Bytes(encoded: string): Uint8Array {
  if ("Buffer" in globalThis && typeof globalThis.Buffer !== "undefined") {
    return new Uint8Array(globalThis.Buffer.from(encoded, "base64"));
  }

  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function tileIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

function decodePlayerWorldView(payload: PlayerWorldViewPayload, baseView?: PlayerWorldView | null): PlayerWorldView {
  if (Array.isArray(payload.map.tiles)) {
    return payload as PlayerWorldView;
  }

  const encoded = payload.map.encodedTiles;
  if (!encoded || encoded.format !== "typed-array-v1") {
    throw new Error("unsupported_player_world_view_encoding");
  }

  const terrain = decodeBase64Bytes(encoded.terrain);
  const fog = decodeBase64Bytes(encoded.fog);
  const walkable = decodeBase64Bytes(encoded.walkable);
  const bounds = encoded.bounds ?? {
    x: 0,
    y: 0,
    width: payload.map.width,
    height: payload.map.height
  };
  const tileCount = bounds.width * bounds.height;

  if (terrain.length !== tileCount || fog.length !== tileCount || walkable.length !== tileCount) {
    throw new Error("invalid_player_world_view_encoding_length");
  }

  const overlaysByIndex = new Map(encoded.overlays.map((overlay) => [overlay.index, overlay] as const));
  const isFullMap =
    bounds.x === 0 && bounds.y === 0 && bounds.width === payload.map.width && bounds.height === payload.map.height;
  const tiles: PlayerTileView[] = isFullMap
    ? Array.from({ length: tileCount }, (_, index) => {
        const overlay = overlaysByIndex.get(index);
        return {
          position: {
            x: bounds.x + (index % bounds.width),
            y: bounds.y + Math.floor(index / bounds.width)
          },
          fog: FOG_VALUES[fog[index]!] ?? "hidden",
          terrain: TERRAIN_VALUES[terrain[index]!] ?? "unknown",
          walkable: walkable[index] === 1,
          resource: overlay?.resource,
          occupant: overlay?.occupant,
          building: overlay?.building
        };
      })
    : (() => {
        if (!baseView || baseView.map.width !== payload.map.width || baseView.map.height !== payload.map.height) {
          throw new Error("missing_player_world_view_base");
        }

        const nextTiles = baseView.map.tiles.map((tile) => ({ ...tile, position: { ...tile.position } }));
        for (let index = 0; index < tileCount; index += 1) {
          const overlay = overlaysByIndex.get(index);
          const x = bounds.x + (index % bounds.width);
          const y = bounds.y + Math.floor(index / bounds.width);
          nextTiles[tileIndex(payload.map.width, x, y)] = {
            position: { x, y },
            fog: FOG_VALUES[fog[index]!] ?? "hidden",
            terrain: TERRAIN_VALUES[terrain[index]!] ?? "unknown",
            walkable: walkable[index] === 1,
            resource: overlay?.resource,
            occupant: overlay?.occupant,
            building: overlay?.building
          };
        }

        return nextTiles;
      })();

  return {
    ...payload,
    map: {
      width: payload.map.width,
      height: payload.map.height,
      tiles
    }
  };
}

function fromPayload(payload: SessionStatePayload, previousWorld?: PlayerWorldView | null): SessionUpdate {
  return {
    world: decodePlayerWorldView(payload.world, previousWorld),
    battle: payload.battle,
    events: payload.events,
    movementPlan: payload.movementPlan,
    reachableTiles: payload.reachableTiles,
    ...(payload.reason ? { reason: payload.reason } : {})
  };
}

function getStorage(): Storage | null {
  try {
    return sys.localStorage ?? null;
  } catch {
    return null;
  }
}

function getRemoteUrl(explicitUrl?: string): string {
  if (explicitUrl && explicitUrl.trim() !== "") {
    return explicitUrl;
  }

  const locationLike = globalThis.location;
  if (locationLike?.hostname) {
    const protocol = locationLike.protocol === "https:" ? "https" : "http";
    return `${protocol}://${locationLike.hostname}:2567`;
  }

  return "http://127.0.0.1:2567";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function isRecoverableSessionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "room_left" || error.message === "connect_failed" || error.message === "connect_timeout")
  );
}

function getReconnectionStorageKey(roomId: string, playerId: string): string {
  return `${RECONNECTION_TOKEN_PREFIX}:${roomId}:${playerId}`;
}

function getSessionReplayStorageKey(roomId: string, playerId: string): string {
  return `${SESSION_REPLAY_PREFIX}:${roomId}:${playerId}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVec2Like(value: unknown): value is Vec2 {
  return isObjectRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isSessionUpdateLike(value: unknown): value is SessionUpdate {
  if (!isObjectRecord(value) || !isObjectRecord(value.world) || !isObjectRecord(value.world.meta) || !isObjectRecord(value.world.map)) {
    return false;
  }

  if (
    typeof value.world.meta.roomId !== "string" ||
    typeof value.world.meta.seed !== "number" ||
    typeof value.world.meta.day !== "number" ||
    typeof value.world.playerId !== "string"
  ) {
    return false;
  }

  if (
    typeof value.world.map.width !== "number" ||
    typeof value.world.map.height !== "number" ||
    !Array.isArray(value.world.map.tiles) ||
    !Array.isArray(value.world.ownHeroes) ||
    !Array.isArray(value.world.visibleHeroes) ||
    !isObjectRecord(value.world.resources)
  ) {
    return false;
  }

  if (
    typeof value.world.resources.gold !== "number" ||
    typeof value.world.resources.wood !== "number" ||
    typeof value.world.resources.ore !== "number" ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.reachableTiles)
  ) {
    return false;
  }

  return value.reachableTiles.every((node) => isVec2Like(node));
}

function asStoredSessionReplayEnvelope(value: unknown): StoredSessionReplayEnvelope | null {
  if (isSessionUpdateLike(value)) {
    return {
      version: SESSION_REPLAY_VERSION,
      storedAt: 0,
      update: value
    };
  }

  if (
    !isObjectRecord(value) ||
    typeof value.version !== "number" ||
    typeof value.storedAt !== "number" ||
    !isSessionUpdateLike(value.update)
  ) {
    return null;
  }

  return {
    version: value.version,
    storedAt: value.storedAt,
    update: value.update
  };
}

function readReconnectionToken(roomId: string, playerId: string): string | null {
  return getStorage()?.getItem(getReconnectionStorageKey(roomId, playerId)) ?? null;
}

function writeReconnectionToken(roomId: string, playerId: string, token: string): void {
  getStorage()?.setItem(getReconnectionStorageKey(roomId, playerId), token);
}

function clearReconnectionToken(roomId: string, playerId: string): void {
  getStorage()?.removeItem(getReconnectionStorageKey(roomId, playerId));
}

function readSessionReplay(roomId: string, playerId: string): SessionUpdate | null {
  const raw = getStorage()?.getItem(getSessionReplayStorageKey(roomId, playerId));
  if (!raw) {
    return null;
  }

  try {
    return asStoredSessionReplayEnvelope(JSON.parse(raw))?.update ?? null;
  } catch {
    return null;
  }
}

function writeSessionReplay(roomId: string, playerId: string, update: SessionUpdate): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const envelope: StoredSessionReplayEnvelope = {
    version: SESSION_REPLAY_VERSION,
    storedAt: Date.now(),
    update
  };

  storage.setItem(getSessionReplayStorageKey(roomId, playerId), JSON.stringify(envelope));
}

function clearSessionReplay(roomId: string, playerId: string): void {
  getStorage()?.removeItem(getSessionReplayStorageKey(roomId, playerId));
}

class RemoteGameSession {
  private latestWorld: PlayerWorldView | null = null;
  private readonly pendingRequests = new Map<
    string,
    {
      expectedType: ServerMessage["type"];
      resolve: (message: ServerMessage) => void;
      reject: (error: Error) => void;
    }
  >();

  private requestCounter = 0;

  constructor(
    private readonly room: ColyseusRoomLike,
    private readonly roomId: string,
    private readonly playerId: string,
    private readonly closeCodes: ColyseusCloseCodes,
    private readonly options?: VeilCocosSessionOptions
  ) {
    this.persistReconnectionToken();

    this.room.onMessage("*", (type, payload) => {
      if (typeof type !== "string") {
        return;
      }

      const message = { type, ...(payload as object) } as ServerMessage;
      if (message.type === "session.state" && message.delivery === "push") {
        const update = fromPayload(message.payload, this.latestWorld);
        this.latestWorld = update.world;
        writeSessionReplay(this.roomId, this.playerId, update);
        this.options?.onPushUpdate?.(update);
        return;
      }

      const pending = "requestId" in message ? this.pendingRequests.get(message.requestId) : undefined;
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(message.requestId);

      if (message.type === "error") {
        pending.reject(new Error(message.reason));
        return;
      }

      if (message.type !== pending.expectedType) {
        pending.reject(new Error(`Unexpected response type: ${message.type}`));
        return;
      }

      pending.resolve(message);
    });

    this.room.onDrop(() => {
      this.options?.onConnectionEvent?.("reconnecting");
    });

    this.room.onReconnect(() => {
      this.persistReconnectionToken();
      this.options?.onConnectionEvent?.("reconnected");
    });

    this.room.onLeave((code) => {
      if (code === this.closeCodes.CONSENTED) {
        clearReconnectionToken(this.roomId, this.playerId);
        clearSessionReplay(this.roomId, this.playerId);
      } else if (code === this.closeCodes.FAILED_TO_RECONNECT) {
        this.options?.onConnectionEvent?.("reconnect_failed");
      }

      for (const pending of this.pendingRequests.values()) {
        pending.reject(new Error("room_left"));
      }
      this.pendingRequests.clear();
    });
  }

  async dispose(): Promise<void> {
    clearReconnectionToken(this.roomId, this.playerId);
    await this.room.leave();
  }

  async snapshot(): Promise<SessionUpdate> {
    const displayName = this.options?.getDisplayName?.()?.trim();
    const authToken = this.options?.getAuthToken?.()?.trim();
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "connect",
        requestId: this.nextRequestId(),
        roomId: this.roomId,
        playerId: this.playerId,
        ...(displayName ? { displayName } : {}),
        ...(authToken ? { authToken } : {})
      },
      "session.state"
    );

    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    writeSessionReplay(this.roomId, this.playerId, update);
    return update;
  }

  async moveHero(heroId: string, destination: Vec2): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.move",
          heroId,
          destination
        }
      },
      "session.state"
    );

    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    writeSessionReplay(this.roomId, this.playerId, update);
    return update;
  }

  async collect(heroId: string, position: Vec2): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.collect",
          heroId,
          position
        }
      },
      "session.state"
    );

    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    writeSessionReplay(this.roomId, this.playerId, update);
    return update;
  }

  async recruit(heroId: string, buildingId: string): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.recruit",
          heroId,
          buildingId
        }
      },
      "session.state"
    );

    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    writeSessionReplay(this.roomId, this.playerId, update);
    return update;
  }

  async visitBuilding(heroId: string, buildingId: string): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.visit",
          heroId,
          buildingId
        }
      },
      "session.state"
    );

    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    writeSessionReplay(this.roomId, this.playerId, update);
    return update;
  }

  async claimMine(heroId: string, buildingId: string): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.claimMine",
          heroId,
          buildingId
        }
      },
      "session.state"
    );

    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    writeSessionReplay(this.roomId, this.playerId, update);
    return update;
  }

  async learnSkill(heroId: string, skillId: string): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "hero.learnSkill",
          heroId,
          skillId
        }
      },
      "session.state"
    );

    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    writeSessionReplay(this.roomId, this.playerId, update);
    return update;
  }

  async endDay(): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "world.action",
        requestId: this.nextRequestId(),
        action: {
          type: "turn.endDay"
        }
      },
      "session.state"
    );

    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    writeSessionReplay(this.roomId, this.playerId, update);
    return update;
  }

  async actInBattle(action: BattleAction): Promise<SessionUpdate> {
    const response = await this.send<Extract<ServerMessage, { type: "session.state" }>>(
      {
        type: "battle.action",
        requestId: this.nextRequestId(),
        action
      },
      "session.state"
    );

    const update = fromPayload(response.payload, this.latestWorld);
    this.latestWorld = update.world;
    writeSessionReplay(this.roomId, this.playerId, update);
    return update;
  }

  async listReachable(heroId: string): Promise<Vec2[]> {
    const response = await this.send<Extract<ServerMessage, { type: "world.reachable" }>>(
      {
        type: "world.reachable",
        requestId: this.nextRequestId(),
        heroId
      },
      "world.reachable"
    );

    return response.reachableTiles;
  }

  private persistReconnectionToken(): void {
    if (this.room.reconnectionToken) {
      writeReconnectionToken(this.roomId, this.playerId, this.room.reconnectionToken);
    }
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `cocos-req-${this.requestCounter}`;
  }

  private send<T extends ServerMessage>(message: ClientMessage, expectedType: T["type"]): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pendingRequests.delete(message.requestId);
        reject(new Error(`${message.type}_timeout`));
      }, REMOTE_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(message.requestId, {
        expectedType,
        resolve: (payload) => {
          globalThis.clearTimeout(timer);
          resolve(payload as T);
        },
        reject: (error) => {
          globalThis.clearTimeout(timer);
          reject(error);
        }
      });

      this.room.send(message.type, message);
    });
  }
}

async function connectRemoteGameSession(
  roomId: string,
  playerId: string,
  seed: number,
  options?: VeilCocosSessionOptions,
  useStoredToken = true
): Promise<{ session: RemoteGameSession; recoveredFromStoredToken: boolean }> {
  const sdk = await loadColyseusSdk();
  const client = new sdk.Client(getRemoteUrl(options?.remoteUrl));
  const reconnectionToken = useStoredToken ? readReconnectionToken(roomId, playerId) : null;
  let recoveredFromStoredToken = false;

  const room = await new Promise<ColyseusRoomLike>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error("connect_timeout"));
    }, REMOTE_CONNECT_TIMEOUT_MS);

    const tryJoin = async (): Promise<ColyseusRoomLike> => {
      if (reconnectionToken) {
        try {
          const recoveredRoom = await client.reconnect(reconnectionToken);
          recoveredFromStoredToken = true;
          return recoveredRoom;
        } catch {
          clearReconnectionToken(roomId, playerId);
        }
      }

      return client.joinOrCreate("veil", {
        logicalRoomId: roomId,
        playerId,
        seed
      });
    };

    tryJoin()
      .then((joinedRoom) => {
        globalThis.clearTimeout(timer);
        resolve(joinedRoom);
      })
      .catch(() => {
        globalThis.clearTimeout(timer);
        reject(new Error("connect_failed"));
      });
  });

  return {
    session: new RemoteGameSession(room, roomId, playerId, sdk.CloseCode, options),
    recoveredFromStoredToken
  };
}

class RecoverableRemoteGameSession {
  private currentSession!: RemoteGameSession;
  private recoveryPromise: Promise<void> | null = null;

  private constructor(
    private readonly roomId: string,
    private readonly playerId: string,
    private readonly seed: number,
    private readonly options?: VeilCocosSessionOptions
  ) {}

  static async create(
    roomId: string,
    playerId: string,
    seed: number,
    options?: VeilCocosSessionOptions
  ): Promise<RecoverableRemoteGameSession> {
    const session = new RecoverableRemoteGameSession(roomId, playerId, seed, options);
    const { session: remoteSession, recoveredFromStoredToken } = await session.openRemoteSession(true);
    session.currentSession = remoteSession;

    if (recoveredFromStoredToken) {
      options?.onConnectionEvent?.("reconnected");
    }

    return session;
  }

  async dispose(): Promise<void> {
    if (this.recoveryPromise) {
      await this.recoveryPromise.catch(() => undefined);
    }

    await this.currentSession.dispose();
  }

  async snapshot(reason?: string): Promise<SessionUpdate> {
    const update = await this.runWithSession((session) => session.snapshot());
    return reason ? { ...update, reason } : update;
  }

  async moveHero(heroId: string, destination: Vec2): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.moveHero(heroId, destination));
  }

  async collect(heroId: string, position: Vec2): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.collect(heroId, position));
  }

  async recruit(heroId: string, buildingId: string): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.recruit(heroId, buildingId));
  }

  async visitBuilding(heroId: string, buildingId: string): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.visitBuilding(heroId, buildingId));
  }

  async claimMine(heroId: string, buildingId: string): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.claimMine(heroId, buildingId));
  }

  async learnSkill(heroId: string, skillId: string): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.learnSkill(heroId, skillId));
  }

  async endDay(): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.endDay());
  }

  async actInBattle(action: BattleAction): Promise<SessionUpdate> {
    return this.runWithSession((session) => session.actInBattle(action));
  }

  async listReachable(heroId: string): Promise<Vec2[]> {
    return this.runWithSession((session) => session.listReachable(heroId));
  }

  private async openRemoteSession(
    useStoredToken: boolean
  ): Promise<{ session: RemoteGameSession; recoveredFromStoredToken: boolean }> {
    const nestedOptions: VeilCocosSessionOptions = {
      ...(this.options?.remoteUrl ? { remoteUrl: this.options.remoteUrl } : {}),
      ...(this.options?.onPushUpdate ? { onPushUpdate: this.options.onPushUpdate } : {}),
      ...(this.options?.getDisplayName ? { getDisplayName: this.options.getDisplayName } : {}),
      ...(this.options?.getAuthToken ? { getAuthToken: this.options.getAuthToken } : {}),
      onConnectionEvent: (event) => this.handleConnectionEvent(event)
    };

    return connectRemoteGameSession(this.roomId, this.playerId, this.seed, nestedOptions, useStoredToken);
  }

  private handleConnectionEvent(event: ConnectionEvent): void {
    if (event === "reconnect_failed") {
      this.options?.onConnectionEvent?.("reconnect_failed");
      void this.beginRecovery();
      return;
    }

    this.options?.onConnectionEvent?.(event);
  }

  private beginRecovery(): Promise<void> {
    if (this.recoveryPromise) {
      return this.recoveryPromise;
    }

    this.recoveryPromise = (async () => {
      clearReconnectionToken(this.roomId, this.playerId);

      while (true) {
        try {
          const { session } = await this.openRemoteSession(false);
          this.currentSession = session;
          const snapshot = await session.snapshot();
          this.options?.onPushUpdate?.(snapshot);
          this.options?.onConnectionEvent?.("reconnected");
          return;
        } catch {
          await wait(REMOTE_RECOVERY_RETRY_MS);
        }
      }
    })().finally(() => {
      this.recoveryPromise = null;
    });

    return this.recoveryPromise;
  }

  private async getActiveSession(): Promise<RemoteGameSession> {
    if (this.recoveryPromise) {
      await this.recoveryPromise;
    }

    return this.currentSession;
  }

  private async runWithSession<T>(operation: (session: RemoteGameSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.getActiveSession();
      try {
        return await operation(session);
      } catch (error) {
        if (!isRecoverableSessionError(error)) {
          throw error;
        }

        await this.beginRecovery();
      }
    }

    throw new Error("session_unavailable");
  }
}

export class VeilCocosSession {
  private constructor(private readonly remoteSession: RecoverableRemoteGameSession) {}

  static readStoredReplay(roomId: string, playerId: string): SessionUpdate | null {
    return readSessionReplay(roomId, playerId);
  }

  static async create(
    roomId: string,
    playerId: string,
    seed = 1001,
    options?: VeilCocosSessionOptions
  ): Promise<VeilCocosSession> {
    const remoteSession = await RecoverableRemoteGameSession.create(roomId, playerId, seed, options);
    return new VeilCocosSession(remoteSession);
  }

  async snapshot(reason?: string): Promise<SessionUpdate> {
    return this.remoteSession.snapshot(reason);
  }

  async moveHero(heroId: string, destination: Vec2): Promise<SessionUpdate> {
    return this.remoteSession.moveHero(heroId, destination);
  }

  async collect(heroId: string, position: Vec2): Promise<SessionUpdate> {
    return this.remoteSession.collect(heroId, position);
  }

  async recruit(heroId: string, buildingId: string): Promise<SessionUpdate> {
    return this.remoteSession.recruit(heroId, buildingId);
  }

  async visitBuilding(heroId: string, buildingId: string): Promise<SessionUpdate> {
    return this.remoteSession.visitBuilding(heroId, buildingId);
  }

  async claimMine(heroId: string, buildingId: string): Promise<SessionUpdate> {
    return this.remoteSession.claimMine(heroId, buildingId);
  }

  async learnSkill(heroId: string, skillId: string): Promise<SessionUpdate> {
    return this.remoteSession.learnSkill(heroId, skillId);
  }

  async endDay(): Promise<SessionUpdate> {
    return this.remoteSession.endDay();
  }

  async actInBattle(action: BattleAction): Promise<SessionUpdate> {
    return this.remoteSession.actInBattle(action);
  }

  async listReachable(heroId: string): Promise<Vec2[]> {
    return this.remoteSession.listReachable(heroId);
  }

  async dispose(): Promise<void> {
    await this.remoteSession.dispose();
  }
}

async function loadColyseusSdk(): Promise<ColyseusSdkRuntime> {
  if (!cachedColyseusSdkPromise) {
    cachedColyseusSdkPromise = (async () => {
      const globalRecord = globalThis as Record<string, unknown>;
      const originalAddEventListener = globalRecord.addEventListener;
      const originalRemoveEventListener = globalRecord.removeEventListener;
      let patched = false;

      try {
        if (typeof originalAddEventListener === "function" && typeof originalRemoveEventListener === "function") {
          globalRecord.addEventListener = undefined;
          globalRecord.removeEventListener = undefined;
          patched = true;
        }
      } catch {
        patched = false;
      }

      try {
        const sdk = await import("@colyseus/sdk");
        return {
          Client: sdk.Client as unknown as ColyseusSdkRuntime["Client"],
          CloseCode: sdk.CloseCode as ColyseusCloseCodes
        };
      } finally {
        if (patched) {
          globalRecord.addEventListener = originalAddEventListener;
          globalRecord.removeEventListener = originalRemoveEventListener;
        }
      }
    })();
  }

  return cachedColyseusSdkPromise;
}
