import {
  formatAchievementLabel,
  formatWorldEventTypeLabel,
  getLatestProgressedAchievement,
  getLatestUnlockedAchievement
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
