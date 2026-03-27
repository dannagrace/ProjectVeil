import { getLatestUnlockedAchievement } from "../../../packages/shared/src/index";
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

function formatAchievementSummary(account: PlayerAccountProfile): string {
  const unlocked = account.achievements.filter((achievement) => achievement.unlocked).length;
  const latestUnlocked = getLatestUnlockedAchievement(account.achievements);
  return latestUnlocked
    ? `成就 ${unlocked}/${account.achievements.length} 已解锁 · 最新 ${latestUnlocked.title}`
    : `成就 ${unlocked}/${account.achievements.length} 已解锁`;
}

export function renderAchievementProgress(account: PlayerAccountProfile): string {
  if (account.achievements.length === 0) {
    return '<p class="account-meta">暂无成就数据</p>';
  }

  return `<div class="account-subsection">
    <strong>成就进度</strong>
    <p class="account-meta">${escapeHtml(formatAchievementSummary(account))}</p>
    <div class="account-achievement-list">
      ${account.achievements
        .map((achievement) => {
          const ratio =
            achievement.target > 0 ? Math.min(100, Math.round((achievement.current / achievement.target) * 100)) : 0;
          const footnote = achievement.unlocked
            ? `解锁于 ${formatTimestamp(achievement.unlockedAt ?? "")}`
            : `还差 ${Math.max(0, achievement.target - achievement.current)} 点进度`;
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
            <div class="account-achievement-foot">${escapeHtml(footnote)}</div>
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

  return `<div class="account-subsection">
    <strong>世界事件日志</strong>
    <p class="account-meta">最近 ${account.recentEventLog.length} 条关键事件</p>
    <div class="account-event-list">
      ${account.recentEventLog
        .map((entry) => {
          const details = [
            entry.heroId ? `英雄 ${entry.heroId}` : "",
            entry.worldEventType ? `事件 ${entry.worldEventType}` : "",
            entry.achievementId ? `成就 ${entry.achievementId}` : ""
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

export function renderRecentBattleReplays(account: PlayerAccountProfile): string {
  if (account.recentBattleReplays.length === 0) {
    return '<div class="account-subsection"><strong>最近战报</strong><p class="account-meta">尚未记录可回看的战斗摘要。</p></div>';
  }

  const visibleReplays = account.recentBattleReplays.slice(0, 3);
  return `<div class="account-subsection">
    <strong>最近战报</strong>
    <p class="account-meta">最近 ${visibleReplays.length} 场战斗的回放摘要</p>
    <div class="account-replay-list">
      ${visibleReplays
        .map((replay) => {
          const stepSummary = summarizeBattleReplaySteps(replay);
          const summaryChips = [
            `回放 ${replay.steps.length} 步`,
            `玩家 ${stepSummary.player}`,
            `自动 ${stepSummary.automated}`,
            stepSummary.attack > 0 ? `攻击 ${stepSummary.attack}` : "",
            stepSummary.skill > 0 ? `技能 ${stepSummary.skill}` : ""
          ].filter(Boolean);
          return `<div class="account-replay-entry ${replay.result === "attacker_victory" ? "is-victory" : "is-defeat"}">
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
          </div>`;
        })
        .join("")}
    </div>
  </div>`;
}
