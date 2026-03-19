import "./styles.css";
import type { BattleAction, BattleState, MovementPlan, PlayerTileView, PlayerWorldView } from "../../../packages/shared/src/index";
import { createGameSession, type SessionUpdate } from "./local-session";
import { markerAsset, objectBadgeAssets, resourceAsset, terrainAsset, unitAsset, unitBadgeAssets, unitFrameAsset } from "./assets";
import { describeTileObject } from "./object-visuals";

const params = new URLSearchParams(window.location.search);
const roomId = params.get("roomId") ?? "local-room";
const playerId = params.get("playerId") ?? "player-1";

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

interface AppState {
  world: PlayerWorldView;
  battle: BattleState | null;
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
}

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
  }
};

let sessionPromise = createGameSession(roomId, playerId, 1001, {
  onPushUpdate: (update) => {
    state.log.unshift("收到房间同步推送");
    state.log = state.log.slice(0, 12);
    applyUpdate(update, "push");
  }
});

function tileLabel(tile: PlayerTileView): string {
  if (tile.fog === "hidden") {
    return "?";
  }

  const terrain = tile.terrain.slice(0, 1).toUpperCase();
  const occupant = tile.occupant?.kind === "neutral" ? "M" : tile.occupant?.kind === "hero" ? "H" : "";
  const resource = tile.resource ? tile.resource.kind.slice(0, 1).toUpperCase() : "";
  return `${terrain}${occupant}${resource}`;
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
  const markerState = markerStateForTile(tile);
  const markerSrc =
    tile.occupant?.kind === "hero"
      ? markerAsset("hero", markerState)
      : tile.occupant?.kind === "neutral"
        ? markerAsset("neutral", markerState)
        : null;

  return `
    <img class="tile-terrain" src="${terrainSrc}" alt="${tile.terrain}" />
    ${resourceSrc ? `<img class="tile-resource" src="${resourceSrc}" alt="${tile.resource?.kind ?? "resource"}" />` : ""}
    ${markerSrc ? `<img class="tile-marker" src="${markerSrc}" alt="${tile.occupant?.kind ?? "marker"}" />` : ""}
  `;
}

function formatPath(path: { x: number; y: number }[]): string {
  return path.map((node) => `(${node.x},${node.y})`).join(" -> ");
}

function activeHero() {
  return state.selectedHeroId ? state.world.ownHeroes.find((item) => item.id === state.selectedHeroId) ?? null : null;
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

function appendLog(update: SessionUpdate): void {
  if (update.reason) {
    state.log.unshift(`Action rejected: ${update.reason}`);
  }

  if (update.movementPlan) {
    state.log.unshift(`Path: ${formatPath(update.movementPlan.path)}`);
  }

  for (const event of update.events.slice().reverse()) {
    if (event.type === "battle.started") {
      state.log.unshift(
        event.encounterKind === "hero"
          ? `Encounter: enemy hero ${event.defenderHeroId}`
          : `Encounter: ${event.neutralArmyId}`
      );
    } else if (event.type === "battle.resolved") {
      state.log.unshift(`Battle resolved: ${event.result}`);
    } else if (event.type === "hero.collected") {
      state.log.unshift(`Collected ${event.resource.kind} +${event.resource.amount}`);
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

    if (event.type === "battle.started") {
      items.push({
        id: `${stamp}-battle-start-${index}`,
        tone: "battle",
        source,
        text: event.encounterKind === "hero" ? "接触敌方英雄，进入遭遇战" : "接触明雷守军，进入战斗"
      });
      return;
    }

    if (event.type === "battle.resolved") {
      items.push({
        id: `${stamp}-battle-end-${index}`,
        tone: "battle",
        source,
        text: event.result === "attacker_victory" ? "战斗胜利，世界状态已回写" : "战斗失败，英雄被击退"
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
    const defenders = Object.values(update.battle.units).filter((unit) => unit.camp === "defender" && unit.count > 0);
    if (!state.selectedBattleTargetId || !defenders.some((unit) => unit.id === state.selectedBattleTargetId)) {
      state.selectedBattleTargetId = defenders[0]?.id ?? null;
    }
  }
  appendLog(update);
  pushTimeline(buildTimelineEntries(update, source));
  state.feedbackTone = update.events.some((event) => event.type === "hero.collected")
    ? "loot"
    : update.events.some((event) => event.type === "battle.started" || event.type === "battle.resolved")
      ? "battle"
      : update.events.some((event) => event.type === "hero.moved")
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
  }

  state.pendingBattleAction = null;

  const resolved = update.events.find(isBattleEvent);
  if (resolved?.type === "battle.resolved") {
    const rewardEvent = update.events.find((event) => event.type === "hero.collected");
    openBattleModal(
      resolved.result === "attacker_victory" ? "战斗胜利" : "战斗失败",
      resolved.result === "attacker_victory"
        ? `你已击败守军。${rewardEvent?.type === "hero.collected" ? `获得 ${rewardEvent.resource.kind} +${rewardEvent.resource.amount}。` : ""}`
        : "英雄被击退，生命值下降且本日移动力清零。"
    );
  } else if (hadBattle && !update.battle && update.events.length === 0) {
    openBattleModal("战斗结束", "本场遭遇已结束。");
  }

  render();
}

async function previewTile(x: number, y: number): Promise<void> {
  state.hoveredTile = { x, y };
  const hero = activeHero();
  if (!hero || state.battle) {
    state.previewPlan = null;
    render();
    return;
  }

  const session = await sessionPromise;
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

  const session = await sessionPromise;
  if (hero.position.x === x && hero.position.y === y) {
    applyUpdate(await session.collect(hero.id, { x, y }));
    return;
  }

  applyUpdate(await session.moveHero(hero.id, { x, y }));
}

async function onBattleAction(action: BattleAction): Promise<void> {
  state.pendingBattleAction = action;
  const session = await sessionPromise;
  applyUpdate(await session.actInBattle(action));
}

function autoResolveEnemyTurn(): void {
  if (!state.battle?.activeUnitId) {
    return;
  }

  const active = state.battle.units[state.battle.activeUnitId];
  if (!active || active.camp !== "defender") {
    return;
  }

  const target = Object.values(state.battle.units).find((unit) => unit.camp === "attacker" && unit.count > 0);
  if (!target) {
    return;
  }

      queueMicrotask(() =>
        void onBattleAction({
          type: "battle.attack",
          attackerId: active.id,
          defenderId: target.id
    })
  );
}

function renderBattleActions(): string {
  if (!state.battle || !state.battle.activeUnitId) {
    return `<div class="battle-actions muted">当前没有战斗</div>`;
  }

  const active = state.battle.units[state.battle.activeUnitId];
  if (!active) {
    return `<div class="battle-actions muted">当前没有可行动单位</div>`;
  }

  if (active.camp !== "attacker") {
    return `<div class="battle-actions muted">敌方回合自动执行</div>`;
  }

  const enemies = Object.values(state.battle.units).filter((unit) => unit.camp === "defender" && unit.count > 0);
  const selectedTarget = enemies.find((enemy) => enemy.id === state.selectedBattleTargetId) ?? enemies[0];

  return `
    <div class="battle-actions">
      <button data-battle-action="attack" data-attacker="${active.id}" data-defender="${selectedTarget?.id ?? ""}" ${selectedTarget ? "" : "disabled"}>
        ${selectedTarget ? `攻击 ${selectedTarget.stackName}` : "无可攻击目标"}
      </button>
      <button data-battle-action="wait" data-unit="${active.id}">等待</button>
      <button data-battle-action="defend" data-unit="${active.id}" ${active.defending ? "disabled" : ""}>防御</button>
    </div>
  `;
}

function renderBattlefield(): string {
  if (!state.battle) {
    return `<div class="battle-empty">No active battle</div>`;
  }

  const attackers = Object.values(state.battle.units).filter((unit) => unit.camp === "attacker");
  const defenders = Object.values(state.battle.units).filter((unit) => unit.camp === "defender");
  const activeId = state.battle.activeUnitId;
  const campLabel = (camp: "attacker" | "defender") => (camp === "attacker" ? "我方" : "敌方");
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
    const isSelectable = unit.camp === "defender" && unit.count > 0;
    const isSelected = state.selectedBattleTargetId === unit.id;
    const isFlashing = state.battleFx.flashUnitId === unit.id;
    const portraitSrc =
      unitAsset(unit.templateId, isFlashing ? "hit" : isSelected || isActive ? "selected" : "idle") ??
      markerAsset(unit.camp === "attacker" ? "hero" : "neutral", isFlashing ? "hit" : isSelected ? "selected" : "idle");
    const frameSrc = unitFrameAsset(unit.templateId);
    const badgeSrc = unitBadgeAssets(unit.templateId);

    return `
      <button
        class="unit-card ${unit.camp} ${isActive ? "is-active" : ""} ${isDead ? "is-dead" : ""} ${isSelected ? "is-selected" : ""} ${isFlashing ? "is-flashing" : ""}"
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
            <span class="unit-meta">ATK ${unit.attack}</span>
            <span class="unit-meta">DEF ${unit.defense}${unit.defending ? " · DEFEND" : ""}</span>
          </div>
        </div>
        ${isFlashing && state.battleFx.floatingText ? `<span class="floating-text">${state.battleFx.floatingText}</span>` : ""}
      </button>
    `;
  };

  return `
    <div class="battlefield">
      <div class="battle-lane">
        <div class="lane-title">我方部队</div>
        <div class="unit-grid">${attackers.map((unit) => renderUnit(unit.id)).join("")}</div>
      </div>
      <div class="battle-turn-banner">
        <strong>Round ${state.battle.round}</strong>
        <span>${activeId ? `当前单位：${state.battle.units[activeId]?.stackName ?? activeId}` : "等待结算"}</span>
      </div>
      <div class="battle-lane">
        <div class="lane-title">敌方部队</div>
        <div class="unit-grid">${defenders.map((unit) => renderUnit(unit.id)).join("")}</div>
      </div>
    </div>
  `;
}

function renderBattleLog(): string {
  if (!state.battle) {
    return `<div class="battle-log muted">尚未进入战斗</div>`;
  }

  const lines = state.battle.log.slice(-6).reverse();
  return `<div class="battle-log">${lines.map((line) => `<div class="battle-log-line">${line}</div>`).join("")}</div>`;
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
    <div class="modal-backdrop" data-close-modal="true">
      <div class="modal-card" role="dialog" aria-modal="true">
        <div class="eyebrow">Battle Report</div>
        <h2>${state.modal.title}</h2>
        <p>${state.modal.body}</p>
        <button class="modal-button" data-close-modal="true">关闭</button>
      </div>
    </div>
  `;
}

function render(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
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
        <h1>网页版原型</h1>
        <p class="lead">本地单机房间。悬停看路径，点击地图移动，靠近明雷触发战斗。</p>
        <p class="muted">Room: ${roomId} · Player: ${playerId}</p>
        <div class="stats">
          <div class="card"><span>Day</span><strong>${state.world.meta.day}</strong></div>
          <div class="card"><span>Gold</span><strong>${state.world.resources.gold}</strong></div>
          <div class="card"><span>Wood</span><strong>${state.world.resources.wood}</strong></div>
          <div class="card"><span>Ore</span><strong>${state.world.resources.ore}</strong></div>
        </div>
        <div class="hero-card">
          <h2>${hero?.name ?? "No Hero"}</h2>
          <p>HP ${hero?.stats.hp ?? 0}/${hero?.stats.maxHp ?? 0}</p>
          <p>Move ${hero?.move.remaining ?? 0}/${hero?.move.total ?? 0}</p>
          <p>Army ${hero?.armyTemplateId ?? "-"} x ${hero?.armyCount ?? 0}</p>
          <p class="muted">${state.previewPlan ? `预览消耗 ${state.previewPlan.moveCost} 步` : "悬停地图格子查看路径"}</p>
        </div>
        <div class="log-panel">
          <h3>时间线</h3>
          ${renderTimeline()}
        </div>
        <div class="log-panel">
          <h3>事件流</h3>
          <div class="log-list">${state.log.map((line) => `<div class="log-line">${line}</div>`).join("")}</div>
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
                      hoveredTile.occupant?.kind === "neutral" ? "明雷怪" : hoveredTile.occupant?.kind === "hero" ? "英雄" : "空地"
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
                          <div class="info-card-eyebrow">${interactionLabel(hoveredObject.interactionType)}</div>
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
      <section class="battle-panel">
        <div class="panel-head">
          <h2>战斗面板</h2>
          <div class="hint">${state.battle ? "遭遇中" : "空闲"}</div>
        </div>
        ${renderBattlefield()}
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
    tileButton.addEventListener("focus", () => {
      void previewTile(Number(tileButton.dataset.x), Number(tileButton.dataset.y));
    });
    tileButton.addEventListener("mouseleave", clearPreview);
    tileButton.addEventListener("blur", clearPreview);
    tileButton.addEventListener("click", () => {
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

  autoResolveEnemyTurn();
}

async function bootstrap(): Promise<void> {
  render();
  const session = await sessionPromise;
  const initial = await session.snapshot();
  state.log = [`会话已连接。Room ${roomId} / Player ${playerId}`];
  applyUpdate(initial, "system");
}

void bootstrap();
