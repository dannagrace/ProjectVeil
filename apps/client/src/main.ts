import "./styles.css";
import {
  createHeroSkillTreeView,
  createHeroAttributeBreakdown,
  createHeroEquipmentLoadoutView,
  createHeroProgressMeterView,
  experienceRequiredForNextLevel,
  formatEquipmentBonusSummary,
  formatEquipmentRarityLabel,
  getDefaultBattleSkillCatalog,
  getEquipmentDefinition,
  predictPlayerWorldAction,
  totalExperienceRequiredForLevel,
  type BattleAction,
  type BattleState,
  type EquipmentType,
  type MovementPlan,
  type PlayerTileView,
  type PlayerWorldView
} from "../../../packages/shared/src/index";
import { createGameSession, readStoredSessionReplay, type SessionUpdate } from "./local-session";
import {
  buildingAsset,
  markerAsset,
  objectBadgeAssets,
  resourceAsset,
  terrainAsset,
  unitAsset,
  unitBadgeAssets,
  unitFrameAsset
} from "./assets";
import { describeTileObject } from "./object-visuals";
import {
  clearCurrentAuthSession,
  loginGuestAuthSession,
  loginPasswordAuthSession,
  readStoredAuthSession,
  syncCurrentAuthSession,
  type StoredAuthSession
} from "./auth-session";
import {
  createLobbyPreferences,
  loadLobbyRooms,
  saveLobbyPreferences,
  type LobbyRoomSummary
} from "./lobby-preferences";
import {
  createFallbackPlayerAccountProfile as createLocalAccountProfile,
  bindPlayerAccountCredentials as bindAccountCredentials,
  loadPlayerAccountProfile as loadAccountProfile,
  rememberPreferredPlayerDisplayName,
  readPreferredPlayerDisplayName as readLocalPreferredDisplayName,
  savePlayerAccountDisplayName as saveAccountDisplayName,
  type PlayerAccountProfile as ClientPlayerAccountProfile
} from "./player-account";
import { renderAchievementProgress, renderRecentAccountEvents } from "./account-history";

const params = new URLSearchParams(window.location.search);
const queryRoomId = params.get("roomId")?.trim() ?? "";
const queryPlayerId = params.get("playerId")?.trim() ?? "";
const storedAuthSession = readStoredAuthSession();
const resolvedBootPlayerId = queryPlayerId || storedAuthSession?.playerId || "";
const shouldBootGame = Boolean(queryRoomId && resolvedBootPlayerId);
const initialLobbyPreferences = createLobbyPreferences({
  ...(queryRoomId ? { roomId: queryRoomId } : {}),
  ...(resolvedBootPlayerId ? { playerId: resolvedBootPlayerId } : {})
});
const roomId = shouldBootGame ? queryRoomId : initialLobbyPreferences.roomId;
const playerId = shouldBootGame ? resolvedBootPlayerId : initialLobbyPreferences.playerId;
const initialAccountDisplayName =
  storedAuthSession?.playerId === playerId ? storedAuthSession.displayName : readLocalPreferredDisplayName(playerId);
const initialLobbyDisplayName =
  storedAuthSession?.playerId === initialLobbyPreferences.playerId
    ? storedAuthSession.displayName
    : readLocalPreferredDisplayName(initialLobbyPreferences.playerId);
const initialLobbyLoginId = storedAuthSession?.loginId ?? "";
const battleSkillNameById = new Map(
  getDefaultBattleSkillCatalog().skills.map((skill) => [skill.id, skill.name] as const)
);

interface BattleModalState {
  visible: boolean;
  title: string;
  body: string;
}

interface BattleFxState {
  flashUnitId: string | null;
  floatingText: string | null;
}

interface TimelineEntry {
  id: string;
  tone: "move" | "battle" | "loot" | "sync" | "system";
  source: "local" | "push" | "system";
  text: string;
}

interface LobbyViewState {
  playerId: string;
  roomId: string;
  displayName: string;
  loginId: string;
  password: string;
  authSession: StoredAuthSession | null;
  rooms: LobbyRoomSummary[];
  loading: boolean;
  entering: boolean;
  status: string;
}

interface AppState {
  world: PlayerWorldView;
  battle: BattleState | null;
  account: ClientPlayerAccountProfile;
  lobby: LobbyViewState;
  accountDraftName: string;
  accountLoginId: string;
  accountPassword: string;
  accountSaving: boolean;
  accountBinding: boolean;
  accountStatus: string;
  selectedHeroId: string | null;
  selectedTile: { x: number; y: number } | null;
  hoveredTile: { x: number; y: number } | null;
  previewPlan: MovementPlan | null;
  reachableTiles: Array<{ x: number; y: number }>;
  selectedBattleTargetId: string | null;
  feedbackTone: "idle" | "move" | "battle" | "loot";
  animatedPath: Array<{ x: number; y: number }>;
  animatedPathIndex: number;
  battleFx: BattleFxState;
  pendingBattleAction: BattleAction | null;
  timeline: TimelineEntry[];
  log: string[];
  modal: BattleModalState;
  predictionStatus: string;
}

type BattleUnitView = BattleState["units"][string];
type BattleSkillView = NonNullable<BattleUnitView["skills"]>[number];
type BattleStatusView = NonNullable<BattleUnitView["statusEffects"]>[number];
type BattleHazardView = BattleState["environment"][number];

const state: AppState = {
  world: {
    meta: { roomId: "booting", seed: 0, day: 0 },
    map: { width: 0, height: 0, tiles: [] },
    ownHeroes: [],
    visibleHeroes: [],
    resources: { gold: 0, wood: 0, ore: 0 },
    playerId
  },
  battle: null,
  account: createLocalAccountProfile(playerId, roomId, initialAccountDisplayName),
  lobby: {
    playerId: initialLobbyPreferences.playerId,
    roomId: initialLobbyPreferences.roomId,
    displayName: initialLobbyDisplayName,
    loginId: initialLobbyLoginId,
    password: "",
    authSession: storedAuthSession,
    rooms: [],
    loading: false,
    entering: false,
    status: shouldBootGame ? "" : "优先展示活跃房间，也支持直接输入新房间 ID 创建实例。"
  },
  accountDraftName: initialAccountDisplayName,
  accountLoginId: storedAuthSession?.loginId ?? "",
  accountPassword: "",
  accountSaving: false,
  accountBinding: false,
  accountStatus: "游客账号资料将在连接后自动同步。",
  selectedHeroId: null,
  selectedTile: null,
  hoveredTile: null,
  previewPlan: null,
  reachableTiles: [],
  selectedBattleTargetId: null,
  feedbackTone: "idle",
  animatedPath: [],
  animatedPathIndex: -1,
  battleFx: {
    flashUnitId: null,
    floatingText: null
  },
  pendingBattleAction: null,
  timeline: [],
  log: ["正在连接本地会话服务..."],
  modal: {
    visible: false,
    title: "",
    body: ""
  },
  predictionStatus: ""
};

let accountRefreshPromise: Promise<void> | null = null;

interface PendingPrediction {
  world: PlayerWorldView;
  battle: BattleState | null;
  previewPlan: MovementPlan | null;
  reachableTiles: Array<{ x: number; y: number }>;
  feedbackTone: AppState["feedbackTone"];
  predictionStatus: string;
}

let pendingPrediction: PendingPrediction | null = null;

let sessionPromise: ReturnType<typeof createGameSession> | null = shouldBootGame
  ? createGameSession(roomId, playerId, 1001, {
      getDisplayName: () => state.accountDraftName,
      getAuthToken: () => state.lobby.authSession?.token ?? null,
      onPushUpdate: (update) => {
        state.log.unshift("收到房间同步推送");
        state.log = state.log.slice(0, 12);
        applyUpdate(update, "push");
      },
      onConnectionEvent: (event) => {
        state.log.unshift(
          event === "reconnecting"
            ? "连接中断，正在尝试重连..."
            : event === "reconnected"
              ? "连接已恢复"
              : "旧连接恢复失败，正在尝试从持久化快照恢复房间..."
        );
        state.log = state.log.slice(0, 12);
        render();
      }
    })
  : null;

async function getSession() {
  if (!sessionPromise) {
    throw new Error("session_not_ready");
  }

  return sessionPromise;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatAccountSource(account: ClientPlayerAccountProfile): string {
  return account.source === "remote" ? "云端账号" : "本地游客档";
}

function formatAuthModeLabel(session: StoredAuthSession | null): string {
  if (!session) {
    return "未登录";
  }

  if (session.authMode === "account") {
    return session.loginId ? `账号模式 · ${session.loginId}` : "账号模式";
  }

  return "游客模式";
}

function formatCredentialBinding(account: ClientPlayerAccountProfile): string {
  if (!account.loginId) {
    return "尚未绑定口令账号，可把当前游客档升级成长期账号。";
  }

  if (!account.credentialBoundAt) {
    return `已绑定登录 ID：${account.loginId}`;
  }

  const date = new Date(account.credentialBoundAt);
  const label = Number.isNaN(date.getTime()) ? account.credentialBoundAt : date.toLocaleString();
  return `已绑定登录 ID：${account.loginId} · ${label}`;
}

function formatAccountLastSeen(account: ClientPlayerAccountProfile): string {
  if (!account.lastSeenAt) {
    return account.lastRoomId ? `最近房间 ${account.lastRoomId}` : "尚未记录活跃时间";
  }

  const date = new Date(account.lastSeenAt);
  const label = Number.isNaN(date.getTime()) ? account.lastSeenAt : date.toLocaleString();
  return account.lastRoomId ? `${label} · ${account.lastRoomId}` : label;
}

function formatGlobalVault(account: ClientPlayerAccountProfile): string {
  return `全局仓库 金币 ${account.globalResources.gold} / 木材 ${account.globalResources.wood} / 矿石 ${account.globalResources.ore}`;
}

function formatLobbyRoomUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? updatedAt : date.toLocaleString();
}

function tileLabel(tile: PlayerTileView): string {
  if (tile.fog === "hidden") {
    return "?";
  }

  const terrain = tile.terrain.slice(0, 1).toUpperCase();
  const occupant = tile.occupant?.kind === "neutral" ? "M" : tile.occupant?.kind === "hero" ? "H" : "";
  const resource = tile.resource ? tile.resource.kind.slice(0, 1).toUpperCase() : "";
  const building = tile.building ? "B" : "";
  return `${terrain}${occupant}${resource}${building}`;
}

function markerStateForTile(tile: PlayerTileView): "idle" | "selected" | "hit" {
  if (tile.occupant?.refId && state.battleFx.flashUnitId && state.battleFx.flashUnitId.startsWith(tile.occupant.refId)) {
    return "hit";
  }

  if (state.selectedTile && tile.position.x === state.selectedTile.x && tile.position.y === state.selectedTile.y) {
    return "selected";
  }

  return "idle";
}

function renderTileMedia(tile: PlayerTileView): string {
  const terrainSrc = terrainAsset(tile.terrain, tile.position.x, tile.position.y);
  const resourceSrc = tile.resource ? resourceAsset(tile.resource.kind) : null;
  const buildingSrc = tile.building ? buildingAsset(tile.building.kind) : null;
  const markerState = markerStateForTile(tile);
  const markerSrc =
    tile.occupant?.kind === "hero"
      ? markerAsset("hero", markerState)
      : tile.occupant?.kind === "neutral"
        ? markerAsset("neutral", markerState)
        : null;
  const buildingBadge = buildingSrc
    ? `<img class="tile-building-badge" src="${buildingSrc}" alt="${tile.building?.kind ?? "building"}" />`
    : tile.building
      ? `<span class="tile-building-badge">B</span>`
      : "";

  return `
    <img class="tile-terrain" src="${terrainSrc}" alt="${tile.terrain}" />
    ${resourceSrc ? `<img class="tile-resource" src="${resourceSrc}" alt="${tile.resource?.kind ?? "resource"}" />` : ""}
    ${markerSrc ? `<img class="tile-marker" src="${markerSrc}" alt="${tile.occupant?.kind ?? "marker"}" />` : ""}
    ${buildingBadge}
  `;
}

function formatPath(path: { x: number; y: number }[]): string {
  return path.map((node) => `(${node.x},${node.y})`).join(" -> ");
}

function activeHero() {
  return state.selectedHeroId ? state.world.ownHeroes.find((item) => item.id === state.selectedHeroId) ?? null : null;
}

function formatHeroProgression(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "Lv 0";
  }

  return `Lv ${hero.progression.level}`;
}

function formatHeroExperience(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "XP 0/100";
  }

  const meter = createHeroProgressMeterView(hero);
  return `XP ${meter.currentLevelExperience}/${meter.nextLevelExperience}`;
}

function renderHeroProgressPanel(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return `
      <section class="hero-progress-panel info-card">
        <div class="hero-progress-head">
          <strong>升级进度</strong>
          <span class="muted">等待英雄数据</span>
        </div>
      </section>
    `;
  }

  const meter = createHeroProgressMeterView(hero);
  return `
    <section class="hero-progress-panel info-card" data-testid="hero-progress-panel">
      <div class="hero-progress-head">
        <strong>升级进度</strong>
        <span class="status-pill">Lv ${meter.level}</span>
      </div>
      <div class="hero-progress-meta">
        <span>当前 ${meter.currentLevelExperience}/${meter.nextLevelExperience} XP</span>
        <span>还需 ${meter.remainingExperience} XP</span>
      </div>
      <div class="hero-progress-track" aria-label="hero experience progress">
        <div class="hero-progress-fill" style="width:${(meter.progressRatio * 100).toFixed(1)}%"></div>
      </div>
      <p class="hero-progress-copy muted">总经验 ${meter.totalExperience} · 下一级阈值 ${totalExperienceRequiredForLevel(meter.level + 1)}</p>
    </section>
  `;
}

function renderHeroAttributePanel(
  hero: PlayerWorldView["ownHeroes"][number] | null,
  world: PlayerWorldView
): string {
  if (!hero) {
    return "";
  }

  const rows = createHeroAttributeBreakdown(hero, world);
  return `
    <section class="hero-attribute-panel info-card" data-testid="hero-attribute-panel">
      <div class="hero-progress-head">
        <strong>属性来源</strong>
        <span class="muted">悬停查看公式</span>
      </div>
      <div class="hero-attribute-list">
        ${rows
          .map(
            (row) => `
              <div class="hero-attribute-row" title="${escapeHtml(row.formula)}">
                <strong>${row.label}</strong>
                <span>${row.total}</span>
                <span>基础 ${row.base}</span>
                <span>成长 ${row.progression}</span>
                <span>建筑 ${row.buildings}</span>
                <span>装备 ${row.equipment}</span>
                <span>技能 ${row.skills}</span>
                ${row.other !== 0 ? `<span>其他 ${row.other}</span>` : ""}
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function formatEquipmentActionReason(reason: string): string {
  if (reason === "equipment_not_in_inventory") {
    return "背包里没有这件装备";
  }

  if (reason === "equipment_slot_mismatch") {
    return "装备类型和槽位不匹配";
  }

  if (reason === "equipment_definition_missing") {
    return "装备目录缺失，无法装备";
  }

  if (reason === "equipment_slot_empty") {
    return "当前槽位没有可卸下的装备";
  }

  if (reason === "equipment_already_equipped") {
    return "该装备已经穿戴中";
  }

  return reason;
}

function inventoryItemsForSlot(
  hero: PlayerWorldView["ownHeroes"][number],
  slot: EquipmentType
): Array<{
  itemId: string;
  name: string;
  rarityLabel: string;
  bonusSummary: string;
  description: string;
  count: number;
}> {
  const counts = new Map<string, number>();

  for (const itemId of hero.loadout.inventory) {
    const definition = getEquipmentDefinition(itemId);
    if (!definition || definition.type !== slot) {
      continue;
    }

    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([itemId, count]) => {
      const definition = getEquipmentDefinition(itemId);
      if (!definition) {
        return null;
      }

      return {
        itemId,
        name: definition.name,
        rarityLabel: formatEquipmentRarityLabel(definition.rarity),
        bonusSummary: formatEquipmentBonusSummary(definition.bonuses),
        description: definition.description,
        count
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function renderHeroEquipmentPanel(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "";
  }

  const loadout = createHeroEquipmentLoadoutView(hero);
  const totalBonuses = [
    loadout.summary.attack !== 0 ? `攻击 +${loadout.summary.attack}` : "",
    loadout.summary.defense !== 0 ? `防御 +${loadout.summary.defense}` : "",
    loadout.summary.power !== 0 ? `力量 +${loadout.summary.power}` : "",
    loadout.summary.knowledge !== 0 ? `知识 +${loadout.summary.knowledge}` : "",
    loadout.summary.maxHp !== 0 ? `生命上限 +${loadout.summary.maxHp}` : ""
  ].filter(Boolean);

  return `
    <section class="hero-equipment-panel info-card" data-testid="hero-equipment-panel">
      <div class="hero-progress-head">
        <strong>装备配置</strong>
        <span class="muted">${totalBonuses.join(" / ") || "当前未提供额外属性"}</span>
      </div>
      <div class="hero-equipment-list">
        ${loadout.slots
          .map(
            (slot) => {
              const inventory = inventoryItemsForSlot(hero, slot.slot);
              return `
              <article class="hero-equipment-item">
                <div class="hero-equipment-meta">
                  <div>
                    <span class="hero-equipment-slot">${slot.label}</span>
                    <strong>${escapeHtml(slot.itemName)}</strong>
                  </div>
                  ${slot.rarityLabel ? `<span class="status-pill">${slot.rarityLabel}</span>` : ""}
                </div>
                <p>${escapeHtml(slot.bonusSummary)}</p>
                ${slot.specialEffectSummary ? `<p class="hero-equipment-copy">${escapeHtml(slot.specialEffectSummary)}</p>` : ""}
                ${slot.description ? `<p class="hero-equipment-copy">${escapeHtml(slot.description)}</p>` : ""}
                <div class="hero-equipment-actions">
                  <button
                    class="hero-equipment-button secondary-button"
                    data-hero-unequip-slot="${slot.slot}"
                    ${slot.itemId && !state.battle ? "" : "disabled"}
                  >卸下</button>
                  <span class="hero-equipment-copy">背包 ${inventory.reduce((total, item) => total + item.count, 0)} 件可替换</span>
                </div>
                <div class="hero-equipment-inventory">
                  ${
                    inventory.length > 0
                      ? inventory
                          .map(
                            (item) => `
                              <button
                                class="hero-equipment-button"
                                data-hero-equip-slot="${slot.slot}"
                                data-hero-equip-id="${item.itemId}"
                                ${state.battle ? "disabled" : ""}
                                title="${escapeHtml(`${item.bonusSummary} · ${item.description}`)}"
                              >${escapeHtml(`${item.name} x${item.count}`)}</button>
                            `
                          )
                          .join("")
                      : `<span class="hero-equipment-copy muted">暂无可用替换装备</span>`
                  }
                </div>
              </article>
            `;
            }
          )
          .join("")}
      </div>
    </section>
  `;
}

function formatHeroSkillReason(reason: string): string {
  if (reason === "not_enough_skill_points") {
    return "需要可用技能点";
  }

  if (reason === "hero_level_too_low") {
    return "等级未达标";
  }

  if (reason === "skill_max_rank_reached") {
    return "已满级";
  }

  if (reason === "skill_prerequisite_missing") {
    return "前置未满足";
  }

  return reason;
}

function formatGrantedBattleSkillNames(skillIds: string[]): string {
  if (skillIds.length === 0) {
    return "当前未提供额外战斗技能";
  }

  return skillIds.map((skillId) => battleSkillNameById.get(skillId) ?? skillId).join(" / ");
}

function renderHeroSkillTree(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return `<div class="hero-skill-tree muted">当前没有可展示的技能树。</div>`;
  }

  const tree = createHeroSkillTreeView(hero);
  return `
    <section class="hero-skill-tree" data-testid="hero-skill-tree">
      <div class="hero-skill-tree-head">
        <strong>技能树</strong>
        <span>${tree.availableSkillPoints} 点待分配</span>
      </div>
      <div class="hero-skill-tree-grid">
        ${tree.branches
          .map(
            (branch) => `
              <article class="hero-skill-branch info-card">
                <div class="info-card-head">
                  <div>
                    <div class="info-card-eyebrow">Branch</div>
                    <strong>${escapeHtml(branch.name)}</strong>
                  </div>
                  <span class="status-pill">${branch.skills.reduce((total, skill) => total + skill.currentRank, 0)} / ${branch.skills.reduce((total, skill) => total + skill.maxRank, 0)}</span>
                </div>
                <p class="hero-skill-branch-copy">${escapeHtml(branch.description)}</p>
                <div class="hero-skill-list">
                  ${branch.skills
                    .map(
                      (skill) => `
                        <div class="hero-skill-item">
                          <div class="hero-skill-meta">
                            <div>
                              <strong>${escapeHtml(skill.name)}</strong>
                              <span>Lv ${skill.requiredLevel}+ · Rank ${skill.currentRank}/${skill.maxRank}</span>
                            </div>
                            <button
                              class="hero-skill-button"
                              data-hero-skill-id="${skill.id}"
                              ${skill.canLearn && !state.battle ? "" : "disabled"}
                              title="${escapeHtml(skill.canLearn ? `学习 / 强化到 Rank ${skill.nextRank}` : formatHeroSkillReason(skill.reason ?? ""))}"
                            >
                              ${skill.currentRank > 0 ? "强化" : "学习"}
                            </button>
                          </div>
                          <p>${escapeHtml(skill.description)}</p>
                          <p class="hero-skill-copy">当前效果：${escapeHtml(formatGrantedBattleSkillNames(skill.grantedBattleSkillIds))}</p>
                          <p class="hero-skill-copy">
                            ${
                              skill.nextRank
                                ? `下一阶：${escapeHtml(skill.ranks.find((rank) => rank.rank === skill.nextRank)?.description ?? `Rank ${skill.nextRank}`)}${skill.nextGrantedBattleSkillIds.length > 0 ? ` · 解锁 ${escapeHtml(formatGrantedBattleSkillNames(skill.nextGrantedBattleSkillIds))}` : ""}`
                                : "已经达到当前技能上限"
                            }
                          </p>
                          ${skill.prerequisites.length > 0 ? `<p class="hero-skill-copy">前置：${escapeHtml(skill.prerequisites.join(" / "))}</p>` : ""}
                          ${!skill.canLearn ? `<p class="hero-skill-copy muted">${escapeHtml(formatHeroSkillReason(skill.reason ?? ""))}</p>` : ""}
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function formatResourceKindLabel(kind: "gold" | "wood" | "ore"): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
}

function formatDailyIncome(kind: "gold" | "wood" | "ore", amount: number): string {
  return `${formatResourceKindLabel(kind)} +${amount}/天`;
}

function formatHeroCoreStats(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "ATK 0 · DEF 0 · POW 0 · KNW 0";
  }

  return `ATK ${hero.stats.attack} · DEF ${hero.stats.defense} · POW ${hero.stats.power} · KNW ${hero.stats.knowledge}`;
}

function formatHeroStatBonus(bonus: { attack: number; defense: number; power: number; knowledge: number }): string {
  const parts = [
    bonus.attack > 0 ? `攻击 +${bonus.attack}` : "",
    bonus.defense > 0 ? `防御 +${bonus.defense}` : "",
    bonus.power > 0 ? `力量 +${bonus.power}` : "",
    bonus.knowledge > 0 ? `知识 +${bonus.knowledge}` : ""
  ].filter(Boolean);

  return parts.join(" / ") || "属性提升";
}

function hoveredTileData(): PlayerTileView | null {
  if (!state.hoveredTile) {
    return null;
  }

  return (
    state.world.map.tiles.find(
      (tile) => tile.position.x === state.hoveredTile!.x && tile.position.y === state.hoveredTile!.y
    ) ?? null
  );
}

function isReachableTile(x: number, y: number): boolean {
  return state.reachableTiles.some((tile) => tile.x === x && tile.y === y);
}

function isPreviewNode(x: number, y: number): boolean {
  return Boolean(state.previewPlan?.path.some((node) => node.x === x && node.y === y));
}

function isTravelNode(x: number, y: number): boolean {
  return Boolean(state.previewPlan?.travelPath.some((node) => node.x === x && node.y === y));
}

function isAnimatedNode(x: number, y: number): boolean {
  return state.animatedPath.slice(0, state.animatedPathIndex + 1).some((node) => node.x === x && node.y === y);
}

function isBattleEvent(event: SessionUpdate["events"][number]): boolean {
  return event.type === "battle.resolved";
}

function ownedHeroIds(world: PlayerWorldView = state.world): Set<string> {
  return new Set(world.ownHeroes.map((hero) => hero.id));
}

function controlledBattleCamp(
  battle: BattleState | null,
  world: PlayerWorldView = state.world
): "attacker" | "defender" | null {
  if (!battle) {
    return null;
  }

  const ownedIds = ownedHeroIds(world);
  if (battle.worldHeroId && ownedIds.has(battle.worldHeroId)) {
    return "attacker";
  }

  if (battle.defenderHeroId && ownedIds.has(battle.defenderHeroId)) {
    return "defender";
  }

  return null;
}

function opposingBattleCamp(camp: "attacker" | "defender" | null): "attacker" | "defender" | null {
  if (!camp) {
    return null;
  }

  return camp === "attacker" ? "defender" : "attacker";
}

function battleSkillKindLabel(kind: BattleSkillView["kind"]): string {
  return kind === "active" ? "主动技能" : "被动技能";
}

function battleSkillTargetLabel(target: BattleSkillView["target"]): string {
  return target === "enemy" ? "敌方单体" : "自身增益";
}

function battleSkillReadyLabel(skill: BattleSkillView): string {
  if (skill.kind === "passive") {
    return "被动常驻";
  }

  return skill.remainingCooldown > 0 ? `冷却 ${skill.remainingCooldown}/${skill.cooldown}` : "已就绪";
}

function battleStatusModifierParts(status: BattleStatusView): string[] {
  const parts: string[] = [];

  if (status.attackModifier !== 0) {
    parts.push(`${status.attackModifier > 0 ? "+" : ""}${status.attackModifier} 攻击`);
  }

  if (status.defenseModifier !== 0) {
    parts.push(`${status.defenseModifier > 0 ? "+" : ""}${status.defenseModifier} 防御`);
  }

  if (status.damagePerTurn > 0) {
    parts.push(`每回合 ${status.damagePerTurn} 持续伤害`);
  }

  return parts;
}

function renderBattleDetailItem(title: string, meta: string, copy: string): string {
  return `
    <div class="battle-detail-item">
      <strong>${title}</strong>
      <span class="battle-detail-meta">${meta}</span>
      <span class="battle-detail-copy">${copy}</span>
    </div>
  `;
}

function renderBattleSkillDetail(skill: BattleSkillView): string {
  const deliveryLabel =
    skill.target === "enemy" ? (skill.delivery === "ranged" ? "远程" : "接战") : "自身";
  return renderBattleDetailItem(
    skill.name,
    `${battleSkillKindLabel(skill.kind)} · ${battleSkillTargetLabel(skill.target)} · ${deliveryLabel} · ${battleSkillReadyLabel(skill)}`,
    skill.description
  );
}

function renderBattleStatusDetail(status: BattleStatusView): string {
  const modifierText = battleStatusModifierParts(status);
  return renderBattleDetailItem(
    status.name,
    [`剩余 ${status.durationRemaining} 回合`, ...modifierText].join(" · "),
    status.description
  );
}

function renderBattleFlagDetail(title: string, copy: string): string {
  return renderBattleDetailItem(title, "战斗姿态", copy);
}

function renderBattleHazardDetail(hazard: BattleHazardView): string {
  if (hazard.kind === "blocker") {
    return renderBattleDetailItem(
      hazard.name,
      `${hazard.lane + 1} 线 · 耐久 ${hazard.durability}/${hazard.maxDurability}`,
      hazard.description
    );
  }

  return renderBattleDetailItem(
    hazard.name,
    `${hazard.lane + 1} 线 · ${hazard.damage} 伤害 · 剩余 ${hazard.charges} 次`,
    hazard.description
  );
}

function renderBattleDetailGroup(title: string, items: string[], emptyMessage: string): string {
  return `
    <div class="battle-detail-group">
      <div class="battle-detail-title">${title}</div>
      <div class="battle-detail-list">
        ${items.length > 0 ? items.join("") : `<div class="battle-detail-empty">${emptyMessage}</div>`}
      </div>
    </div>
  `;
}

function renderBattleIntelCard(
  title: string,
  eyebrow: string,
  badge: string,
  unit: BattleUnitView | null,
  emptyMessage: string
): string {
  if (!unit) {
    return `
      <article class="battle-intel-card info-card">
        <div class="battle-intel-card-head">
          <div>
            <div class="info-card-eyebrow">${eyebrow}</div>
            <strong>${title}</strong>
          </div>
          <span class="status-pill">${badge}</span>
        </div>
        <div class="battle-detail-empty">${emptyMessage}</div>
      </article>
    `;
  }

  const flagDetails: string[] = [];
  if (unit.defending) {
    flagDetails.push(renderBattleFlagDetail("防御姿态", "本回合采取防守站位，承伤能力更稳。"));
  }
  if (unit.hasRetaliated) {
    flagDetails.push(renderBattleFlagDetail("已完成反击", "本轮反击次数已消耗，再受击时不会再次反击。"));
  }

  return `
    <article class="battle-intel-card info-card">
      <div class="battle-intel-card-head">
        <div>
          <div class="info-card-eyebrow">${eyebrow}</div>
          <strong>${title} · ${unit.stackName}</strong>
        </div>
        <span class="status-pill">${badge}</span>
      </div>
      <div class="battle-intel-stats">
        <span class="battle-intel-chip">数量 x${unit.count}</span>
        <span class="battle-intel-chip">HP ${unit.currentHp}/${unit.maxHp}</span>
        <span class="battle-intel-chip">线位 ${unit.lane + 1}</span>
        <span class="battle-intel-chip">ATK ${unit.attack}</span>
        <span class="battle-intel-chip">DEF ${unit.defense}</span>
        <span class="battle-intel-chip">INIT ${unit.initiative}</span>
      </div>
      ${renderBattleDetailGroup("技能", (unit.skills ?? []).map(renderBattleSkillDetail), "当前没有可说明的技能。")}
      ${renderBattleDetailGroup("状态", [...(unit.statusEffects ?? []).map(renderBattleStatusDetail), ...flagDetails], "当前没有持续状态。")}
    </article>
  `;
}

function didCurrentPlayerWinBattle(
  event: Extract<SessionUpdate["events"][number], { type: "battle.resolved" }>,
  world: PlayerWorldView = state.world
): boolean {
  const ownedIds = ownedHeroIds(world);
  if (event.result === "attacker_victory") {
    return ownedIds.has(event.heroId);
  }

  return Boolean(event.defenderHeroId && ownedIds.has(event.defenderHeroId));
}

function openBattleModal(title: string, body: string): void {
  state.modal = {
    visible: true,
    title,
    body
  };
}

function closeBattleModal(): void {
  state.modal.visible = false;
  render();
}

function clearPendingPrediction(): void {
  pendingPrediction = null;
  state.predictionStatus = "";
}

function applyPendingPrediction(next: {
  world: PlayerWorldView;
  movementPlan: MovementPlan | null;
  reachableTiles: Array<{ x: number; y: number }>;
  status: string;
  tone: AppState["feedbackTone"];
}): void {
  if (!pendingPrediction) {
    pendingPrediction = {
      world: structuredClone(state.world),
      battle: state.battle ? structuredClone(state.battle) : null,
      previewPlan: state.previewPlan ? structuredClone(state.previewPlan) : null,
      reachableTiles: structuredClone(state.reachableTiles),
      feedbackTone: state.feedbackTone,
      predictionStatus: state.predictionStatus
    };
  }

  state.world = next.world;
  state.previewPlan = next.movementPlan;
  state.reachableTiles = next.reachableTiles;
  state.feedbackTone = next.tone;
  state.predictionStatus = next.status;
}

function rollbackPendingPrediction(reason?: string): void {
  if (!pendingPrediction) {
    if (reason) {
      state.log.unshift(`Action rejected: ${reason}`);
      state.log = state.log.slice(0, 12);
      state.predictionStatus = "";
    }
    render();
    return;
  }

  state.world = pendingPrediction.world;
  state.battle = pendingPrediction.battle;
  state.previewPlan = pendingPrediction.previewPlan;
  state.reachableTiles = pendingPrediction.reachableTiles;
  state.feedbackTone = pendingPrediction.feedbackTone;
  state.predictionStatus = "";
  pendingPrediction = null;

  if (reason) {
    state.log.unshift(`Action rejected: ${reason}`);
    state.log = state.log.slice(0, 12);
  }

  render();
}

function applyReplayedUpdate(update: SessionUpdate): void {
  clearPendingPrediction();
  state.world = update.world;
  state.battle = update.battle;
  state.previewPlan = null;
  state.reachableTiles = update.reachableTiles;
  state.selectedHeroId = update.world.ownHeroes[0]?.id ?? state.selectedHeroId;
  state.selectedTile = null;
  state.hoveredTile = null;
  state.selectedBattleTargetId = null;
  state.feedbackTone = update.battle ? "battle" : "idle";
  state.pendingBattleAction = null;
  state.predictionStatus = "已回放本地缓存状态，正在等待房间同步...";
  state.log.unshift("已从本地缓存回放最近房间状态");
  state.log = state.log.slice(0, 12);
  pushTimeline([
    {
      id: `${Date.now()}-replay`,
      tone: "sync",
      source: "system",
      text: "已回放本地缓存，等待权威状态同步"
    }
  ]);
  render();
}

function appendLog(update: SessionUpdate): void {
  if (update.reason) {
    state.log.unshift(`Action rejected: ${update.reason}`);
  }

  if (update.movementPlan) {
    state.log.unshift(`Path: ${formatPath(update.movementPlan.path)}`);
  }

  for (const event of update.events.slice().reverse()) {
    if (event.type === "battle.started") {
      const ownedIds = ownedHeroIds(update.world);
      const enemyHeroId =
        event.encounterKind === "hero"
          ? ownedIds.has(event.heroId)
            ? event.defenderHeroId
            : event.heroId
          : undefined;
      state.log.unshift(
        event.encounterKind === "hero"
          ? `Encounter: enemy hero ${enemyHeroId ?? "unknown"}`
          : event.initiator === "neutral"
            ? `Ambushed by neutral: ${event.neutralArmyId}`
            : `Encounter: ${event.neutralArmyId}`
      );
    } else if (event.type === "battle.resolved") {
      state.log.unshift(`Battle resolved: ${didCurrentPlayerWinBattle(event, update.world) ? "victory" : "defeat"}`);
    } else if (event.type === "hero.collected") {
      state.log.unshift(`Collected ${event.resource.kind} +${event.resource.amount}`);
    } else if (event.type === "hero.recruited") {
      state.log.unshift(`Recruited ${event.unitTemplateId} x${event.count}`);
    } else if (event.type === "hero.visited") {
      state.log.unshift(`Visited ${event.buildingId}: ${formatHeroStatBonus(event.bonus)}`);
    } else if (event.type === "hero.claimedMine") {
      state.log.unshift(`Claimed mine: ${formatDailyIncome(event.resourceKind, event.income)}`);
    } else if (event.type === "resource.produced") {
      state.log.unshift(`Mine produced ${formatResourceKindLabel(event.resource.kind)} +${event.resource.amount}`);
    } else if (event.type === "hero.skillLearned") {
      state.log.unshift(
        event.newRank > 1
          ? `Upgraded ${event.skillName} to Rank ${event.newRank}`
          : `Learned ${event.skillName}`
      );
    } else if (event.type === "hero.equipmentFound") {
      state.log.unshift(`Found equipment: ${event.equipmentName}`);
    } else if (event.type === "neutral.moved") {
      state.log.unshift(
        event.reason === "chase"
          ? `Neutral ${event.neutralArmyId} is chasing toward (${event.to.x},${event.to.y})`
          : event.reason === "return"
            ? `Neutral ${event.neutralArmyId} returned toward guard point`
            : `Neutral ${event.neutralArmyId} patrolled to (${event.to.x},${event.to.y})`
      );
    } else if (event.type === "hero.progressed") {
      state.log.unshift(
        event.levelsGained > 0
          ? `Hero gained ${event.experienceGained} XP, reached Lv ${event.level}, and earned ${event.skillPointsAwarded} skill point${event.skillPointsAwarded === 1 ? "" : "s"}`
          : `Hero gained ${event.experienceGained} XP`
      );
    } else if (event.type === "hero.moved") {
      state.log.unshift(`Moved ${event.moveCost} steps`);
    } else if (event.type === "turn.advanced") {
      state.log.unshift(`Day advanced to ${event.day}`);
    }
  }

  state.log = state.log.slice(0, 12);
}

function pushTimeline(entries: TimelineEntry[]): void {
  state.timeline = [...entries.reverse(), ...state.timeline].slice(0, 8);
}

function sourceLabel(source: TimelineEntry["source"]): string {
  if (source === "push") {
    return "房间同步";
  }

  if (source === "local") {
    return "本地操作";
  }

  return "系统";
}

function buildTimelineEntries(update: SessionUpdate, source: TimelineEntry["source"]): TimelineEntry[] {
  const items: TimelineEntry[] = [];
  const stamp = Date.now();
  const ownedIds = ownedHeroIds(update.world);

  if (update.reason) {
    items.push({
      id: `${stamp}-reject`,
      tone: "system",
      source,
      text: `操作被拒绝：${update.reason}`
    });
  }

  if (update.movementPlan && update.movementPlan.travelPath.length > 1) {
    items.push({
      id: `${stamp}-path`,
      tone: "move",
      source,
      text: `沿路径移动 ${update.movementPlan.travelPath.length - 1} 格`
    });
  }

  update.events.forEach((event, index) => {
    if (event.type === "hero.moved") {
      items.push({
        id: `${stamp}-move-${index}`,
        tone: "move",
        source,
        text: `英雄完成移动，消耗 ${event.moveCost} 步`
      });
      return;
    }

    if (event.type === "hero.collected") {
      items.push({
        id: `${stamp}-loot-${index}`,
        tone: "loot",
        source,
        text: `获得 ${event.resource.kind} +${event.resource.amount}`
      });
      return;
    }

    if (event.type === "hero.recruited") {
      items.push({
        id: `${stamp}-recruit-${index}`,
        tone: "loot",
        source,
        text: `在招募所补充 ${event.count} 个 ${event.unitTemplateId}`
      });
      return;
    }

    if (event.type === "hero.visited") {
      items.push({
        id: `${stamp}-visit-${index}`,
        tone: "loot",
        source,
        text: `访问属性建筑，获得 ${formatHeroStatBonus(event.bonus)}`
      });
      return;
    }

    if (event.type === "hero.claimedMine") {
      items.push({
        id: `${stamp}-mine-claim-${index}`,
        tone: "loot",
        source,
        text: `占领资源产出点，改为每日产出 ${formatDailyIncome(event.resourceKind, event.income)}`
      });
      return;
    }

    if (event.type === "hero.equipmentFound") {
      items.push({
        id: `${stamp}-equipment-${index}`,
        tone: "loot",
        source,
        text: `战利品：获得 ${event.equipmentName}`
      });
      return;
    }

    if (event.type === "resource.produced") {
      items.push({
        id: `${stamp}-mine-income-${index}`,
        tone: "loot",
        source,
        text: `${event.buildingId} 产出 ${formatResourceKindLabel(event.resource.kind)} +${event.resource.amount}`
      });
      return;
    }

    if (event.type === "hero.skillLearned") {
      items.push({
        id: `${stamp}-skill-${index}`,
        tone: "system",
        source,
        text:
          event.newRank > 1
            ? `${event.branchName} 分支的 ${event.skillName} 强化到 Rank ${event.newRank}`
            : `${event.branchName} 分支习得 ${event.skillName}`
      });
      return;
    }

    if (event.type === "neutral.moved") {
      items.push({
        id: `${stamp}-neutral-move-${index}`,
        tone: event.reason === "chase" ? "battle" : "move",
        source,
        text:
          event.reason === "chase"
            ? `中立守军 ${event.neutralArmyId} 主动追向 (${event.to.x},${event.to.y})`
            : event.reason === "return"
              ? `中立守军 ${event.neutralArmyId} 返回守位`
              : `中立守军 ${event.neutralArmyId} 沿巡逻路线移动`
      });
      return;
    }

    if (event.type === "hero.progressed") {
      items.push({
        id: `${stamp}-progress-${index}`,
        tone: "system",
        source,
        text:
          event.levelsGained > 0
            ? `英雄获得 ${event.experienceGained} 经验，升至 Lv ${event.level}，并得到 ${event.skillPointsAwarded} 点技能点`
            : `英雄获得 ${event.experienceGained} 经验`
      });
      return;
    }

    if (event.type === "battle.started") {
      items.push({
        id: `${stamp}-battle-start-${index}`,
        tone: "battle",
        source,
        text:
          event.encounterKind === "hero"
            ? ownedIds.has(event.heroId)
              ? "主动接触敌方英雄，进入遭遇战"
              : "被敌方英雄接触，进入遭遇战"
            : event.initiator === "neutral"
              ? "中立守军主动袭来，进入战斗"
              : "接触明雷守军，进入战斗"
      });
      return;
    }

    if (event.type === "battle.resolved") {
      items.push({
        id: `${stamp}-battle-end-${index}`,
        tone: "battle",
        source,
        text: didCurrentPlayerWinBattle(event, update.world) ? "战斗胜利，世界状态已回写" : "战斗失败，英雄被击退"
      });
      return;
    }

    if (event.type === "turn.advanced") {
      items.push({
        id: `${stamp}-day-${index}`,
        tone: "system",
        source,
        text: `推进到第 ${event.day} 天`
      });
    }
  });

  if (source === "push" && items.length === 0 && (update.events.length > 0 || update.movementPlan)) {
    items.push({
      id: `${stamp}-sync`,
      tone: "sync",
      source,
      text: "收到房间状态同步"
    });
  }

  return items;
}

function startPathAnimation(path: Array<{ x: number; y: number }>): void {
  state.animatedPath = path;
  state.animatedPathIndex = -1;

  if (path.length === 0) {
    render();
    return;
  }

  path.forEach((_, index) => {
    window.setTimeout(() => {
      state.animatedPathIndex = index;
      render();
    }, index * 110);
  });

  window.setTimeout(() => {
    state.animatedPath = [];
    state.animatedPathIndex = -1;
    render();
  }, path.length * 110 + 180);
}

function triggerBattleFx(unitId: string | null, floatingText: string | null): void {
  state.battleFx = {
    flashUnitId: unitId,
    floatingText
  };
  render();

  window.setTimeout(() => {
    state.battleFx = {
      flashUnitId: null,
      floatingText: null
    };
    render();
  }, 650);
}

function extractDamageText(lines: string[]): string | null {
  for (const line of [...lines].reverse()) {
    const match = line.match(/造成\s+(\d+)\s+伤害/);
    if (match) {
      return `-${match[1]}`;
    }
  }
  return null;
}

function applyUpdate(update: SessionUpdate, source: TimelineEntry["source"] = "local"): void {
  clearPendingPrediction();
  const hadBattle = Boolean(state.battle);
  const previousBattle = state.battle;
  state.world = update.world;
  state.battle = update.battle;
  state.previewPlan = null;
  const heroId = state.selectedHeroId ?? update.world.ownHeroes[0]?.id ?? "hero-1";
  state.reachableTiles = update.reachableTiles;
  state.selectedHeroId = update.world.ownHeroes[0]?.id ?? state.selectedHeroId;
  if (!update.battle) {
    state.selectedBattleTargetId = null;
  } else {
    const playerCamp = controlledBattleCamp(update.battle, update.world);
    const enemyCamp = opposingBattleCamp(playerCamp);
    const enemies = Object.values(update.battle.units).filter((unit) => unit.camp === enemyCamp && unit.count > 0);
    if (!state.selectedBattleTargetId || !enemies.some((unit) => unit.id === state.selectedBattleTargetId)) {
      state.selectedBattleTargetId = enemies[0]?.id ?? null;
    }
  }
  appendLog(update);
  pushTimeline(buildTimelineEntries(update, source));
  state.feedbackTone = update.events.some(
    (event) =>
      event.type === "hero.collected" ||
      event.type === "hero.recruited" ||
      event.type === "hero.visited" ||
      event.type === "hero.claimedMine" ||
      event.type === "resource.produced" ||
      event.type === "hero.skillLearned" ||
      event.type === "hero.equipmentFound"
  )
    ? "loot"
    : update.events.some(
          (event) =>
            event.type === "battle.started" ||
            event.type === "battle.resolved" ||
            (event.type === "neutral.moved" && event.reason === "chase")
        )
      ? "battle"
      : update.events.some((event) => event.type === "hero.moved" || event.type === "neutral.moved")
        ? "move"
        : "idle";

  if (update.movementPlan) {
    startPathAnimation(update.movementPlan.travelPath);
  }

  if (state.pendingBattleAction?.type === "battle.attack" && previousBattle && update.battle) {
    triggerBattleFx(state.pendingBattleAction.defenderId, extractDamageText(update.battle.log));
  } else if (state.pendingBattleAction?.type === "battle.defend" && update.battle) {
    triggerBattleFx(state.pendingBattleAction.unitId, "DEF");
  } else if (state.pendingBattleAction?.type === "battle.wait" && update.battle) {
    triggerBattleFx(state.pendingBattleAction.unitId, "WAIT");
  } else if (state.pendingBattleAction?.type === "battle.skill" && update.battle) {
    const targetUnitId = state.pendingBattleAction.targetId ?? state.pendingBattleAction.unitId;
    const isEnemyTargeted = targetUnitId !== state.pendingBattleAction.unitId;
    triggerBattleFx(
      targetUnitId,
      isEnemyTargeted ? extractDamageText(update.battle.log) ?? "SKILL" : "BUFF"
    );
  }

  state.pendingBattleAction = null;

  const resolved = update.events.find(isBattleEvent);
  if (resolved?.type === "battle.resolved") {
    const rewardEvent = update.events.find((event) => event.type === "hero.collected");
    const progressEvent = update.events.find((event) => event.type === "hero.progressed");
    const equipmentEvent = update.events.find((event) => event.type === "hero.equipmentFound");
    const didWin = didCurrentPlayerWinBattle(resolved, update.world);
    const winBody = resolved.defenderHeroId
      ? `你已击败敌方英雄。${equipmentEvent?.type === "hero.equipmentFound" ? `缴获 ${equipmentEvent.equipmentName}。` : ""}${progressEvent?.type === "hero.progressed" ? `获得 ${progressEvent.experienceGained} 经验${progressEvent.levelsGained > 0 ? `，升至 Lv ${progressEvent.level}，并得到 ${progressEvent.skillPointsAwarded} 点技能点` : ""}。` : ""}`
      : `你已击败守军。${rewardEvent?.type === "hero.collected" ? `获得 ${rewardEvent.resource.kind} +${rewardEvent.resource.amount}。` : ""}${equipmentEvent?.type === "hero.equipmentFound" ? `拾取 ${equipmentEvent.equipmentName}。` : ""}${progressEvent?.type === "hero.progressed" ? `获得 ${progressEvent.experienceGained} 经验${progressEvent.levelsGained > 0 ? `，升至 Lv ${progressEvent.level}，并得到 ${progressEvent.skillPointsAwarded} 点技能点` : ""}。` : ""}`;
    openBattleModal(
      didWin ? "战斗胜利" : "战斗失败",
      didWin ? winBody : "英雄被击退，生命值下降且本日移动力清零。"
    );
  } else if (hadBattle && !update.battle && update.events.length === 0) {
    openBattleModal("战斗结束", "本场遭遇已结束。");
  }

  if (
    update.events.some(
      (event) =>
        event.type === "battle.started" ||
        event.type === "battle.resolved" ||
        event.type === "hero.skillLearned" ||
        event.type === "hero.equipmentFound"
    )
  ) {
    void refreshAccountProfileFromServer();
  }

  render();
}

async function refreshAccountProfileFromServer(): Promise<void> {
  if (accountRefreshPromise) {
    return accountRefreshPromise;
  }

  accountRefreshPromise = (async () => {
    const account = await loadAccountProfile(playerId, roomId);
    state.account = account;
    if (!state.accountSaving) {
      state.accountDraftName = account.displayName;
    }
    render();
  })().finally(() => {
    accountRefreshPromise = null;
  });

  return accountRefreshPromise;
}

async function previewTile(x: number, y: number): Promise<void> {
  state.hoveredTile = { x, y };
  const hero = activeHero();
  if (!hero || state.battle) {
    state.previewPlan = null;
    render();
    return;
  }

  const session = await getSession();
  state.previewPlan = await session.previewMovement(hero.id, { x, y });
  render();
}

function clearPreview(): void {
  state.hoveredTile = null;
  state.previewPlan = null;
  render();
}

async function onTileClick(x: number, y: number): Promise<void> {
  state.selectedTile = { x, y };
  const hero = activeHero();
  if (!hero || state.battle) {
    render();
    return;
  }

  const targetTile = state.world.map.tiles.find((tile) => tile.position.x === x && tile.position.y === y) ?? null;
  const session = await getSession();
  if (hero.position.x === x && hero.position.y === y) {
    if (targetTile?.building) {
      const buildingAction =
        targetTile.building.kind === "recruitment_post"
          ? ({
              type: "hero.recruit",
              heroId: hero.id,
              buildingId: targetTile.building.id
            } as const)
          : targetTile.building.kind === "attribute_shrine"
            ? ({
                type: "hero.visit",
                heroId: hero.id,
                buildingId: targetTile.building.id
              } as const)
            : ({
                type: "hero.claimMine",
                heroId: hero.id,
                buildingId: targetTile.building.id
              } as const);
      const prediction = predictPlayerWorldAction(state.world, buildingAction);

      if (!prediction.reason) {
        applyPendingPrediction({
          world: prediction.world,
          movementPlan: prediction.movementPlan,
          reachableTiles: prediction.reachableTiles,
          status:
            targetTile.building.kind === "recruitment_post"
              ? `预演中：在 ${targetTile.building.label} 招募 ${targetTile.building.availableCount} 单位`
              : targetTile.building.kind === "attribute_shrine"
                ? `预演中：访问 ${targetTile.building.label}，获得 ${formatHeroStatBonus(targetTile.building.bonus)}`
                : `预演中：占领 ${targetTile.building.label}，改为每日产出 ${formatDailyIncome(targetTile.building.resourceKind, targetTile.building.income)}`,
          tone: "loot"
        });
        render();
      }

      try {
        applyUpdate(
          targetTile.building.kind === "recruitment_post"
            ? await session.recruit(hero.id, targetTile.building.id)
            : targetTile.building.kind === "attribute_shrine"
              ? await session.visitBuilding(hero.id, targetTile.building.id)
              : await session.claimMine(hero.id, targetTile.building.id)
        );
      } catch (error) {
        rollbackPendingPrediction(
          error instanceof Error
            ? error.message
            : targetTile.building.kind === "recruitment_post"
              ? "recruit_failed"
              : targetTile.building.kind === "attribute_shrine"
                ? "visit_failed"
                : "claim_failed"
        );
      }
      return;
    }

    if (targetTile?.resource) {
      const prediction = predictPlayerWorldAction(state.world, {
        type: "hero.collect",
        heroId: hero.id,
        position: { x, y }
      });

      if (!prediction.reason) {
        applyPendingPrediction({
          world: prediction.world,
          movementPlan: prediction.movementPlan,
          reachableTiles: prediction.reachableTiles,
          status: `预演中：拾取 ${targetTile.resource.kind} +${targetTile.resource.amount}`,
          tone: "loot"
        });
        render();
      }
    }

    if (targetTile?.resource) {
      try {
        applyUpdate(await session.collect(hero.id, { x, y }));
      } catch (error) {
        rollbackPendingPrediction(error instanceof Error ? error.message : "collect_failed");
      }
    } else {
      render();
    }
    return;
  }

  const prediction = predictPlayerWorldAction(state.world, {
    type: "hero.move",
    heroId: hero.id,
    destination: { x, y }
  });

  if (!prediction.reason) {
    applyPendingPrediction({
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles,
      status: prediction.movementPlan?.endsInEncounter ? "预演中：接敌并等待战斗快照..." : "预演中：移动已提交，等待服务器确认...",
      tone: prediction.movementPlan?.endsInEncounter ? "battle" : "move"
    });
    render();
  }

  try {
    applyUpdate(await session.moveHero(hero.id, { x, y }));
  } catch (error) {
    rollbackPendingPrediction(error instanceof Error ? error.message : "move_failed");
  }
}

async function onEndDay(): Promise<void> {
  if (state.battle) {
    state.predictionStatus = "战斗中无法推进天数";
    render();
    return;
  }

  state.predictionStatus = "正在推进到下一天...";
  render();

  try {
    const session = await getSession();
    applyUpdate(await session.endDay());
  } catch (error) {
    state.predictionStatus = error instanceof Error ? error.message : "end_day_failed";
    render();
  }
}

async function onLearnHeroSkill(skillId: string): Promise<void> {
  const hero = activeHero();
  if (!hero) {
    return;
  }

  if (state.battle) {
    state.predictionStatus = "战斗中无法调整技能树";
    render();
    return;
  }

  const tree = createHeroSkillTreeView(hero);
  const selectedSkill = tree.branches.flatMap((branch) => branch.skills).find((skill) => skill.id === skillId) ?? null;
  if (!selectedSkill) {
    state.predictionStatus = "未找到对应技能";
    render();
    return;
  }

  const session = await getSession();
  const prediction = predictPlayerWorldAction(state.world, {
    type: "hero.learnSkill",
    heroId: hero.id,
    skillId
  });

  if (!prediction.reason) {
    applyPendingPrediction({
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles,
      status:
        selectedSkill.currentRank > 0
          ? `预演中：将 ${selectedSkill.name} 强化到 Rank ${selectedSkill.nextRank}`
          : `预演中：学习 ${selectedSkill.name}`,
      tone: "loot"
    });
    render();
  }

  try {
    applyUpdate(await session.learnSkill(hero.id, skillId));
  } catch (error) {
    rollbackPendingPrediction(error instanceof Error ? error.message : "learn_skill_failed");
  }
}

async function onEquipHeroItem(slot: EquipmentType, equipmentId: string): Promise<void> {
  const hero = activeHero();
  if (!hero) {
    return;
  }

  if (state.battle) {
    state.predictionStatus = "战斗中无法调整装备";
    render();
    return;
  }

  const definition = getEquipmentDefinition(equipmentId);
  const session = await getSession();
  const prediction = predictPlayerWorldAction(state.world, {
    type: "hero.equip",
    heroId: hero.id,
    slot,
    equipmentId
  });

  if (!prediction.reason) {
    applyPendingPrediction({
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles,
      status: `预演中：装备 ${definition?.name ?? equipmentId}`,
      tone: "loot"
    });
    render();
  }

  try {
    applyUpdate(await session.equipHeroItem(hero.id, slot, equipmentId));
  } catch (error) {
    rollbackPendingPrediction(
      error instanceof Error ? formatEquipmentActionReason(error.message) : "equip_item_failed"
    );
  }
}

async function onUnequipHeroItem(slot: EquipmentType): Promise<void> {
  const hero = activeHero();
  if (!hero) {
    return;
  }

  if (state.battle) {
    state.predictionStatus = "战斗中无法调整装备";
    render();
    return;
  }

  const session = await getSession();
  const prediction = predictPlayerWorldAction(state.world, {
    type: "hero.unequip",
    heroId: hero.id,
    slot
  });

  if (!prediction.reason) {
    applyPendingPrediction({
      world: prediction.world,
      movementPlan: prediction.movementPlan,
      reachableTiles: prediction.reachableTiles,
      status: "预演中：卸下装备",
      tone: "loot"
    });
    render();
  }

  try {
    applyUpdate(await session.unequipHeroItem(hero.id, slot));
  } catch (error) {
    rollbackPendingPrediction(
      error instanceof Error ? formatEquipmentActionReason(error.message) : "unequip_item_failed"
    );
  }
}

async function onBattleAction(action: BattleAction): Promise<void> {
  state.pendingBattleAction = action;
  const session = await getSession();
  applyUpdate(await session.actInBattle(action));
}

async function refreshLobbyRoomList(): Promise<void> {
  state.lobby.loading = true;
  state.lobby.status = "正在刷新可加入房间...";
  render();

  try {
    const rooms = await loadLobbyRooms();
    state.lobby.rooms = rooms;
    state.lobby.loading = false;
    state.lobby.status =
      rooms.length > 0 ? `发现 ${rooms.length} 个活跃房间，可直接加入或继续创建新房间。` : "当前没有活跃房间，输入房间 ID 后即可直接创建新实例。";
  } catch {
    state.lobby.rooms = [];
    state.lobby.loading = false;
    state.lobby.status = "Lobby 服务暂不可达；仍可直接输入房间 ID，进入时会自动尝试远端房间并在失败后回退本地模式。";
  }

  render();
}

async function enterLobbyRoom(roomIdOverride?: string): Promise<void> {
  const preferences = saveLobbyPreferences(state.lobby.playerId, roomIdOverride ?? state.lobby.roomId);
  const displayName = rememberPreferredPlayerDisplayName(preferences.playerId, state.lobby.displayName);
  state.lobby.playerId = preferences.playerId;
  state.lobby.roomId = preferences.roomId;
  state.lobby.displayName = displayName;
  state.lobby.entering = true;
  state.lobby.status = `正在登录游客账号并进入房间 ${preferences.roomId}...`;
  render();

  const authSession = await loginGuestAuthSession(preferences.playerId, displayName);
  state.lobby.authSession = authSession;
  state.lobby.playerId = authSession.playerId;
  state.lobby.displayName = authSession.displayName;
  state.lobby.status =
    authSession.source === "remote"
      ? `游客登录成功，正在进入房间 ${preferences.roomId}...`
      : `登录服务暂不可达，正在以本地游客档进入房间 ${preferences.roomId}...`;
  saveLobbyPreferences(authSession.playerId, preferences.roomId);

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("roomId", preferences.roomId);
  nextUrl.searchParams.delete("playerId");
  window.location.assign(nextUrl.toString());
}

async function loginLobbyAccount(roomIdOverride?: string): Promise<void> {
  const preferences = saveLobbyPreferences(state.lobby.playerId, roomIdOverride ?? state.lobby.roomId);
  const loginId = state.lobby.loginId.trim().toLowerCase();
  if (!loginId) {
    state.lobby.status = "请输入登录 ID 后再使用口令登录。";
    render();
    return;
  }

  if (!state.lobby.password.trim()) {
    state.lobby.status = "请输入账号口令后再登录。";
    render();
    return;
  }

  state.lobby.entering = true;
  state.lobby.status = `正在使用账号 ${loginId} 登录并进入房间 ${preferences.roomId}...`;
  render();

  try {
    const authSession = await loginPasswordAuthSession(loginId, state.lobby.password);
    state.lobby.authSession = authSession;
    state.lobby.playerId = authSession.playerId;
    state.lobby.displayName = authSession.displayName;
    state.lobby.loginId = authSession.loginId ?? loginId;
    state.lobby.password = "";
    state.accountLoginId = authSession.loginId ?? loginId;
    state.accountPassword = "";
    state.lobby.status = `账号登录成功，正在进入房间 ${preferences.roomId}...`;
    saveLobbyPreferences(authSession.playerId, preferences.roomId);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("roomId", preferences.roomId);
    nextUrl.searchParams.delete("playerId");
    window.location.assign(nextUrl.toString());
  } catch (error) {
    state.lobby.entering = false;
    state.lobby.status =
      error instanceof Error && error.message === "auth_request_failed:401"
        ? "登录 ID 或口令不正确，请检查后重试。"
        : error instanceof Error
          ? error.message
          : "account_login_failed";
    render();
  }
}

function returnToLobby(): void {
  saveLobbyPreferences(playerId, roomId);
  rememberPreferredPlayerDisplayName(playerId, state.accountDraftName);
  const nextUrl = new URL(window.location.href);
  nextUrl.search = "";
  window.location.assign(nextUrl.toString());
}

function logoutGuestSession(): void {
  clearCurrentAuthSession();
  state.lobby.authSession = null;
  state.lobby.loginId = "";
  state.lobby.password = "";
  state.lobby.entering = false;
  state.lobby.status = "已退出当前游客会话，请重新选择或创建一个账号进入房间。";
  const nextUrl = new URL(window.location.href);
  nextUrl.search = "";
  window.location.assign(nextUrl.toString());
}

function renderBattleActions(): string {
  if (!state.battle || !state.battle.activeUnitId) {
    return `<div class="battle-actions muted" data-testid="battle-actions">当前没有战斗</div>`;
  }

  const active = state.battle.units[state.battle.activeUnitId];
  const playerCamp = controlledBattleCamp(state.battle);
  if (!active) {
    return `<div class="battle-actions muted" data-testid="battle-actions">当前没有可行动单位</div>`;
  }

  if (!playerCamp) {
    return `<div class="battle-actions muted" data-testid="battle-actions">当前无法操作这场战斗</div>`;
  }

  if (active.camp !== playerCamp) {
    return `<div class="battle-actions muted" data-testid="battle-actions">${state.battle.defenderHeroId ? "等待对手操作" : "敌方回合自动执行"}</div>`;
  }

  const enemyCamp = opposingBattleCamp(playerCamp);
  const enemies = Object.values(state.battle.units).filter((unit) => unit.camp === enemyCamp && unit.count > 0);
  const selectedTarget = enemies.find((enemy) => enemy.id === state.selectedBattleTargetId) ?? enemies[0];
  const skillButtons = (active.skills ?? [])
    .filter((skill) => skill.kind === "active")
    .map((skill) => {
      const targetId = skill.target === "enemy" ? (selectedTarget?.id ?? "") : active.id;
      const enabled = skill.target === "enemy" ? Boolean(selectedTarget) && skill.remainingCooldown === 0 : skill.remainingCooldown === 0;
      const labelSuffix =
        skill.target === "enemy"
          ? selectedTarget
            ? ` -> ${selectedTarget.stackName}`
            : " -> 请选择目标"
          : " -> 自身";
      return `
        <button
          data-testid="battle-skill-${skill.id}"
          data-battle-action="skill"
          data-skill-id="${skill.id}"
          data-unit="${active.id}"
          data-target="${targetId}"
          ${enabled ? "" : "disabled"}
          title="${skill.description}"
        >
          ${skill.name}${skill.remainingCooldown > 0 ? ` (${skill.remainingCooldown})` : ""}${labelSuffix}
        </button>
      `;
    })
    .join("");

  return `
    <div class="battle-actions" data-testid="battle-actions">
      <button data-testid="battle-attack" data-battle-action="attack" data-attacker="${active.id}" data-defender="${selectedTarget?.id ?? ""}" ${selectedTarget ? "" : "disabled"}>
        ${selectedTarget ? `攻击 ${selectedTarget.stackName}` : "无可攻击目标"}
      </button>
      ${skillButtons}
      <button data-testid="battle-wait" data-battle-action="wait" data-unit="${active.id}">等待</button>
      <button data-testid="battle-defend" data-battle-action="defend" data-unit="${active.id}" ${active.defending ? "disabled" : ""}>防御</button>
    </div>
  `;
}

function renderBattleIntelPanel(): string {
  if (!state.battle) {
    return `
      <div class="battle-intel info-card" data-testid="battle-intel">
        <div class="battle-intel-headline">
          <strong>战术情报</strong>
          <span>进入战斗后，这里会展开显示技能、状态和冷却说明。</span>
        </div>
      </div>
    `;
  }

  const playerCamp = controlledBattleCamp(state.battle) ?? "attacker";
  const enemyCamp = opposingBattleCamp(playerCamp) ?? "defender";
  const activeUnit = state.battle.activeUnitId ? state.battle.units[state.battle.activeUnitId] ?? null : null;
  const enemies = Object.values(state.battle.units).filter((unit) => unit.camp === enemyCamp && unit.count > 0);
  const selectedTarget = enemies.find((unit) => unit.id === state.selectedBattleTargetId) ?? enemies[0] ?? null;
  const activeBadge =
    activeUnit?.count && activeUnit.count > 0
      ? activeUnit.camp === playerCamp
        ? "我方行动"
        : "敌方行动"
      : "等待中";

  return `
    <section class="battle-intel" data-testid="battle-intel">
      <div class="battle-intel-headline">
        <strong>战术情报</strong>
        <span>把当前行动单位和锁定目标的技能、状态、冷却都摊开来看。</span>
      </div>
      <div class="battle-intel-grid">
        ${renderBattleIntelCard("当前行动单位", "Turn Actor", activeBadge, activeUnit, "当前没有可行动单位。")}
        ${renderBattleIntelCard("已锁定目标", "Target Focus", selectedTarget ? "已锁定" : "未锁定", selectedTarget, "请选择一个敌方目标后查看详细说明。")}
      </div>
      ${renderBattleDetailGroup(
        "战场环境",
        (state.battle.environment ?? []).map(renderBattleHazardDetail),
        "当前战场没有额外障碍或陷阱。"
      )}
    </section>
  `;
}

function renderBattlefield(): string {
  if (!state.battle) {
    return `<div class="battle-empty" data-testid="battle-empty">No active battle</div>`;
  }

  const playerCamp = controlledBattleCamp(state.battle) ?? "attacker";
  const enemyCamp = opposingBattleCamp(playerCamp) ?? "defender";
  const friendlies = Object.values(state.battle.units).filter((unit) => unit.camp === playerCamp);
  const enemies = Object.values(state.battle.units).filter((unit) => unit.camp === enemyCamp);
  const activeId = state.battle.activeUnitId;
  const campLabel = (camp: "attacker" | "defender") => (camp === playerCamp ? "我方" : "敌方");
  const unitStatusLabel = (unitId: string, unitCount: number, camp: "attacker" | "defender", active: boolean) => {
    if (unitCount <= 0) {
      return "已阵亡";
    }

    if (active) {
      return "当前行动";
    }

    return campLabel(camp);
  };

  const renderUnit = (unitId: string) => {
    const unit = state.battle!.units[unitId]!;
    const isActive = activeId === unit.id;
    const isDead = unit.count <= 0;
    const isSelectable = unit.camp === enemyCamp && unit.count > 0;
    const isSelected = state.selectedBattleTargetId === unit.id;
    const isFlashing = state.battleFx.flashUnitId === unit.id;
    const portraitSrc =
      unitAsset(unit.templateId, isFlashing ? "hit" : isSelected || isActive ? "selected" : "idle") ??
      markerAsset(unit.camp === "attacker" ? "hero" : "neutral", isFlashing ? "hit" : isSelected ? "selected" : "idle");
    const frameSrc = unitFrameAsset(unit.templateId);
    const badgeSrc = unitBadgeAssets(unit.templateId);
    const statusLine = (unit.statusEffects ?? [])
      .map((status) => `${status.name} ${status.durationRemaining}`)
      .join(" · ");

    return `
      <button
        class="unit-card ${unit.camp} ${isActive ? "is-active" : ""} ${isDead ? "is-dead" : ""} ${isSelected ? "is-selected" : ""} ${isFlashing ? "is-flashing" : ""}"
        data-testid="battle-unit-${unit.id}"
        ${isSelectable ? `data-target-unit="${unit.id}"` : "disabled"}
      >
        <div class="unit-portrait-wrap info-card-media">
          <img class="unit-portrait" src="${portraitSrc}" alt="${unit.stackName}" />
          ${frameSrc ? `<img class="unit-frame" src="${frameSrc}" alt="" aria-hidden="true" />` : ""}
          ${badgeSrc.faction ? `<img class="unit-badge unit-badge-faction" src="${badgeSrc.faction}" alt="" aria-hidden="true" />` : ""}
          ${badgeSrc.rarity ? `<img class="unit-badge unit-badge-rarity" src="${badgeSrc.rarity}" alt="" aria-hidden="true" />` : ""}
        </div>
        <div class="info-card-copy">
          <div class="info-card-head">
            <div>
              <div class="info-card-eyebrow">${campLabel(unit.camp)}</div>
              <span class="unit-name">${unit.stackName}</span>
            </div>
            <span class="status-pill">${unitStatusLabel(unit.id, unit.count, unit.camp, isActive)}</span>
          </div>
          <div class="meta-row">
            <span class="unit-meta">x${unit.count}</span>
            <span class="unit-meta">HP ${unit.currentHp}/${unit.maxHp}</span>
          </div>
          <div class="meta-row">
            <span class="unit-meta">线位 ${unit.lane + 1}</span>
          </div>
          <div class="meta-row">
            <span class="unit-meta">ATK ${unit.attack}</span>
            <span class="unit-meta">DEF ${unit.defense}${unit.defending ? " · DEFEND" : ""}</span>
          </div>
          ${statusLine ? `<div class="meta-row"><span class="unit-meta">${statusLine}</span></div>` : ""}
        </div>
        ${isFlashing && state.battleFx.floatingText ? `<span class="floating-text">${state.battleFx.floatingText}</span>` : ""}
      </button>
    `;
  };

  return `
    <div class="battlefield">
      <div class="battle-lane">
        <div class="lane-title">我方部队</div>
        <div class="unit-grid">${friendlies.map((unit) => renderUnit(unit.id)).join("")}</div>
      </div>
      <div class="battle-turn-banner">
        <strong>Round ${state.battle.round}</strong>
        <span>${activeId ? `当前单位：${state.battle.units[activeId]?.stackName ?? activeId}` : "等待结算"}</span>
      </div>
      <div class="battle-lane">
        <div class="lane-title">敌方部队</div>
        <div class="unit-grid">${enemies.map((unit) => renderUnit(unit.id)).join("")}</div>
      </div>
    </div>
  `;
}

function renderBattleLog(): string {
  if (!state.battle) {
    return `<div class="battle-log muted" data-testid="battle-log">尚未进入战斗</div>`;
  }

  const lines = state.battle.log.slice(-6).reverse();
  return `<div class="battle-log" data-testid="battle-log">${lines.map((line) => `<div class="battle-log-line">${line}</div>`).join("")}</div>`;
}

function renderTimeline(): string {
  if (state.timeline.length === 0) {
    return `<div class="timeline-panel muted">等待玩家操作或房间同步...</div>`;
  }

  return `
    <div class="timeline-panel">
      ${state.timeline
        .map(
          (item) => `
            <div class="timeline-item tone-${item.tone}">
              <span class="timeline-source">${sourceLabel(item.source)}</span>
              <strong>${item.text}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderModal(): string {
  if (!state.modal.visible) {
    return "";
  }

  return `
    <div class="modal-backdrop" data-testid="battle-modal-backdrop" data-close-modal="true">
      <div class="modal-card" data-testid="battle-modal" role="dialog" aria-modal="true">
        <div class="eyebrow">Battle Report</div>
        <h2 data-testid="battle-modal-title">${state.modal.title}</h2>
        <p data-testid="battle-modal-body">${state.modal.body}</p>
        <button class="modal-button" data-testid="battle-modal-close" data-close-modal="true">关闭</button>
      </div>
    </div>
  `;
}

function renderLobby(): string {
  const roomFieldMarkup = `
    <label class="lobby-field">
      <span>房间 ID</span>
      <input
        class="account-input"
        data-lobby-room-id="true"
        maxlength="40"
        value="${escapeHtml(state.lobby.roomId)}"
        placeholder="room-alpha"
        ${state.lobby.entering ? "disabled" : ""}
      />
    </label>
  `;
  const roomsMarkup =
    state.lobby.rooms.length === 0
      ? `
        <div class="lobby-room-empty info-card">
          <strong>当前没有活跃房间</strong>
          <span>输入房间 ID 后点击“进入房间”，即可创建一个新的独立实例。</span>
        </div>
      `
      : state.lobby.rooms
          .map(
            (room) => `
              <button
                class="lobby-room-card info-card"
                data-join-room="${escapeHtml(room.roomId)}"
                ${state.lobby.entering ? "disabled" : ""}
              >
                <div class="lobby-room-card-head">
                  <div>
                    <div class="info-card-eyebrow">Instance</div>
                    <strong>${escapeHtml(room.roomId)}</strong>
                  </div>
                  <span class="status-pill">Day ${room.day}</span>
                </div>
                <div class="meta-row">
                  <span class="battle-intel-chip">玩家 ${room.connectedPlayers}</span>
                  <span class="battle-intel-chip">英雄 ${room.heroCount}</span>
                  <span class="battle-intel-chip">战斗 ${room.activeBattles}</span>
                  <span class="battle-intel-chip">Seed ${room.seed}</span>
                </div>
                <span class="lobby-room-meta">最近刷新：${escapeHtml(formatLobbyRoomUpdatedAt(room.updatedAt))}</span>
              </button>
            `
          )
          .join("");

  return `
    <main class="lobby-shell">
      <section class="lobby-hero-panel">
        <div class="eyebrow">Project Veil</div>
        <h1>大厅 / 登录入口</h1>
        <p class="lead">这里负责进入真实房间，而不是再靠手写 URL。现在除了游客档，也能把当前进度绑定成口令账号并直接登录。</p>
        <div class="lobby-hero-copy info-card">
          <div class="info-card-copy">
            <div class="info-card-head">
              <div>
                <div class="info-card-eyebrow">Session Mode</div>
                <strong>${escapeHtml(formatAuthModeLabel(state.lobby.authSession))}</strong>
              </div>
              <span class="status-pill">${state.lobby.authSession?.authMode === "account" ? "Account" : "Guest"}</span>
            </div>
            <span>
              ${
                state.lobby.authSession?.authMode === "account"
                  ? "已缓存口令账号会话，可直接刷新房间列表后进房，也可以退出后切回游客入口。"
                  : "游客身份仍会保留，但现在可以在游戏内把它绑定成登录 ID + 口令，后续直接用账号模式进入。"
              }
            </span>
          </div>
        </div>
      </section>
      <section class="lobby-panel">
        <div class="panel-head">
          <h2>进入房间</h2>
          <div class="hint">可选已有房间，也可手动输入创建新实例</div>
        </div>
        <div class="lobby-form info-card">
          ${roomFieldMarkup}
          <div class="lobby-auth-grid">
            <section class="lobby-auth-card">
              <div class="lobby-auth-head">
                <strong>游客进入</strong>
                <span>创建或继续一个游客档</span>
              </div>
              <label class="lobby-field">
                <span>玩家 ID</span>
                <input
                  class="account-input"
                  data-lobby-player-id="true"
                  maxlength="40"
                  value="${escapeHtml(state.lobby.playerId)}"
                  placeholder="guest-000001"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <label class="lobby-field">
                <span>昵称</span>
                <input
                  class="account-input"
                  data-lobby-display-name="true"
                  maxlength="40"
                  value="${escapeHtml(state.lobby.displayName)}"
                  placeholder="输入昵称"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <button class="account-save" data-enter-room="true" ${state.lobby.entering ? "disabled" : ""}>
                ${state.lobby.entering ? "进入中..." : "游客进入房间"}
              </button>
            </section>
            <section class="lobby-auth-card">
              <div class="lobby-auth-head">
                <strong>账号登录</strong>
                <span>使用已绑定的登录 ID + 口令</span>
              </div>
              <label class="lobby-field">
                <span>登录 ID</span>
                <input
                  class="account-input"
                  data-lobby-login-id="true"
                  maxlength="40"
                  value="${escapeHtml(state.lobby.loginId)}"
                  placeholder="veil-ranger"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <label class="lobby-field">
                <span>账号口令</span>
                <input
                  class="account-input"
                  data-lobby-password="true"
                  type="password"
                  maxlength="80"
                  value="${escapeHtml(state.lobby.password)}"
                  placeholder="至少 6 位"
                  ${state.lobby.entering ? "disabled" : ""}
                />
              </label>
              <button class="account-save" data-login-account="true" ${state.lobby.entering ? "disabled" : ""}>
                ${state.lobby.entering ? "登录中..." : "账号登录并进房"}
              </button>
            </section>
          </div>
          <div class="lobby-actions">
            <button class="account-save" data-refresh-lobby="true" ${state.lobby.loading || state.lobby.entering ? "disabled" : ""}>
              ${state.lobby.loading ? "刷新中..." : "刷新房间"}
            </button>
            ${
              state.lobby.authSession
                ? `<button class="session-link" data-logout-guest="true" ${state.lobby.entering ? "disabled" : ""}>退出当前会话</button>`
                : ""
            }
          </div>
          ${
            state.lobby.authSession
              ? `<p class="account-meta">已缓存${state.lobby.authSession.source === "remote" ? "云端" : "本地"}会话：${escapeHtml(
                  state.lobby.authSession.playerId
                )}${state.lobby.authSession.loginId ? ` / ${escapeHtml(state.lobby.authSession.loginId)}` : ""}</p>`
              : ""
          }
          <p class="muted account-status">${escapeHtml(state.lobby.status)}</p>
        </div>
        <div class="panel-head">
          <h2>活跃房间</h2>
          <div class="hint">${state.lobby.rooms.length} 个实例</div>
        </div>
        <div class="lobby-room-list">${roomsMarkup}</div>
      </section>
    </main>
  `;
}

function render(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    return;
  }

  if (!shouldBootGame) {
    root.innerHTML = renderLobby();

    for (const playerIdInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-player-id]"))) {
      playerIdInput.addEventListener("input", () => {
        const previousSuggestedName = state.lobby.playerId.trim()
          ? readLocalPreferredDisplayName(state.lobby.playerId)
          : "";
        const nextPlayerId = playerIdInput.value;
        state.lobby.playerId = nextPlayerId;

        if (!state.lobby.displayName.trim() || state.lobby.displayName === previousSuggestedName) {
          state.lobby.displayName = nextPlayerId.trim() ? readLocalPreferredDisplayName(nextPlayerId) : "";
          const displayNameField = root.querySelector<HTMLInputElement>("[data-lobby-display-name]");
          if (displayNameField) {
            displayNameField.value = state.lobby.displayName;
          }
        }
      });
      playerIdInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        void enterLobbyRoom();
      });
    }

    for (const displayNameInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-display-name]"))) {
      displayNameInput.addEventListener("input", () => {
        state.lobby.displayName = displayNameInput.value;
      });
      displayNameInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        void enterLobbyRoom();
      });
    }

    for (const loginIdInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-login-id]"))) {
      loginIdInput.addEventListener("input", () => {
        state.lobby.loginId = loginIdInput.value;
      });
      loginIdInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        void loginLobbyAccount();
      });
    }

    for (const passwordInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-password]"))) {
      passwordInput.addEventListener("input", () => {
        state.lobby.password = passwordInput.value;
      });
      passwordInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        void loginLobbyAccount();
      });
    }

    for (const roomIdInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-lobby-room-id]"))) {
      roomIdInput.addEventListener("input", () => {
        state.lobby.roomId = roomIdInput.value;
      });
      roomIdInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || state.lobby.entering) {
          return;
        }

        event.preventDefault();
        if (state.lobby.loginId.trim() && state.lobby.password.trim()) {
          void loginLobbyAccount();
          return;
        }

        void enterLobbyRoom();
      });
    }

    for (const refreshButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-refresh-lobby]"))) {
      refreshButton.addEventListener("click", () => {
        void refreshLobbyRoomList();
      });
    }

    for (const enterButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-enter-room]"))) {
      enterButton.addEventListener("click", () => {
        void enterLobbyRoom();
      });
    }

    for (const loginButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-login-account]"))) {
      loginButton.addEventListener("click", () => {
        void loginLobbyAccount();
      });
    }

    for (const roomButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-join-room]"))) {
      roomButton.addEventListener("click", () => {
        if (state.lobby.loginId.trim() && state.lobby.password.trim()) {
          void loginLobbyAccount(roomButton.dataset.joinRoom);
          return;
        }

        void enterLobbyRoom(roomButton.dataset.joinRoom);
      });
    }

    for (const logoutButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-logout-guest]"))) {
      logoutButton.addEventListener("click", () => {
        logoutGuestSession();
      });
    }

    return;
  }

  const hero = activeHero();
  const hoveredTile = hoveredTileData();
  const hoveredObject = describeTileObject(hoveredTile);
  const hoveredBadges = objectBadgeAssets(hoveredObject);
  const interactionLabel = (interactionType: string | null | undefined) => {
    if (interactionType === "battle") {
      return "战斗交互";
    }

    if (interactionType === "pickup") {
      return "拾取交互";
    }

    return "移动交互";
  };
  const grid = state.world.map.tiles
    .map((tile, index) => {
      const selected = state.selectedTile?.x === tile.position.x && state.selectedTile?.y === tile.position.y;
      const hovered = state.hoveredTile?.x === tile.position.x && state.hoveredTile?.y === tile.position.y;
      const isHero = hero && hero.position.x === tile.position.x && hero.position.y === tile.position.y;
        const classes = [
          "tile",
          `fog-${tile.fog}`,
        selected ? "is-selected" : "",
        hovered ? "is-hovered" : "",
        isHero ? "is-hero" : "",
          tile.occupant?.kind === "neutral" ? "is-neutral" : "",
          isReachableTile(tile.position.x, tile.position.y) ? "is-reachable" : "",
          isPreviewNode(tile.position.x, tile.position.y) ? "is-preview" : "",
          isTravelNode(tile.position.x, tile.position.y) ? "is-travel" : "",
          isAnimatedNode(tile.position.x, tile.position.y) ? "is-animated" : ""
        ]
        .filter(Boolean)
        .join(" ");

      return `<button class="${classes}" data-x="${tile.position.x}" data-y="${tile.position.y}" aria-label="tile-${index}">
        <span class="tile-media">${renderTileMedia(tile)}</span>
        <span class="tile-label">${tileLabel(tile)}</span>
        <span class="tile-coord">${tile.position.x},${tile.position.y}</span>
      </button>`;
    })
    .join("");

  root.innerHTML = `
    <main class="shell">
      <section class="hero-panel">
        <div class="eyebrow">Project Veil</div>
        <h1>H5 调试壳</h1>
        <p class="lead">这里保留给浏览器调试、配置联调和回归验证使用；主客户端运行时已切到 Cocos Creator。</p>
        <div class="session-meta-row">
          <p class="muted" data-testid="session-meta">Room: ${roomId} · Player: ${playerId}</p>
          <button class="session-link" data-return-lobby="true">返回大厅</button>
          <button class="session-link" data-logout-guest="true">切换游客账号</button>
        </div>
        <div class="account-card" data-testid="account-card">
          <div class="account-card-head">
            <div>
              <span class="account-eyebrow">账号资料</span>
              <strong>${escapeHtml(state.account.displayName)}</strong>
            </div>
            <span class="account-badge tone-${state.account.source}">${formatAccountSource(state.account)}</span>
          </div>
          <p class="account-meta">ID ${escapeHtml(state.account.playerId)}</p>
          <p class="account-meta">${escapeHtml(formatCredentialBinding(state.account))}</p>
          <p class="account-meta">${escapeHtml(formatAccountLastSeen(state.account))}</p>
          <p class="account-meta">${escapeHtml(formatGlobalVault(state.account))}</p>
          ${renderAchievementProgress(state.account)}
          ${renderRecentAccountEvents(state.account)}
          <div class="account-editor">
            <input
              class="account-input"
              data-account-name="true"
              maxlength="40"
              value="${escapeHtml(state.accountDraftName)}"
              placeholder="输入昵称"
              ${state.accountSaving ? "disabled" : ""}
            />
            <button
              class="account-save"
              data-save-account="true"
              ${state.accountSaving ? "disabled" : ""}
            >${state.accountSaving ? "保存中..." : "保存昵称"}</button>
          </div>
          <div class="account-binding-card">
            <div class="account-binding-head">
              <strong>${state.account.loginId ? "更新账号口令" : "绑定口令账号"}</strong>
              <span>${state.account.loginId ? "当前档案已可用登录 ID 直接进入" : "把当前游客档升级成可长期登录的账号"}</span>
            </div>
            <div class="account-binding-grid">
              <input
                class="account-input"
                data-account-login-id="true"
                maxlength="40"
                value="${escapeHtml(state.account.loginId ?? state.accountLoginId)}"
                placeholder="veil-ranger"
                ${state.accountSaving || state.accountBinding || state.account.source !== "remote" || Boolean(state.account.loginId) ? "disabled" : ""}
              />
              <input
                class="account-input"
                data-account-password="true"
                type="password"
                maxlength="80"
                value="${escapeHtml(state.accountPassword)}"
                placeholder="${state.account.loginId ? "输入新口令" : "至少 6 位"}"
                ${state.accountSaving || state.accountBinding || state.account.source !== "remote" ? "disabled" : ""}
              />
            </div>
            <button
              class="account-save"
              data-bind-account="true"
              ${state.accountSaving || state.accountBinding || state.account.source !== "remote" ? "disabled" : ""}
            >${state.accountBinding ? "提交中..." : state.account.loginId ? "更新口令" : "绑定账号"}</button>
          </div>
          <p class="muted account-status">${escapeHtml(state.accountStatus)}</p>
        </div>
        ${state.predictionStatus ? `<p class="muted" data-testid="prediction-status">${state.predictionStatus}</p>` : ""}
        <div class="stats">
          <div class="card" data-testid="stat-day"><span>Day</span><strong>${state.world.meta.day}</strong></div>
          <div class="card" data-testid="stat-gold"><span>Gold</span><strong>${state.world.resources.gold}</strong></div>
          <div class="card" data-testid="stat-wood"><span>Wood</span><strong>${state.world.resources.wood}</strong></div>
          <div class="card" data-testid="stat-ore"><span>Ore</span><strong>${state.world.resources.ore}</strong></div>
        </div>
        <div class="hero-card" data-testid="hero-card">
          <h2>${hero?.name ?? "No Hero"}</h2>
          <p data-testid="hero-level">${formatHeroProgression(hero)}</p>
          <p data-testid="hero-xp">${formatHeroExperience(hero)}</p>
          ${renderHeroProgressPanel(hero)}
          <p data-testid="hero-stats">${formatHeroCoreStats(hero)}</p>
          <p data-testid="hero-hp">HP ${hero?.stats.hp ?? 0}/${hero?.stats.maxHp ?? 0}</p>
          <p data-testid="hero-move">Move ${hero?.move.remaining ?? 0}/${hero?.move.total ?? 0}</p>
          <p data-testid="hero-wins">Wins ${hero?.progression.battlesWon ?? 0} · Neutral ${hero?.progression.neutralBattlesWon ?? 0} · PvP ${hero?.progression.pvpBattlesWon ?? 0}</p>
          <p data-testid="hero-army">Army ${hero?.armyTemplateId ?? "-"} x ${hero?.armyCount ?? 0}</p>
          <p data-testid="hero-skill-points">Skill Points ${hero?.progression.skillPoints ?? 0}</p>
          <p class="muted" data-testid="hero-preview">${state.previewPlan ? `预览消耗 ${state.previewPlan.moveCost} 步` : state.predictionStatus || "悬停地图格子查看路径"}</p>
          ${renderHeroEquipmentPanel(hero)}
          ${renderHeroAttributePanel(hero, state.world)}
          <button class="modal-button" data-end-day="true" ${state.battle ? "disabled" : ""}>推进到下一天</button>
          ${renderHeroSkillTree(hero)}
        </div>
        <div class="log-panel">
          <h3>时间线</h3>
          <div data-testid="timeline-panel">${renderTimeline()}</div>
        </div>
        <div class="log-panel">
          <h3>事件流</h3>
          <div class="log-list" data-testid="event-log">${state.log.map((line) => `<div class="log-line">${line}</div>`).join("")}</div>
        </div>
      </section>
      <section class="map-panel">
        <div class="panel-head">
          <h2>大地图</h2>
          <div class="hint">${state.previewPlan ? formatPath(state.previewPlan.travelPath) : `Hero: ${hero?.position.x ?? "-"},${hero?.position.y ?? "-"}`}</div>
        </div>
        <div class="map-inspector ${state.feedbackTone !== "idle" ? `tone-${state.feedbackTone}` : ""}">
          <div class="inspector-main">
            <strong>${hoveredTile ? `格子 ${hoveredTile.position.x},${hoveredTile.position.y}` : "悬停格子查看详情"}</strong>
            <span>
              ${
                hoveredTile
                  ? [
                      `地形 ${hoveredTile.terrain}`,
                      hoveredTile.resource ? `资源 ${hoveredTile.resource.kind}+${hoveredTile.resource.amount}` : "无资源",
                      hoveredTile.building
                        ? `建筑 ${hoveredTile.building.label}`
                        : hoveredTile.occupant?.kind === "neutral"
                          ? "明雷怪"
                          : hoveredTile.occupant?.kind === "hero"
                            ? "英雄"
                            : "空地"
                    ].join(" · ")
                  : "可达格已高亮，预览路径会在地图上实时显示。"
              }
            </span>
            ${
              hoveredObject
                ? `
                  <div class="object-card info-card">
                    <div class="object-card-media info-card-media">
                      ${hoveredObject.icon ? `<img class="object-card-icon" src="${hoveredObject.icon}" alt="${hoveredObject.title}" />` : `<div class="object-card-empty">${hoveredTile?.terrain ?? "?"}</div>`}
                    </div>
                    <div class="object-card-copy info-card-copy">
                      <div class="info-card-head">
                        <div>
                          <div class="info-card-eyebrow">${hoveredTile?.building ? "建筑交互" : interactionLabel(hoveredObject.interactionType)}</div>
                          <strong>${hoveredObject.title}</strong>
                        </div>
                        <span class="status-pill">${hoveredObject.rarity === "elite" ? "Elite" : "Common"}</span>
                      </div>
                      <span>${hoveredObject.subtitle}</span>
                      <div class="object-card-tags meta-row">
                        ${hoveredBadges.interaction ? `<img class="object-tag" src="${hoveredBadges.interaction}" alt="" aria-hidden="true" />` : ""}
                        ${hoveredBadges.faction ? `<img class="object-tag" src="${hoveredBadges.faction}" alt="" aria-hidden="true" />` : ""}
                        ${hoveredBadges.rarity ? `<img class="object-tag" src="${hoveredBadges.rarity}" alt="" aria-hidden="true" />` : ""}
                        <span class="object-card-value">${hoveredObject.value}</span>
                      </div>
                    </div>
                  </div>
                `
                : ""
            }
          </div>
          <div class="inspector-side">
            <span>可达格</span>
            <strong>${state.reachableTiles.length}</strong>
          </div>
        </div>
        <div class="grid" style="grid-template-columns: repeat(${state.world.map.width}, minmax(0, 1fr));">${grid}</div>
      </section>
      <section class="battle-panel" data-testid="battle-panel">
        <div class="panel-head">
          <h2>战斗面板</h2>
          <div class="hint">${state.battle ? "遭遇中" : "空闲"}</div>
        </div>
        ${renderBattlefield()}
        ${renderBattleIntelPanel()}
        ${renderBattleActions()}
        ${renderBattleLog()}
      </section>
    </main>
    ${renderModal()}
  `;

  for (const tileButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-x][data-y]"))) {
    tileButton.addEventListener("mouseenter", () => {
      void previewTile(Number(tileButton.dataset.x), Number(tileButton.dataset.y));
    });
    tileButton.addEventListener("mouseleave", clearPreview);
    tileButton.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      void onTileClick(Number(tileButton.dataset.x), Number(tileButton.dataset.y));
    });
    tileButton.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      void onTileClick(Number(tileButton.dataset.x), Number(tileButton.dataset.y));
    });
  }

  for (const actionButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-battle-action]"))) {
    actionButton.addEventListener("click", () => {
      const kind = actionButton.dataset.battleAction;
      if (kind === "attack") {
        void onBattleAction({
          type: "battle.attack",
          attackerId: actionButton.dataset.attacker!,
          defenderId: actionButton.dataset.defender!
        });
        return;
      }

      if (kind === "wait") {
        void onBattleAction({
          type: "battle.wait",
          unitId: actionButton.dataset.unit!
        });
        return;
      }

      if (kind === "skill") {
        void onBattleAction({
          type: "battle.skill",
          unitId: actionButton.dataset.unit!,
          skillId: actionButton.dataset.skillId!,
          ...(actionButton.dataset.target ? { targetId: actionButton.dataset.target } : {})
        });
        return;
      }

      void onBattleAction({
        type: "battle.defend",
        unitId: actionButton.dataset.unit!
      });
    });
  }

  for (const targetButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-target-unit]"))) {
    targetButton.addEventListener("click", () => {
      state.selectedBattleTargetId = targetButton.dataset.targetUnit ?? null;
      render();
    });
  }

  for (const closeButton of Array.from(root.querySelectorAll<HTMLElement>("[data-close-modal]"))) {
    closeButton.addEventListener("click", closeBattleModal);
  }

  for (const endDayButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-end-day]"))) {
    endDayButton.addEventListener("click", () => {
      void onEndDay();
    });
  }

  for (const skillButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-hero-skill-id]"))) {
    skillButton.addEventListener("click", () => {
      const skillId = skillButton.dataset.heroSkillId;
      if (!skillId) {
        return;
      }

      void onLearnHeroSkill(skillId);
    });
  }

  for (const equipButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-hero-equip-slot]"))) {
    equipButton.addEventListener("click", () => {
      const slot = equipButton.dataset.heroEquipSlot as EquipmentType | undefined;
      const equipmentId = equipButton.dataset.heroEquipId;
      if (!slot || !equipmentId) {
        return;
      }

      void onEquipHeroItem(slot, equipmentId);
    });
  }

  for (const unequipButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-hero-unequip-slot]"))) {
    unequipButton.addEventListener("click", () => {
      const slot = unequipButton.dataset.heroUnequipSlot as EquipmentType | undefined;
      if (!slot) {
        return;
      }

      void onUnequipHeroItem(slot);
    });
  }

  for (const accountInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-account-name]"))) {
    accountInput.addEventListener("input", () => {
      state.accountDraftName = accountInput.value;
    });
    accountInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || state.accountSaving) {
        return;
      }

      event.preventDefault();
      void onSaveAccountProfile();
    });
  }

  for (const accountLoginIdInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-account-login-id]"))) {
    accountLoginIdInput.addEventListener("input", () => {
      state.accountLoginId = accountLoginIdInput.value;
    });
    accountLoginIdInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || state.accountBinding) {
        return;
      }

      event.preventDefault();
      void onBindAccountProfile();
    });
  }

  for (const accountPasswordInput of Array.from(root.querySelectorAll<HTMLInputElement>("[data-account-password]"))) {
    accountPasswordInput.addEventListener("input", () => {
      state.accountPassword = accountPasswordInput.value;
    });
    accountPasswordInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || state.accountBinding) {
        return;
      }

      event.preventDefault();
      void onBindAccountProfile();
    });
  }

  for (const saveAccountButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-save-account]"))) {
    saveAccountButton.addEventListener("click", () => {
      void onSaveAccountProfile();
    });
  }

  for (const bindAccountButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-bind-account]"))) {
    bindAccountButton.addEventListener("click", () => {
      void onBindAccountProfile();
    });
  }

  for (const returnLobbyButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-return-lobby]"))) {
    returnLobbyButton.addEventListener("click", () => {
      returnToLobby();
    });
  }

  for (const logoutButton of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-logout-guest]"))) {
    logoutButton.addEventListener("click", () => {
      logoutGuestSession();
    });
  }
}

async function bootstrap(): Promise<void> {
  render();
  const syncedAuthSession = await syncCurrentAuthSession();
  state.lobby.authSession = syncedAuthSession;
  if (syncedAuthSession) {
    state.lobby.playerId = syncedAuthSession.playerId;
    state.lobby.displayName = syncedAuthSession.displayName;
    state.lobby.loginId = syncedAuthSession.loginId ?? state.lobby.loginId;
    state.accountDraftName = syncedAuthSession.displayName;
    state.accountLoginId = syncedAuthSession.loginId ?? state.accountLoginId;
  }

  if (!shouldBootGame) {
    await refreshLobbyRoomList();
    return;
  }

  if (!queryPlayerId && !syncedAuthSession?.playerId) {
    logoutGuestSession();
    return;
  }

  const replayed = readStoredSessionReplay(roomId, playerId);
  if (replayed) {
    applyReplayedUpdate(replayed);
  }
  const session = await getSession();
  const initial = await session.snapshot();
  state.log = [
    `会话已连接。Room ${roomId} / Player ${playerId}`,
    ...state.log.filter(
      (line) => line !== "正在连接本地会话服务..." && line !== `会话已连接。Room ${roomId} / Player ${playerId}`
    )
  ].slice(0, 12);
  applyUpdate(initial, "system");
  void syncPlayerAccountProfile();
}

async function syncPlayerAccountProfile(): Promise<void> {
  const account = await loadAccountProfile(playerId, roomId);
  state.account = account;
  state.accountDraftName = account.displayName;
  state.accountLoginId = account.loginId ?? state.accountLoginId;
  state.accountStatus =
    account.source === "remote"
      ? account.loginId
        ? `账号资料与全局仓库已同步，当前已绑定登录 ID ${account.loginId}。`
        : "账号资料与全局仓库已同步，可继续把当前游客档升级成口令账号。"
      : "当前运行在本地游客档，昵称仅保存在浏览器。";
  render();
}

async function onSaveAccountProfile(): Promise<void> {
  const nextDisplayName = state.accountDraftName.trim() || playerId;
  state.accountSaving = true;
  state.accountStatus = "正在保存昵称...";
  render();

  const account = await saveAccountDisplayName(playerId, roomId, nextDisplayName);
  state.account = account;
  state.accountDraftName = account.displayName;
  state.accountSaving = false;
  state.accountStatus =
    account.source === "remote"
      ? account.loginId
        ? `昵称已同步到服务端账号，全局仓库仍归属于 ${account.loginId}。`
        : "昵称已同步到服务端账号。"
      : "服务器不可用，昵称已保存到本地浏览器。";
  state.log.unshift(`账号昵称已更新为 ${account.displayName}`);
  state.log = state.log.slice(0, 12);
  render();
}

async function onBindAccountProfile(): Promise<void> {
  const loginId = (state.account.loginId ?? state.accountLoginId).trim().toLowerCase();
  if (!loginId) {
    state.accountStatus = "请输入登录 ID 后再绑定账号。";
    render();
    return;
  }

  if (!state.accountPassword.trim()) {
    state.accountStatus = state.account.loginId ? "请输入新口令后再更新。" : "请输入账号口令后再绑定。";
    render();
    return;
  }

  state.accountBinding = true;
  state.accountStatus = state.account.loginId ? "正在更新账号口令..." : "正在绑定口令账号...";
  render();

  try {
    const account = await bindAccountCredentials(loginId, state.accountPassword, roomId);
    state.account = account;
    state.accountLoginId = account.loginId ?? loginId;
    state.accountPassword = "";
    state.accountBinding = false;
    state.lobby.authSession = readStoredAuthSession();
    state.lobby.loginId = state.accountLoginId;
    state.accountStatus = account.loginId
      ? `口令账号已就绪，后续可用 ${account.loginId} 直接登录同一套英雄档与全局仓库。`
      : "账号绑定已完成。";
    state.log.unshift(`账号已绑定登录 ID ${account.loginId ?? loginId}`);
    state.log = state.log.slice(0, 12);
    render();
  } catch (error) {
    state.accountBinding = false;
    state.accountStatus =
      error instanceof Error && error.message === "player_account_request_failed:401"
        ? "当前会话已失效，请重新登录后再绑定账号。"
        : error instanceof Error
          ? error.message
          : "account_bind_failed";
    render();
  }
}

void bootstrap();
