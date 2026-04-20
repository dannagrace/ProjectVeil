import { type BattleReplayPlaybackState, type BattleReplayStep, type BattleReplayTimelineEntry, type BattleReplayTimelineUnitChange, buildBattleReplayTimeline, buildPlayerBattleReportCenter, createBattleReplayPlaybackState } from "@veil/shared/battle";
import { formatAchievementLabel, formatWorldEventTypeLabel, getLatestProgressedAchievement, getLatestUnlockedAchievement } from "@veil/shared/event-log";
import { buildAchievementUiItems, groupAchievementUiItems } from "@veil/shared/progression";
import type { PlayerAccountProfile } from "./player-account";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatEventLogCategory(category: PlayerAccountProfile["recentEventLog"][number]["category"]): string {
  switch (category) {
    case "movement":
      return "移动";
    case "combat":
      return "战斗";
    case "building":
      return "建筑";
    case "skill":
      return "养成";
    case "achievement":
      return "成就";
    default:
      return category;
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatRewardLabel(
  reward: PlayerAccountProfile["recentEventLog"][number]["rewards"][number]
): string {
  return reward.amount != null ? `${reward.label} +${reward.amount}` : reward.label;
}

function formatBattleReplayResultLabel(
  replay: PlayerAccountProfile["recentBattleReplays"][number]
): string {
  return replay.result === "attacker_victory" ? "胜利" : "失利";
}

function formatBattleReplayKind(
  replay: PlayerAccountProfile["recentBattleReplays"][number]
): string {
  return replay.battleKind === "hero" ? "PVP" : "PVE";
}

function formatBattleReplayEncounter(
  replay: PlayerAccountProfile["recentBattleReplays"][number]
): string {
  if (replay.battleKind === "hero") {
    return replay.opponentHeroId ? `敌方英雄 ${replay.opponentHeroId}` : "敌方英雄";
  }

  return replay.neutralArmyId ? `中立守军 ${replay.neutralArmyId}` : "中立守军";
}

function formatBattleReplayCamp(
  replay: PlayerAccountProfile["recentBattleReplays"][number]
): string {
  return replay.playerCamp === "attacker" ? "攻方" : "守方";
}

function summarizeBattleReplaySteps(
  replay: PlayerAccountProfile["recentBattleReplays"][number]
): {
  player: number;
  automated: number;
  attack: number;
  skill: number;
} {
  let player = 0;
  let automated = 0;
  let attack = 0;
  let skill = 0;

  for (const step of replay.steps) {
    if (step.source === "automated") {
      automated += 1;
    } else {
      player += 1;
    }

    if (step.action.type === "battle.attack") {
      attack += 1;
    } else if (step.action.type === "battle.skill") {
      skill += 1;
    }
  }

  return {
    player,
    automated,
    attack,
    skill
  };
}

function formatBattleReplayAction(step: BattleReplayStep | null): string {
  if (!step) {
    return "暂无动作";
  }

  if (step.action.type === "battle.attack") {
    return `${step.action.attackerId} 攻击 ${step.action.defenderId}`;
  }

  if (step.action.type === "battle.skill") {
    return `${step.action.unitId} 施放 ${step.action.skillId}${step.action.targetId ? ` -> ${step.action.targetId}` : ""}`;
  }

  if (step.action.type === "battle.defend") {
    return `${step.action.unitId} 防御`;
  }

  return `${step.action.unitId} 等待`;
}

function formatBattleReplayPlaybackStatus(status: BattleReplayPlaybackState["status"]): string {
  if (status === "playing") {
    return "播放中";
  }

  if (status === "completed") {
    return "已播完";
  }

  return "已暂停";
}

function formatBattleReplaySourceLabel(source: BattleReplayStep["source"]): string {
  return source === "automated" ? "自动" : "玩家";
}

function formatBattleReplayRound(entry: BattleReplayTimelineEntry): string {
  return entry.resultingRound !== entry.round ? `第 ${entry.round} 回合 -> ${entry.resultingRound}` : `第 ${entry.round} 回合`;
}

function formatBattleReplayChange(change: BattleReplayTimelineUnitChange): string {
  const parts = [
    change.hpChange < 0 ? `伤害 ${Math.abs(change.hpChange)}` : "",
    change.hpChange > 0 ? `恢复 ${change.hpChange}` : "",
    change.countChange < 0 ? `减员 ${Math.abs(change.countChange)}` : "",
    change.countChange > 0 ? `增员 ${change.countChange}` : "",
    change.defeated ? "击倒" : "",
    change.defendingChanged ? "防御切换" : "",
    ...change.statusAdded.map((status) => `获得 ${status}`),
    ...change.statusRemoved.map((status) => `失去 ${status}`)
  ].filter(Boolean);

  return `${change.stackName}${parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}`;
}

function formatBattleReplayUnitSummary(playback: BattleReplayPlaybackState): string {
  const aliveUnits = Object.values(playback.currentState.units).filter((unit) => unit.count > 0);
  const attackerAlive = aliveUnits.filter((unit) => unit.camp === "attacker").length;
  const defenderAlive = aliveUnits.filter((unit) => unit.camp === "defender").length;
  return `攻方 ${attackerAlive} 队 · 守方 ${defenderAlive} 队`;
}

function toTimestampMs(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatBattleRewardChip(
  reward: PlayerAccountProfile["recentEventLog"][number]["rewards"][number]
): string {
  if (reward.type === "experience") {
    return reward.amount != null ? `经验 +${reward.amount}` : "经验";
  }

  if (reward.type === "skill_point") {
    return reward.amount != null ? `技能点 +${reward.amount}` : "技能点";
  }

  if (reward.type === "resource") {
    return reward.amount != null ? `${reward.label} +${reward.amount}` : reward.label;
  }

  return reward.amount != null ? `${reward.label} +${reward.amount}` : reward.label;
}

function resolveBattleReportCenter(account: PlayerAccountProfile) {
  return account.battleReportCenter && account.battleReportCenter.items.length > 0
    ? account.battleReportCenter
    : buildPlayerBattleReportCenter(account.recentBattleReplays, account.recentEventLog);
}

function resolveBattleReportSummary(
  account: PlayerAccountProfile,
  replay: PlayerAccountProfile["recentBattleReplays"][number]
) {
  return resolveBattleReportCenter(account).items.find((report) => report.id === replay.id) ?? null;
}

function resolveBattleReportSummaryById(account: PlayerAccountProfile, reportId?: string | null) {
  const normalizedReportId = reportId?.trim();
  if (!normalizedReportId) {
    return null;
  }

  return resolveBattleReportCenter(account).items.find((report) => report.id === normalizedReportId) ?? null;
}

function formatBattleReportEncounter(input: {
  battleKind: PlayerAccountProfile["recentBattleReplays"][number]["battleKind"];
  opponentHeroId?: string;
  neutralArmyId?: string;
}): string {
  if (input.battleKind === "hero") {
    return input.opponentHeroId ? `敌方英雄 ${input.opponentHeroId}` : "敌方英雄";
  }

  return input.neutralArmyId ? `中立守军 ${input.neutralArmyId}` : "中立守军";
}

function summarizeBattleReplayCasualties(
  replay: PlayerAccountProfile["recentBattleReplays"][number]
): {
  attackerLosses: number;
  defenderLosses: number;
  attackerDefeatedStacks: number;
  defenderDefeatedStacks: number;
} {
  const timeline = buildBattleReplayTimeline(replay);
  const finalState = timeline.at(-1)?.state ?? replay.initialState;
  let attackerLosses = 0;
  let defenderLosses = 0;
  let attackerDefeatedStacks = 0;
  let defenderDefeatedStacks = 0;

  for (const initialUnit of Object.values(replay.initialState.units)) {
    const finalUnit = finalState.units[initialUnit.id];
    const finalCount = Math.max(0, finalUnit?.count ?? 0);
    const losses = Math.max(0, initialUnit.count - finalCount);
    if (initialUnit.camp === "attacker") {
      attackerLosses += losses;
      if (initialUnit.count > 0 && finalCount <= 0) {
        attackerDefeatedStacks += 1;
      }
    } else {
      defenderLosses += losses;
      if (initialUnit.count > 0 && finalCount <= 0) {
        defenderDefeatedStacks += 1;
      }
    }
  }

  return {
    attackerLosses,
    defenderLosses,
    attackerDefeatedStacks,
    defenderDefeatedStacks
  };
}

function renderBattleReplayReportSummary(
  account: PlayerAccountProfile,
  replay: PlayerAccountProfile["recentBattleReplays"][number]
): string {
  const report = resolveBattleReportSummary(account, replay);
  const casualties = summarizeBattleReplayCasualties(replay);
  const didPlayerWin = report ? report.result === "victory" : false;
  const playerLosses = replay.playerCamp === "attacker" ? casualties.attackerLosses : casualties.defenderLosses;
  const enemyLosses = replay.playerCamp === "attacker" ? casualties.defenderLosses : casualties.attackerLosses;
  const playerDefeatedStacks =
    replay.playerCamp === "attacker" ? casualties.attackerDefeatedStacks : casualties.defenderDefeatedStacks;
  const enemyDefeatedStacks =
    replay.playerCamp === "attacker" ? casualties.defenderDefeatedStacks : casualties.attackerDefeatedStacks;

  return `<div class="account-replay-report-summary">
    <div class="account-replay-summary-card">
      <strong>结果概览</strong>
      <p>${escapeHtml(`${didPlayerWin ? "本场获胜" : "本场失利"} · ${formatBattleReplayCamp(replay)} · ${formatBattleReplayKind(replay)}`)}</p>
      <div class="account-replay-meta">
        <span>对阵 ${escapeHtml(report ? formatBattleReportEncounter(report) : formatBattleReplayEncounter(replay))}</span>
        <span>${escapeHtml(`回合 ${report?.turnCount ?? Math.max(1, replay.initialState.round)}`)}</span>
        <span>${escapeHtml(`步数 ${report?.actionCount ?? replay.steps.length}`)}</span>
      </div>
    </div>
    <div class="account-replay-summary-card">
      <strong>伤亡摘要</strong>
      <p>${escapeHtml(`我方减员 ${playerLosses} · 敌方减员 ${enemyLosses}`)}</p>
      <div class="account-replay-meta">
        <span>我方全灭编队 ${playerDefeatedStacks}</span>
        <span>敌方全灭编队 ${enemyDefeatedStacks}</span>
      </div>
    </div>
    <div class="account-replay-summary-card">
      <strong>战后收益</strong>
      ${
        (report?.rewards.length ?? 0) > 0
          ? `<div class="account-event-rewards">${(report?.rewards ?? [])
              .map((reward) => `<span class="account-reward-chip">${escapeHtml(formatBattleRewardChip(reward))}</span>`)
              .join("")}</div>`
          : `<p class="account-meta">${
              report?.evidence.rewards === "available" ? "收益证据同步中。" : "近期事件日志里未记录额外奖励。"
            }</p>`
      }
      <div class="account-replay-summary-notes">
        <span class="account-meta">${escapeHtml(`回放证据 ${report?.evidence.replay === "available" ? "可用" : "缺失"}`)}</span>
        <span class="account-meta">${escapeHtml(`收益证据 ${report?.evidence.rewards === "available" ? "可用" : "缺失"}`)}</span>
      </div>
    </div>
  </div>`;
}

function summarizeEventCategories(account: PlayerAccountProfile): string {
  const counts = new Map<PlayerAccountProfile["recentEventLog"][number]["category"], number>();
  for (const entry of account.recentEventLog) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([category, count]) => `${formatEventLogCategory(category)} ${count}`)
    .join(" · ");
}

function formatAchievementSummary(account: PlayerAccountProfile): string {
  const unlocked = account.achievements.filter((achievement) => achievement.unlocked).length;
  const latestUnlocked = getLatestUnlockedAchievement(account.achievements);
  const latestProgressed = getLatestProgressedAchievement(account.achievements);
  if (latestUnlocked && latestProgressed && latestProgressed.id !== latestUnlocked.id) {
    return `成就 ${unlocked}/${account.achievements.length} 已解锁 · 最新 ${latestUnlocked.title} · 最近推进 ${latestProgressed.title} ${latestProgressed.current}/${latestProgressed.target}`;
  }

  return latestUnlocked
    ? `成就 ${unlocked}/${account.achievements.length} 已解锁 · 最新 ${latestUnlocked.title}`
    : latestProgressed
      ? `成就 ${unlocked}/${account.achievements.length} 已解锁 · 最近推进 ${latestProgressed.title} ${latestProgressed.current}/${latestProgressed.target}`
    : `成就 ${unlocked}/${account.achievements.length} 已解锁`;
}

export function renderAchievementProgress(account: PlayerAccountProfile): string {
  if (account.achievements.length === 0) {
    return '<p class="account-meta">暂无成就数据</p>';
  }

  const groups = groupAchievementUiItems(buildAchievementUiItems(account.achievements));
  return `<div class="account-subsection">
    <strong>成就进度</strong>
    <p class="account-meta">${escapeHtml(formatAchievementSummary(account))}</p>
    ${groups
      .map(
        (group) => `
          <div class="account-achievement-group">
            <div class="account-achievement-group-head">
              <strong>${escapeHtml(group.category.label)}</strong>
              <span class="account-meta">${group.items.filter((item) => item.isUnlocked).length}/${group.items.length} 已解锁</span>
            </div>
            <div class="account-achievement-list">
              ${group.items
                .map(
                  (achievement) => `<div class="account-achievement ${achievement.isUnlocked ? "is-unlocked" : ""}">
                    <div class="account-achievement-head">
                      <span>${escapeHtml(achievement.title)}</span>
                      <span class="account-achievement-status">${escapeHtml(achievement.statusLabel)}</span>
                    </div>
                    <div class="account-achievement-meta">
                      <span>${achievement.progressLabel}</span>
                      <span>${achievement.progressPercent}%</span>
                    </div>
                    <div class="account-achievement-bar"><span style="width:${achievement.progressPercent}%"></span></div>
                    <p>${escapeHtml(achievement.description)}</p>
                    <div class="account-achievement-foot">${escapeHtml(achievement.footnote)}</div>
                  </div>`
                )
                .join("")}
            </div>
          </div>
        `
      )
      .join("")}
  </div>`;
}

export function renderDailyQuestBoard(
  account: PlayerAccountProfile,
  options: {
    claimingQuestId?: string | null;
  } = {}
): string {
  const board = account.dailyQuestBoard;
  if (!board?.enabled) {
    return "";
  }

  const pendingRewardSummary = [
    board.pendingRewards.gems > 0 ? `宝石 +${board.pendingRewards.gems}` : "",
    board.pendingRewards.gold > 0 ? `金币 +${board.pendingRewards.gold}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
  const resetLabel = board.resetAt ? `重置 ${formatTimestamp(board.resetAt)}` : "每日重置";

  return `<div class="account-subsection account-daily-quests">
    <div class="account-daily-quests-head">
      <div>
        <strong>每日任务</strong>
        <p class="account-meta">${escapeHtml(
          board.availableClaims > 0
            ? `可领取 ${board.availableClaims} 项 · ${pendingRewardSummary || "奖励待领取"}`
            : `${resetLabel} · 今日目标进行中`
        )}</p>
      </div>
      <span class="account-badge">${escapeHtml(resetLabel)}</span>
    </div>
    <div class="account-daily-quest-list">
      ${board.quests
        .map((quest) => {
          const isClaiming = options.claimingQuestId === quest.id;
          const progressPercent = Math.max(0, Math.min(100, Math.floor((quest.current / quest.target) * 100)));
          const rewardSummary = [
            quest.reward.gems > 0 ? `宝石 +${quest.reward.gems}` : "",
            quest.reward.gold > 0 ? `金币 +${quest.reward.gold}` : ""
          ]
            .filter(Boolean)
            .join(" · ");
          return `<div class="account-daily-quest ${quest.claimed ? "is-claimed" : quest.completed ? "is-complete" : ""}">
            <div class="account-daily-quest-head">
              <strong>${escapeHtml(quest.title)}</strong>
              <span class="account-achievement-status">${escapeHtml(
                quest.claimed ? "已领取" : quest.completed ? "可领取" : `${quest.current}/${quest.target}`
              )}</span>
            </div>
            <p>${escapeHtml(quest.description)}</p>
            <div class="account-achievement-meta">
              <span>${escapeHtml(rewardSummary)}</span>
              <span>${progressPercent}%</span>
            </div>
            <div class="account-achievement-bar"><span style="width:${progressPercent}%"></span></div>
            ${
              quest.completed
                ? `<button class="account-save account-daily-quest-claim" data-claim-daily-quest="${escapeHtml(quest.id)}" ${
                    quest.claimed || isClaiming ? "disabled" : ""
                  }>${quest.claimed ? "已领取" : isClaiming ? "领取中..." : "领取奖励"}</button>`
                : `<div class="account-daily-quest-foot">${escapeHtml(`还差 ${Math.max(0, quest.target - quest.current)} 步`)}</div>`
            }
          </div>`;
        })
        .join("")}
    </div>
  </div>`;
}

export function renderRecentAccountEvents(account: PlayerAccountProfile): string {
  if (account.recentEventLog.length === 0) {
    return '<div class="account-subsection"><strong>世界事件日志</strong><p class="account-meta">尚未记录关键事件。</p></div>';
  }

  const latestEventLabel = account.recentEventLog[0]?.timestamp ? ` · 最新 ${formatTimestamp(account.recentEventLog[0].timestamp)}` : "";
  const categorySummary = summarizeEventCategories(account);
  return `<div class="account-subsection">
    <strong>世界事件日志</strong>
    <p class="account-meta">最近 ${account.recentEventLog.length} 条关键事件${escapeHtml(latestEventLabel)}${categorySummary ? ` · ${escapeHtml(categorySummary)}` : ""}</p>
    <div class="account-event-list">
      ${account.recentEventLog
        .map((entry) => {
          const details = [
            entry.heroId ? `英雄 ${entry.heroId}` : "",
            entry.worldEventType ? `事件 ${formatWorldEventTypeLabel(entry.worldEventType)}` : "",
            entry.achievementId ? `成就 ${formatAchievementLabel(entry.achievementId)}` : ""
          ].filter(Boolean);
          return `<div class="account-event-entry">
            <div class="account-event-head">
              <span class="account-badge">${escapeHtml(formatEventLogCategory(entry.category))}</span>
              <span>${escapeHtml(formatTimestamp(entry.timestamp))}</span>
            </div>
            <p>${escapeHtml(entry.description)}</p>
            ${
              details.length > 0
                ? `<div class="account-event-meta">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</div>`
                : ""
            }
            ${
              entry.rewards.length > 0
                ? `<div class="account-event-rewards">${entry.rewards
                    .map((reward) => `<span class="account-reward-chip">${escapeHtml(formatRewardLabel(reward))}</span>`)
                    .join("")}</div>`
                : ""
            }
          </div>`;
        })
        .join("")}
    </div>
  </div>`;
}

export function renderRecentBattleReplays(
  account: PlayerAccountProfile,
  options: {
    selectedReplayId?: string | null;
  } = {}
): string {
  const reportCenter = resolveBattleReportCenter(account);
  if (reportCenter.items.length === 0) {
    return '<div class="account-subsection"><strong>最近战报</strong><p class="account-meta">尚未记录可回看的战斗摘要。</p></div>';
  }

  const visibleReports = reportCenter.items.slice(0, 6);
  return `<div class="account-subsection">
    <strong>最近战报</strong>
    <p class="account-meta">最近 ${visibleReports.length} 场战斗的结算摘要</p>
    <div class="account-replay-list">
      ${visibleReports
        .map((report) => {
          const isSelected = options.selectedReplayId === report.id;
          const summaryChips = [
            `${report.turnCount} 回合`,
            `${report.actionCount} 步`,
            report.evidence.replay === "available" ? "可回放" : "无回放",
            ...(report.rewards.slice(0, 2).map((reward) => formatBattleRewardChip(reward)) || []),
            report.rewards.length === 0 ? "暂无额外奖励" : ""
          ].filter(Boolean);
          return `<button type="button" class="account-replay-entry ${report.result === "victory" ? "is-victory" : "is-defeat"} ${isSelected ? "is-selected" : ""}" data-select-replay="${escapeHtml(report.id)}">
            <div class="account-replay-head">
              <span class="account-badge tone-${report.result === "victory" ? "victory" : "defeat"}">${escapeHtml(
                report.result === "victory" ? "胜利" : "失利"
              )}</span>
              <span>${escapeHtml(formatTimestamp(report.completedAt))}</span>
            </div>
            <p>${escapeHtml(`${report.battleKind === "hero" ? "PVP" : "PVE"} · ${formatBattleReportEncounter(report)}`)}</p>
            <div class="account-replay-meta">
              <span>房间 ${escapeHtml(report.roomId)}</span>
              <span>阵营 ${escapeHtml(report.playerCamp === "attacker" ? "攻方" : "守方")}</span>
              <span>英雄 ${escapeHtml(report.heroId)}</span>
            </div>
            <div class="account-event-rewards">${summaryChips
              .map((chip) => `<span class="account-reward-chip">${escapeHtml(chip)}</span>`)
              .join("")}</div>
          </button>`;
        })
        .join("")}
    </div>
  </div>`;
}

export function renderBattleReportReplayCenter(input: {
  account: PlayerAccountProfile;
  selectedReplayId?: string | null;
  replay: PlayerAccountProfile["recentBattleReplays"][number] | null;
  playback: BattleReplayPlaybackState | null;
  loading?: boolean;
  status?: string;
}): string {
  const reportCenter = resolveBattleReportCenter(input.account);
  const replayCount = reportCenter.items.length;
  const latestReport = reportCenter.items[0] ?? null;
  const focusReplayId = input.selectedReplayId?.trim() || latestReport?.id || null;
  const headline =
    replayCount > 0
      ? `最近累计 ${replayCount} 份战报，支持从列表进入详情或基础回放。`
      : "暂无可回看的战斗记录，完成一场战斗后这里会自动出现首批战报。";

  return `<section class="account-subsection account-replay-center" data-testid="battle-report-center">
    <div class="account-replay-center-head">
      <div>
        <strong>战报与回放中心</strong>
        <p class="account-meta">${escapeHtml(headline)}</p>
      </div>
      <span class="account-badge">${replayCount > 0 ? `战报 ${replayCount}` : "暂无战报"}</span>
    </div>
    <div class="account-replay-entry-points">
      <button
        type="button"
        class="account-replay-entry-point is-primary"
        ${latestReport ? `data-select-replay="${escapeHtml(latestReport.id)}"` : "disabled"}
      >${latestReport ? "查看最新战报" : "等待首场战报"}</button>
      <button
        type="button"
        class="account-replay-entry-point"
        ${focusReplayId ? `data-select-replay="${escapeHtml(focusReplayId)}"` : "disabled"}
      >${focusReplayId ? "进入回放中心" : "回放中心待解锁"}</button>
    </div>
    <p class="account-meta">可直接打开最新结算，查看收益证据，并进入逐步回放。</p>
    ${renderRecentBattleReplays(input.account, {
      ...(input.selectedReplayId !== undefined ? { selectedReplayId: input.selectedReplayId } : {})
    })}
    ${renderBattleReplayInspector({
      account: input.account,
      ...(input.selectedReplayId !== undefined ? { selectedReplayId: input.selectedReplayId } : {}),
      replay: input.replay,
      playback: input.playback,
      ...(input.loading !== undefined ? { loading: input.loading } : {}),
      ...(input.status !== undefined ? { status: input.status } : {})
    })}
  </section>`;
}

export function renderBattleReplayInspector(input: {
  account: PlayerAccountProfile;
  selectedReplayId?: string | null;
  replay: PlayerAccountProfile["recentBattleReplays"][number] | null;
  playback: BattleReplayPlaybackState | null;
  loading?: boolean;
  status?: string;
}): string {
  const selectedReport = resolveBattleReportSummaryById(input.account, input.selectedReplayId);
  if (!input.replay) {
    if (selectedReport) {
      return `<div class="account-subsection replay-inspector" data-testid="battle-replay-inspector">
        <div class="account-replay-inspector-head">
          <div>
            <strong>战报详情</strong>
            <p class="account-meta">${escapeHtml(
              `${selectedReport.result === "victory" ? "胜利" : "失利"} · ${selectedReport.battleKind === "hero" ? "PVP" : "PVE"} · ${formatBattleReportEncounter(selectedReport)}`
            )}</p>
          </div>
          <button type="button" class="account-replay-dismiss" data-clear-replay="true">收起</button>
        </div>
        <div class="account-replay-meta">
          <span>房间 ${escapeHtml(selectedReport.roomId)}</span>
          <span>英雄 ${escapeHtml(selectedReport.heroId)}</span>
          <span>阵营 ${escapeHtml(selectedReport.playerCamp === "attacker" ? "攻方" : "守方")}</span>
        </div>
        <p class="account-meta">${escapeHtml(input.status?.trim() || "当前仅同步到战报摘要，完整回放暂不可用。")}</p>
        <div class="account-replay-report-summary">
          <div class="account-replay-summary-card">
            <strong>结果概览</strong>
            <p>${escapeHtml(`${selectedReport.turnCount} 回合 · ${selectedReport.actionCount} 步`)}</p>
            <div class="account-replay-meta">
              <span>${escapeHtml(`完成于 ${formatTimestamp(selectedReport.completedAt)}`)}</span>
              <span>${escapeHtml(`回放证据 ${selectedReport.evidence.replay === "available" ? "可用" : "缺失"}`)}</span>
            </div>
          </div>
          <div class="account-replay-summary-card">
            <strong>战后收益</strong>
            ${
              selectedReport.rewards.length > 0
                ? `<div class="account-event-rewards">${selectedReport.rewards
                    .map((reward) => `<span class="account-reward-chip">${escapeHtml(formatBattleRewardChip(reward))}</span>`)
                    .join("")}</div>`
                : `<p class="account-meta">${
                    selectedReport.evidence.rewards === "available" ? "收益证据同步中。" : "该战报暂未附带额外奖励记录。"
                  }</p>`
            }
            <div class="account-replay-summary-notes">
              <span class="account-meta">${escapeHtml(`收益证据 ${selectedReport.evidence.rewards === "available" ? "可用" : "缺失"}`)}</span>
            </div>
          </div>
        </div>
      </div>`;
    }

    return `<div class="account-subsection">
      <strong>回放详情</strong>
      <p class="account-meta">${escapeHtml(input.status?.trim() || "选择一场最近战斗，即可查看逐步回放。")}</p>
    </div>`;
  }

  const playback = input.playback ?? createBattleReplayPlaybackState(input.replay);
  const timeline = buildBattleReplayTimeline(input.replay);
  const currentTimelineEntry = timeline[playback.currentStepIndex - 1] ?? null;
  const nextTimelineEntry = timeline[playback.currentStepIndex] ?? null;
  const activeUnits = Object.values(playback.currentState.units)
    .filter((unit) => unit.count > 0)
    .sort((left, right) => {
      if (left.camp !== right.camp) {
        return left.camp.localeCompare(right.camp);
      }
      if (left.lane !== right.lane) {
        return left.lane - right.lane;
      }
      return left.id.localeCompare(right.id);
    });

  return `<div class="account-subsection replay-inspector" data-testid="battle-replay-inspector">
    <div class="account-replay-inspector-head">
      <div>
        <strong>回放详情</strong>
        <p class="account-meta">${escapeHtml(
          `${formatBattleReplayResultLabel(input.replay)} · ${formatBattleReplayKind(input.replay)} · ${formatBattleReplayEncounter(input.replay)}`
        )}</p>
      </div>
      <button type="button" class="account-replay-dismiss" data-clear-replay="true">收起</button>
    </div>
    <div class="account-replay-meta">
      <span>状态 ${escapeHtml(formatBattleReplayPlaybackStatus(playback.status))}</span>
      <span>进度 ${playback.currentStepIndex}/${playback.totalSteps}</span>
      <span>${escapeHtml(formatBattleReplayUnitSummary(playback))}</span>
    </div>
    <div class="account-replay-controls">
      <button type="button" class="modal-button" data-replay-control="play" ${playback.status === "playing" || playback.status === "completed" ? "disabled" : ""}>播放</button>
      <button type="button" class="modal-button" data-replay-control="pause" ${playback.status !== "playing" ? "disabled" : ""}>暂停</button>
      <button type="button" class="modal-button" data-replay-control="step" ${playback.currentStepIndex >= playback.totalSteps ? "disabled" : ""}>步进</button>
      <button type="button" class="modal-button" data-replay-control="reset" ${playback.currentStepIndex === 0 && playback.status !== "completed" ? "disabled" : ""}>重置</button>
    </div>
    <p class="account-meta">${escapeHtml(input.loading ? "正在刷新回放详情..." : input.status?.trim() || "按步骤回放本场战斗。")}</p>
    ${renderBattleReplayReportSummary(input.account, input.replay)}
    <div class="account-replay-progress">
      <div><strong>当前动作</strong><span>${escapeHtml(formatBattleReplayAction(playback.currentStep))}</span><span class="account-meta">${escapeHtml(currentTimelineEntry ? formatBattleReplayRound(currentTimelineEntry) : "等待开始")}</span></div>
      <div><strong>下一动作</strong><span>${escapeHtml(formatBattleReplayAction(playback.nextStep))}</span><span class="account-meta">${escapeHtml(nextTimelineEntry ? formatBattleReplayRound(nextTimelineEntry) : playback.status === "completed" ? "胜负已结算" : "无下一步")}</span></div>
    </div>
    ${
      currentTimelineEntry
        ? `<div class="account-replay-impact">
            <strong>本步结算</strong>
            ${
              currentTimelineEntry.changes.length > 0
                ? currentTimelineEntry.changes
                    .map((change) => `<span class="account-reward-chip">${escapeHtml(formatBattleReplayChange(change))}</span>`)
                    .join("")
                : `<span class="account-meta">本步未产生可见结算。</span>`
            }
          </div>`
        : ""
    }
    <div class="account-replay-state">
      ${
        activeUnits.length > 0
          ? activeUnits
              .map((unit) => {
                const effects = (unit.statusEffects ?? []).map((effect) => effect.name).filter(Boolean);
                return `<div class="account-replay-unit ${unit.camp === "attacker" ? "is-attacker" : "is-defender"}">
                  <div class="account-replay-unit-head">
                    <strong>${escapeHtml(unit.stackName)}</strong>
                    <span>${escapeHtml(`${unit.camp === "attacker" ? "攻方" : "守方"} · ${unit.id}`)}</span>
                  </div>
                  <div class="account-replay-unit-meta">
                    <span>数量 ${unit.count}</span>
                    <span>HP ${unit.currentHp}/${unit.maxHp}</span>
                    <span>格位 ${unit.lane}</span>
                    ${unit.defending ? "<span>防御中</span>" : ""}
                    ${effects.map((effect) => `<span>${escapeHtml(effect)}</span>`).join("")}
                  </div>
                </div>`;
              })
              .join("")
          : '<div class="account-replay-unit"><span class="account-meta">当前战场没有可展示的存活单位。</span></div>'
      }
    </div>
    <div class="account-replay-step-list">
      ${timeline
        .map((entry) => {
          const step = entry.step;
          const tone =
            step.index === playback.currentStepIndex
              ? "is-current"
              : step.index < playback.currentStepIndex
                ? "is-complete"
                : "is-upcoming";
          return `<div class="account-replay-step ${tone}">
            <span class="account-badge">${step.index}</span>
            <div class="account-replay-step-copy">
              <strong>${escapeHtml(formatBattleReplayAction(step))}</strong>
              <span class="account-meta">${escapeHtml(formatBattleReplayRound(entry))}</span>
              ${
                entry.changes.length > 0
                  ? `<span class="account-meta">${escapeHtml(entry.changes.map((change) => formatBattleReplayChange(change)).join(" / "))}</span>`
                  : ""
              }
            </div>
            <span>${escapeHtml(formatBattleReplaySourceLabel(step.source))}</span>
          </div>`;
        })
        .join("")}
    </div>
  </div>`;
}
