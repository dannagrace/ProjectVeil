import {
  buildBattleReplayTimeline,
  createBattleReplayPlaybackState,
  formatAchievementLabel,
  formatWorldEventTypeLabel,
  getLatestProgressedAchievement,
  getLatestUnlockedAchievement,
  type BattleReplayPlaybackState,
  type BattleReplayStep,
  type BattleReplayTimelineEntry,
  type BattleReplayTimelineUnitChange
} from "../../../packages/shared/src/index";
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

function compareAchievementDisplayOrder(
  left: PlayerAccountProfile["achievements"][number],
  right: PlayerAccountProfile["achievements"][number]
): number {
  if (left.unlocked !== right.unlocked) {
    return left.unlocked ? -1 : 1;
  }

  const leftStarted = left.current > 0 || Boolean(left.progressUpdatedAt);
  const rightStarted = right.current > 0 || Boolean(right.progressUpdatedAt);
  if (leftStarted !== rightStarted) {
    return leftStarted ? -1 : 1;
  }

  const leftTimestamp = left.unlocked ? left.unlockedAt ?? left.progressUpdatedAt ?? "" : left.progressUpdatedAt ?? "";
  const rightTimestamp = right.unlocked ? right.unlockedAt ?? right.progressUpdatedAt ?? "" : right.progressUpdatedAt ?? "";
  const timestampOrder = rightTimestamp.localeCompare(leftTimestamp);
  if (timestampOrder !== 0) {
    return timestampOrder;
  }

  const progressOrder = right.current - left.current;
  return progressOrder || left.title.localeCompare(right.title, "zh-Hans-CN");
}

function formatAchievementFootnote(achievement: PlayerAccountProfile["achievements"][number]): string {
  if (achievement.unlocked) {
    return `解锁于 ${formatTimestamp(achievement.unlockedAt ?? achievement.progressUpdatedAt ?? "")}`;
  }

  const remaining = Math.max(0, achievement.target - achievement.current);
  const progressLabel = achievement.progressUpdatedAt ? `最近推进 ${formatTimestamp(achievement.progressUpdatedAt)} · ` : "";
  return `${progressLabel}还差 ${remaining} 点进度`;
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

  const sortedAchievements = [...account.achievements].sort(compareAchievementDisplayOrder);
  return `<div class="account-subsection">
    <strong>成就进度</strong>
    <p class="account-meta">${escapeHtml(formatAchievementSummary(account))}</p>
    <div class="account-achievement-list">
      ${sortedAchievements
        .map((achievement) => {
          const ratio =
            achievement.target > 0 ? Math.min(100, Math.round((achievement.current / achievement.target) * 100)) : 0;
          return `<div class="account-achievement ${achievement.unlocked ? "is-unlocked" : ""}">
            <div class="account-achievement-head">
              <span>${escapeHtml(achievement.title)}</span>
              <span class="account-achievement-status">${achievement.unlocked ? "已解锁" : "进行中"}</span>
            </div>
            <div class="account-achievement-meta">
              <span>${achievement.current}/${achievement.target}</span>
              <span>${ratio}%</span>
            </div>
            <div class="account-achievement-bar"><span style="width:${ratio}%"></span></div>
            <p>${escapeHtml(achievement.description)}</p>
            <div class="account-achievement-foot">${escapeHtml(formatAchievementFootnote(achievement))}</div>
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
  if (account.recentBattleReplays.length === 0) {
    return '<div class="account-subsection"><strong>最近战报</strong><p class="account-meta">尚未记录可回看的战斗摘要。</p></div>';
  }

  const visibleReplays = account.recentBattleReplays.slice(0, 6);
  return `<div class="account-subsection">
    <strong>最近战报</strong>
    <p class="account-meta">最近 ${visibleReplays.length} 场战斗的回放摘要</p>
    <div class="account-replay-list">
      ${visibleReplays
        .map((replay) => {
          const stepSummary = summarizeBattleReplaySteps(replay);
          const isSelected = options.selectedReplayId === replay.id;
          const summaryChips = [
            `回放 ${replay.steps.length} 步`,
            `玩家 ${stepSummary.player}`,
            `自动 ${stepSummary.automated}`,
            stepSummary.attack > 0 ? `攻击 ${stepSummary.attack}` : "",
            stepSummary.skill > 0 ? `技能 ${stepSummary.skill}` : ""
          ].filter(Boolean);
          return `<button type="button" class="account-replay-entry ${replay.result === "attacker_victory" ? "is-victory" : "is-defeat"} ${isSelected ? "is-selected" : ""}" data-select-replay="${escapeHtml(replay.id)}">
            <div class="account-replay-head">
              <span class="account-badge tone-${replay.result === "attacker_victory" ? "victory" : "defeat"}">${escapeHtml(formatBattleReplayResultLabel(replay))}</span>
              <span>${escapeHtml(formatTimestamp(replay.completedAt))}</span>
            </div>
            <p>${escapeHtml(`${formatBattleReplayKind(replay)} · ${formatBattleReplayEncounter(replay)}`)}</p>
            <div class="account-replay-meta">
              <span>房间 ${escapeHtml(replay.roomId)}</span>
              <span>阵营 ${escapeHtml(formatBattleReplayCamp(replay))}</span>
              <span>英雄 ${escapeHtml(replay.heroId)}</span>
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
  const replayCount = input.account.recentBattleReplays.length;
  const headline =
    replayCount > 0
      ? `最近累计 ${replayCount} 场战斗，支持从列表进入详情或基础回放。`
      : "暂无可回看的战斗记录，完成一场战斗后这里会自动出现首批战报。";

  return `<section class="account-subsection account-replay-center" data-testid="battle-report-center">
    <div class="account-replay-center-head">
      <div>
        <strong>战报与回放中心</strong>
        <p class="account-meta">${escapeHtml(headline)}</p>
      </div>
      <span class="account-badge">${replayCount > 0 ? `战报 ${replayCount}` : "暂无战报"}</span>
    </div>
    ${renderRecentBattleReplays(input.account, {
      ...(input.selectedReplayId !== undefined ? { selectedReplayId: input.selectedReplayId } : {})
    })}
    ${renderBattleReplayInspector({
      replay: input.replay,
      playback: input.playback,
      ...(input.loading !== undefined ? { loading: input.loading } : {}),
      ...(input.status !== undefined ? { status: input.status } : {})
    })}
  </section>`;
}

export function renderBattleReplayInspector(input: {
  replay: PlayerAccountProfile["recentBattleReplays"][number] | null;
  playback: BattleReplayPlaybackState | null;
  loading?: boolean;
  status?: string;
}): string {
  if (!input.replay) {
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
