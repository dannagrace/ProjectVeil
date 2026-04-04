export type RuntimeDiagnosticsMode = "lobby" | "world" | "battle" | "server";

export type RuntimeDiagnosticsConnectionStatus = "connecting" | "connected" | "reconnecting" | "reconnect_failed";

export interface RuntimeDiagnosticsSnapshotSource {
  surface: string;
  devOnly: boolean;
  mode: RuntimeDiagnosticsMode;
}

export interface RuntimeDiagnosticsRoomSnapshot {
  roomId: string;
  playerId: string;
  day: number | null;
  connectionStatus: RuntimeDiagnosticsConnectionStatus;
  lastUpdateSource: string | null;
  lastUpdateReason: string | null;
  lastUpdateAt: string | null;
}

export interface RuntimeDiagnosticsWorldHeroSnapshot {
  id: string;
  name: string;
  position: { x: number; y: number };
  move: { total: number; remaining: number };
  stats: {
    attack: number;
    defense: number;
    power: number;
    knowledge: number;
    hp: number;
    maxHp: number;
  };
  armyTemplateId: string;
  armyCount: number;
  progression: {
    level: number;
    experience: number;
    skillPoints: number;
    battlesWon: number;
    neutralBattlesWon: number;
    pvpBattlesWon: number;
  };
}

export interface RuntimeDiagnosticsWorldSnapshot {
  map: {
    width: number;
    height: number;
    visibleTileCount: number;
    reachableTileCount: number;
  };
  resources: {
    gold: number;
    wood: number;
    ore: number;
  };
  selectedTile: { x: number; y: number } | null;
  hoveredTile: { x: number; y: number } | null;
  keyboardCursor: { x: number; y: number } | null;
  hero: RuntimeDiagnosticsWorldHeroSnapshot | null;
  visibleHeroes: Array<{
    id: string;
    playerId: string;
    position: { x: number; y: number };
  }>;
}

export interface RuntimeDiagnosticsBattleSnapshot {
  id: string;
  round: number;
  activeUnitId: string | null;
  selectedTargetId: string | null;
  unitCount: number;
  environmentCount: number;
  logTail: string[];
}

export interface RuntimeDiagnosticsAccountSnapshot {
  playerId: string;
  displayName: string;
  source: "remote" | "local";
  loginId: string | null;
  recentEventCount: number;
  recentReplayCount: number;
  accountReadiness?: {
    status: "ready" | "missing" | "blocked";
    summary: string;
    detail: string | null;
    source: "session" | "registration" | "recovery";
  };
}

export interface RuntimeDiagnosticsOverviewRoomSnapshot {
  roomId: string;
  day: number | null;
  connectedPlayers: number;
  heroCount: number;
  activeBattles: number;
  updatedAt: string | null;
}

export interface RuntimeDiagnosticsOverviewSnapshot {
  service: string;
  activeRoomCount: number;
  connectionCount: number;
  activeBattleCount: number;
  heroCount: number;
  gameplayTraffic: {
    connectMessagesTotal: number;
    worldActionsTotal: number;
    battleActionsTotal: number;
    actionMessagesTotal: number;
  } | null;
  auth: {
    activeGuestSessionCount: number;
    activeAccountSessionCount: number;
    pendingRegistrationCount: number;
    pendingRecoveryCount: number;
    tokenDeliveryQueueCount: number;
    tokenDeliveryDeadLetterCount: number;
  } | null;
  roomSummaries: RuntimeDiagnosticsOverviewRoomSnapshot[];
}

export interface RuntimeDiagnosticsReplaySnapshot {
  replayId: string;
  loading: boolean;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
}

export type RuntimeDiagnosticsErrorSource = "server" | "client";

export type RuntimeDiagnosticsErrorSeverity = "warn" | "error" | "fatal";

export type RuntimeDiagnosticsFeatureArea =
  | "login"
  | "payment"
  | "room_sync"
  | "rewards"
  | "share"
  | "runtime"
  | "battle"
  | "guild"
  | "shop"
  | "season"
  | "quests"
  | "unknown";

export interface RuntimeDiagnosticsErrorEvent {
  id: string;
  recordedAt: string;
  source: RuntimeDiagnosticsErrorSource;
  surface: string;
  candidateRevision: string | null;
  featureArea: RuntimeDiagnosticsFeatureArea;
  ownerArea: string;
  severity: RuntimeDiagnosticsErrorSeverity;
  errorCode: string;
  fingerprint: string;
  message: string;
  tags: string[];
  context: {
    roomId: string | null;
    playerId: string | null;
    requestId: string | null;
    route: string | null;
    action: string | null;
    statusCode: number | null;
    crash: boolean;
    detail: string | null;
  };
}

export interface RuntimeDiagnosticsErrorFingerprintSummary {
  fingerprint: string;
  errorCode: string;
  featureArea: RuntimeDiagnosticsFeatureArea;
  ownerArea: string;
  source: RuntimeDiagnosticsErrorSource;
  surface: string;
  severity: RuntimeDiagnosticsErrorSeverity;
  candidateRevision: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
  crashCount: number;
  latestMessage: string;
  sampleContext: RuntimeDiagnosticsErrorEvent["context"];
}

export interface RuntimeDiagnosticsErrorSummary {
  totalEvents: number;
  uniqueFingerprints: number;
  fatalCount: number;
  crashCount: number;
  latestRecordedAt: string | null;
  byFeatureArea: Array<{
    featureArea: RuntimeDiagnosticsFeatureArea;
    count: number;
  }>;
  topFingerprints: RuntimeDiagnosticsErrorFingerprintSummary[];
}

export type PrimaryClientTelemetryCategory = "progression" | "inventory" | "combat";

export type PrimaryClientTelemetryStatus = "info" | "success" | "failure" | "blocked";

export interface PrimaryClientTelemetryEvent {
  at: string;
  category: PrimaryClientTelemetryCategory;
  checkpoint: string;
  status: PrimaryClientTelemetryStatus;
  detail: string;
  roomId: string;
  playerId: string;
  heroId?: string;
  battleId?: string;
  battleKind?: "neutral" | "hero";
  result?: "attacker_victory" | "defender_victory";
  reason?: string;
  slot?: string;
  equipmentId?: string;
  equipmentName?: string;
  itemCount?: number;
  level?: number;
  experienceGained?: number;
  levelsGained?: number;
  skillPointsAwarded?: number;
}

export interface RuntimeDiagnosticsSnapshot {
  schemaVersion: number;
  exportedAt: string;
  source: RuntimeDiagnosticsSnapshotSource;
  room: RuntimeDiagnosticsRoomSnapshot | null;
  world: RuntimeDiagnosticsWorldSnapshot | null;
  battle: RuntimeDiagnosticsBattleSnapshot | null;
  account: RuntimeDiagnosticsAccountSnapshot | null;
  overview: RuntimeDiagnosticsOverviewSnapshot | null;
  diagnostics: {
    eventTypes: string[];
    timelineTail: Array<{
      id: string;
      tone: string;
      source: string;
      text: string;
    }>;
    logTail: string[];
    recoverySummary: string | null;
    predictionStatus: string | null;
    pendingUiTasks: number;
    replay: RuntimeDiagnosticsReplaySnapshot | null;
    primaryClientTelemetry: PrimaryClientTelemetryEvent[];
    errorEvents: RuntimeDiagnosticsErrorEvent[];
    errorSummary: RuntimeDiagnosticsErrorSummary;
  };
}

export type RuntimeDiagnosticsTriageTone = "neutral" | "warning" | "danger";

export interface RuntimeDiagnosticsTriageAlert {
  tone: RuntimeDiagnosticsTriageTone;
  label: string;
  detail: string;
}

export interface RuntimeDiagnosticsTriageItem {
  label: string;
  value: string;
  tone?: RuntimeDiagnosticsTriageTone;
}

export interface RuntimeDiagnosticsTriageSection {
  id: "room" | "players" | "heroes" | "battle" | "sync" | "recent-events";
  title: string;
  items: RuntimeDiagnosticsTriageItem[];
}

export interface RuntimeDiagnosticsTriageView {
  alerts: RuntimeDiagnosticsTriageAlert[];
  sections: RuntimeDiagnosticsTriageSection[];
}

function normalizeTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function buildRuntimeErrorFingerprint(input: {
  source: RuntimeDiagnosticsErrorSource;
  surface: string;
  featureArea: RuntimeDiagnosticsFeatureArea;
  errorCode: string;
  route?: string | null;
  action?: string | null;
  statusCode?: number | null;
}): string {
  return [
    input.source.trim() || "unknown",
    input.surface.trim() || "unknown",
    input.featureArea,
    input.errorCode.trim() || "unknown_error",
    input.route?.trim() || "no-route",
    input.action?.trim() || "no-action",
    input.statusCode == null ? "na" : String(input.statusCode)
  ].join("|");
}

export function buildRuntimeDiagnosticsErrorEvent(
  input: Omit<RuntimeDiagnosticsErrorEvent, "fingerprint" | "tags"> & { fingerprint?: string; tags?: string[] }
): RuntimeDiagnosticsErrorEvent {
  const fingerprint =
    input.fingerprint?.trim() ||
    buildRuntimeErrorFingerprint({
      source: input.source,
      surface: input.surface,
      featureArea: input.featureArea,
      errorCode: input.errorCode,
      route: input.context.route,
      action: input.context.action,
      statusCode: input.context.statusCode
    });

  return {
    ...input,
    fingerprint,
    tags: [...(input.tags ?? [])].map((tag) => tag.trim()).filter((tag) => tag.length > 0)
  };
}

export function summarizeRuntimeDiagnosticsErrors(
  events: RuntimeDiagnosticsErrorEvent[]
): RuntimeDiagnosticsErrorSummary {
  const fingerprintMap = new Map<string, RuntimeDiagnosticsErrorFingerprintSummary>();
  const featureAreaCounts = new Map<RuntimeDiagnosticsFeatureArea, number>();
  let fatalCount = 0;
  let crashCount = 0;
  let latestRecordedAt: string | null = null;

  for (const event of events) {
    featureAreaCounts.set(event.featureArea, (featureAreaCounts.get(event.featureArea) ?? 0) + 1);
    if (event.severity === "fatal") {
      fatalCount += 1;
    }
    if (event.context.crash) {
      crashCount += 1;
    }
    if (latestRecordedAt == null || normalizeTimestamp(event.recordedAt) > normalizeTimestamp(latestRecordedAt)) {
      latestRecordedAt = event.recordedAt;
    }

    const existing = fingerprintMap.get(event.fingerprint);
    if (existing) {
      existing.count += 1;
      existing.crashCount += event.context.crash ? 1 : 0;
      if (normalizeTimestamp(event.recordedAt) < normalizeTimestamp(existing.firstSeenAt)) {
        existing.firstSeenAt = event.recordedAt;
      }
      if (normalizeTimestamp(event.recordedAt) >= normalizeTimestamp(existing.lastSeenAt)) {
        existing.lastSeenAt = event.recordedAt;
        existing.latestMessage = event.message;
        existing.sampleContext = { ...event.context };
      }
      continue;
    }

    fingerprintMap.set(event.fingerprint, {
      fingerprint: event.fingerprint,
      errorCode: event.errorCode,
      featureArea: event.featureArea,
      ownerArea: event.ownerArea,
      source: event.source,
      surface: event.surface,
      severity: event.severity,
      candidateRevision: event.candidateRevision,
      firstSeenAt: event.recordedAt,
      lastSeenAt: event.recordedAt,
      count: 1,
      crashCount: event.context.crash ? 1 : 0,
      latestMessage: event.message,
      sampleContext: { ...event.context }
    });
  }

  return {
    totalEvents: events.length,
    uniqueFingerprints: fingerprintMap.size,
    fatalCount,
    crashCount,
    latestRecordedAt,
    byFeatureArea: Array.from(featureAreaCounts.entries())
      .map(([featureArea, count]) => ({ featureArea, count }))
      .sort((left, right) => right.count - left.count || compareStrings(left.featureArea, right.featureArea)),
    topFingerprints: Array.from(fingerprintMap.values())
      .sort(
        (left, right) =>
          right.count - left.count ||
          normalizeTimestamp(right.lastSeenAt) - normalizeTimestamp(left.lastSeenAt) ||
          compareStrings(left.fingerprint, right.fingerprint)
      )
      .slice(0, 5)
  };
}

function formatSyncAge(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }

  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
  }

  return `${(ms / 60_000).toFixed(1)}m`;
}

export function getRuntimeDiagnosticsLastSyncAgeMs(
  snapshot: RuntimeDiagnosticsSnapshot,
  now: number | string | Date = Date.now()
): number | null {
  if (!snapshot.room?.lastUpdateAt) {
    return null;
  }

  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const lastUpdateMs = Date.parse(snapshot.room.lastUpdateAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastUpdateMs)) {
    return null;
  }

  return Math.max(0, nowMs - lastUpdateMs);
}

export function buildRuntimeDiagnosticsTriageView(
  snapshot: RuntimeDiagnosticsSnapshot,
  now: number | string | Date = Date.now()
): RuntimeDiagnosticsTriageView {
  const alerts: RuntimeDiagnosticsTriageAlert[] = [];
  const lastSyncAgeMs = getRuntimeDiagnosticsLastSyncAgeMs(snapshot, now);
  const visiblePlayerIds = Array.from(
    new Set([
      ...(snapshot.world?.hero ? [snapshot.room?.playerId ?? snapshot.account?.playerId ?? ""] : []),
      ...(snapshot.world?.visibleHeroes.map((hero) => hero.playerId) ?? [])
    ].filter((value) => value.length > 0))
  );

  if (snapshot.room?.connectionStatus === "reconnecting") {
    alerts.push({
      tone: "warning",
      label: "同步中断",
      detail: "客户端正在尝试重连房间。"
    });
  } else if (snapshot.room?.connectionStatus === "reconnect_failed") {
    alerts.push({
      tone: "danger",
      label: "重连失败",
      detail: "需要依赖本地缓存或重新进入房间。"
    });
  }

  if (lastSyncAgeMs != null && lastSyncAgeMs >= 15_000) {
    alerts.push({
      tone: lastSyncAgeMs >= 30_000 ? "danger" : "warning",
      label: "同步滞后",
      detail: `最后权威更新距今 ${formatSyncAge(lastSyncAgeMs)}。`
    });
  }

  if (snapshot.source.mode !== "server" && snapshot.source.mode !== "lobby" && snapshot.world == null) {
    alerts.push({
      tone: "danger",
      label: "世界快照缺失",
      detail: "当前客户端没有可用于排障的世界状态。"
    });
  }

  if (snapshot.source.mode === "world" && snapshot.world && snapshot.world.hero == null) {
    alerts.push({
      tone: "warning",
      label: "可控英雄缺失",
      detail: "世界状态已存在，但当前玩家没有可控英雄。"
    });
  }

  if (snapshot.source.mode === "battle" && snapshot.battle == null) {
    alerts.push({
      tone: "warning",
      label: "战斗快照缺失",
      detail: "客户端处于战斗模式，但当前没有活动战斗状态。"
    });
  }

  if (snapshot.diagnostics.pendingUiTasks > 0) {
    alerts.push({
      tone: snapshot.diagnostics.pendingUiTasks >= 5 ? "warning" : "neutral",
      label: "待处理 UI 任务",
      detail: `前端仍有 ${snapshot.diagnostics.pendingUiTasks} 个排队任务。`
    });
  }

  if (snapshot.diagnostics.recoverySummary) {
    alerts.push({
      tone: "neutral",
      label: "恢复链路",
      detail: snapshot.diagnostics.recoverySummary
    });
  }

  const sections: RuntimeDiagnosticsTriageSection[] = [
    {
      id: "room",
      title: "房间",
      items: snapshot.room
        ? [
            { label: "房间", value: snapshot.room.roomId },
            { label: "玩家", value: snapshot.room.playerId },
            ...(() => {
              const tone: RuntimeDiagnosticsTriageTone | null =
                snapshot.room.connectionStatus === "reconnect_failed"
                  ? "danger"
                  : snapshot.room.connectionStatus === "reconnecting"
                    ? "warning"
                    : null;
              return [
                tone
                  ? { label: "连接", value: snapshot.room.connectionStatus, tone }
                  : { label: "连接", value: snapshot.room.connectionStatus }
              ];
            })(),
            { label: "天数", value: snapshot.room.day == null ? "未知" : `Day ${snapshot.room.day}` },
            {
              label: "最后更新",
              value:
                snapshot.room.lastUpdateSource || snapshot.room.lastUpdateReason
                  ? `${snapshot.room.lastUpdateSource ?? "unknown"} / ${snapshot.room.lastUpdateReason ?? "snapshot"}`
                  : "未记录"
            }
          ]
        : [{ label: "状态", value: "当前快照没有房间上下文", tone: "warning" }]
    },
    {
      id: "players",
      title: "玩家",
      items: [
        {
          label: "账号",
          value: snapshot.account ? `${snapshot.account.displayName} (${snapshot.account.source})` : "未加载"
        },
        {
          label: "可见玩家",
          value: visiblePlayerIds.length > 0 ? visiblePlayerIds.join(", ") : "仅本地玩家"
        },
        {
          label: "最近事件数",
          value: snapshot.account ? `${snapshot.account.recentEventCount}` : "0"
        },
        {
          label: "最近回放数",
          value: snapshot.account ? `${snapshot.account.recentReplayCount}` : "0"
        },
        {
          label: "账号就绪",
          value: snapshot.account?.accountReadiness
            ? `${snapshot.account.accountReadiness.status} · ${snapshot.account.accountReadiness.summary}`
            : "未建模"
        }
      ]
    },
    {
      id: "heroes",
      title: "英雄",
      items: snapshot.world
        ? [
            {
              label: "主控英雄",
              value: snapshot.world.hero ? `${snapshot.world.hero.name} @ ${snapshot.world.hero.position.x},${snapshot.world.hero.position.y}` : "缺失",
              tone: snapshot.world.hero ? "neutral" : "warning"
            },
            {
              label: "移动力",
              value: snapshot.world.hero
                ? `${snapshot.world.hero.move.remaining}/${snapshot.world.hero.move.total}`
                : "未知"
            },
            {
              label: "生命",
              value: snapshot.world.hero
                ? `${snapshot.world.hero.stats.hp}/${snapshot.world.hero.stats.maxHp}`
                : "未知"
            },
            {
              label: "可见英雄",
              value:
                snapshot.world.visibleHeroes.length > 0
                  ? snapshot.world.visibleHeroes
                      .map((hero) => `${hero.playerId}:${hero.id}@${hero.position.x},${hero.position.y}`)
                      .join(" | ")
                  : "无"
            }
          ]
        : [{ label: "状态", value: "当前没有世界快照", tone: "warning" }]
    },
    {
      id: "battle",
      title: "战斗",
      items: snapshot.battle
        ? [
            { label: "战斗", value: snapshot.battle.id },
            { label: "回合", value: `${snapshot.battle.round}` },
            { label: "行动单位", value: snapshot.battle.activeUnitId ?? "无" },
            { label: "锁定目标", value: snapshot.battle.selectedTargetId ?? "无" }
          ]
        : [{ label: "状态", value: "当前不在战斗中" }]
    },
    {
      id: "sync",
      title: "同步",
      items: [
        {
          label: "最后同步年龄",
          value: lastSyncAgeMs == null ? "未记录" : formatSyncAge(lastSyncAgeMs),
          ...(lastSyncAgeMs != null && lastSyncAgeMs >= 15_000
            ? { tone: lastSyncAgeMs >= 30_000 ? ("danger" as const) : ("warning" as const) }
            : {})
        },
        {
          label: "预测状态",
          value: snapshot.diagnostics.predictionStatus ?? "空闲"
        },
        {
          label: "恢复状态",
          value: snapshot.diagnostics.recoverySummary ?? "无"
        },
        {
          label: "事件类型",
          value: snapshot.diagnostics.eventTypes.length > 0 ? snapshot.diagnostics.eventTypes.join(", ") : "无"
        }
      ]
    },
    {
      id: "recent-events",
      title: "最近事件",
      items: [
        {
          label: "错误摘要",
          value:
            snapshot.diagnostics.errorSummary.totalEvents > 0
              ? `${snapshot.diagnostics.errorSummary.totalEvents} 条错误 / ${snapshot.diagnostics.errorSummary.uniqueFingerprints} 个指纹`
              : "无"
        },
        {
          label: "时间线",
          value:
            snapshot.diagnostics.timelineTail.length > 0
              ? snapshot.diagnostics.timelineTail
                  .slice(0, 2)
                  .map((entry) => `[${entry.source}/${entry.tone}] ${entry.text}`)
                  .join(" | ")
              : "无"
        },
        {
          label: "日志",
          value: snapshot.diagnostics.logTail.length > 0 ? snapshot.diagnostics.logTail.slice(0, 2).join(" | ") : "无"
        }
      ]
    }
  ];

  return { alerts, sections };
}

export function buildRuntimeDiagnosticsSummaryLines(snapshot: RuntimeDiagnosticsSnapshot): string[] {
  const lines = [`Mode ${snapshot.source.mode} (${snapshot.source.surface})`];

  if (snapshot.room) {
    lines.push(`Room ${snapshot.room.roomId} / Player ${snapshot.room.playerId} / Sync ${snapshot.room.connectionStatus}`);
  }

  if (snapshot.overview) {
    lines.push(
      `Runtime rooms ${snapshot.overview.activeRoomCount} / connections ${snapshot.overview.connectionCount} / battles ${snapshot.overview.activeBattleCount} / heroes ${snapshot.overview.heroCount}`
    );
  }

  if (snapshot.room?.day != null) {
    lines.push(`Day ${snapshot.room.day}`);
  }

  if (snapshot.room && (snapshot.room.lastUpdateSource || snapshot.room.lastUpdateReason || snapshot.room.lastUpdateAt)) {
    const updateParts = [
      snapshot.room.lastUpdateSource ? `source=${snapshot.room.lastUpdateSource}` : null,
      snapshot.room.lastUpdateReason ? `reason=${snapshot.room.lastUpdateReason}` : null,
      snapshot.room.lastUpdateAt ? `at=${snapshot.room.lastUpdateAt}` : null
    ].filter((value): value is string => value != null);

    lines.push(`Last update ${updateParts.join(" / ")}`);
  }

  if (snapshot.world) {
    lines.push(
      `World ${snapshot.world.map.width}x${snapshot.world.map.height} / visible ${snapshot.world.map.visibleTileCount} / reachable ${snapshot.world.map.reachableTileCount}`
    );
    lines.push(
      `Resources gold=${snapshot.world.resources.gold} wood=${snapshot.world.resources.wood} ore=${snapshot.world.resources.ore}`
    );

    if (snapshot.world.hero) {
      lines.push(
        `Hero ${snapshot.world.hero.name} @ ${snapshot.world.hero.position.x},${snapshot.world.hero.position.y} / MOV ${snapshot.world.hero.move.remaining}/${snapshot.world.hero.move.total} / HP ${snapshot.world.hero.stats.hp}/${snapshot.world.hero.stats.maxHp}`
      );
    }
  }

  if (snapshot.battle) {
    lines.push(
      `Battle ${snapshot.battle.id} / round ${snapshot.battle.round} / units ${snapshot.battle.unitCount} / environment ${snapshot.battle.environmentCount}`
    );
  }

  if (snapshot.account) {
    lines.push(
      `Account ${snapshot.account.displayName} (${snapshot.account.source}) / events ${snapshot.account.recentEventCount} / replays ${snapshot.account.recentReplayCount}`
    );
    if (snapshot.account.accountReadiness) {
      lines.push(
        `Account readiness ${snapshot.account.accountReadiness.status} / ${snapshot.account.accountReadiness.summary}${
          snapshot.account.accountReadiness.detail ? ` / ${snapshot.account.accountReadiness.detail}` : ""
        }`
      );
    }
  }

  if (snapshot.overview?.gameplayTraffic) {
    lines.push(
      `Traffic connect=${snapshot.overview.gameplayTraffic.connectMessagesTotal} / world=${snapshot.overview.gameplayTraffic.worldActionsTotal} / battle=${snapshot.overview.gameplayTraffic.battleActionsTotal}`
    );
  }

  if (snapshot.overview?.auth) {
    lines.push(
      `Auth guest=${snapshot.overview.auth.activeGuestSessionCount} / account=${snapshot.overview.auth.activeAccountSessionCount} / queue=${snapshot.overview.auth.tokenDeliveryQueueCount} / deadLetters=${snapshot.overview.auth.tokenDeliveryDeadLetterCount}`
    );
  }

  for (const roomSummary of snapshot.overview?.roomSummaries.slice(0, 3) ?? []) {
    lines.push(
      `Room summary ${roomSummary.roomId} / day ${roomSummary.day ?? "?"} / players ${roomSummary.connectedPlayers} / heroes ${roomSummary.heroCount} / battles ${roomSummary.activeBattles}`
    );
  }

  if (snapshot.diagnostics.eventTypes.length > 0) {
    lines.push(`Events ${snapshot.diagnostics.eventTypes.join(", ")}`);
  }

  if (snapshot.diagnostics.predictionStatus) {
    lines.push(`Prediction ${snapshot.diagnostics.predictionStatus}`);
  }

  if (snapshot.diagnostics.recoverySummary) {
    lines.push(`Recovery ${snapshot.diagnostics.recoverySummary}`);
  }

  for (const entry of snapshot.diagnostics.primaryClientTelemetry.slice(0, 2)) {
    lines.push(`Telemetry ${entry.category}/${entry.checkpoint} (${entry.status}) ${entry.detail}`);
  }

  if (snapshot.diagnostics.errorSummary.totalEvents > 0) {
    lines.push(
      `Errors ${snapshot.diagnostics.errorSummary.totalEvents} / fingerprints ${snapshot.diagnostics.errorSummary.uniqueFingerprints} / fatal ${snapshot.diagnostics.errorSummary.fatalCount} / crashes ${snapshot.diagnostics.errorSummary.crashCount}`
    );
  }

  for (const entry of snapshot.diagnostics.errorSummary.topFingerprints.slice(0, 2)) {
    lines.push(
      `Error ${entry.featureArea}/${entry.errorCode} ${entry.count}x on ${entry.surface} (${entry.ownerArea}) last=${entry.lastSeenAt}`
    );
  }

  lines.push(`Pending UI tasks ${snapshot.diagnostics.pendingUiTasks}`);

  if (snapshot.diagnostics.replay) {
    lines.push(
      `Replay ${snapshot.diagnostics.replay.replayId} / ${snapshot.diagnostics.replay.status} / step ${snapshot.diagnostics.replay.currentStepIndex}/${snapshot.diagnostics.replay.totalSteps}`
    );
  }

  for (const entry of snapshot.diagnostics.timelineTail.slice(0, 3)) {
    lines.push(`Timeline [${entry.source}/${entry.tone}] ${entry.text}`);
  }

  for (const line of snapshot.diagnostics.logTail.slice(0, 3)) {
    lines.push(`Log ${line}`);
  }

  return lines;
}

export function renderRuntimeDiagnosticsSnapshotText(snapshot: RuntimeDiagnosticsSnapshot): string {
  return buildRuntimeDiagnosticsSummaryLines(snapshot).join("\n");
}

export function serializeRuntimeDiagnosticsSnapshot(snapshot: RuntimeDiagnosticsSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
