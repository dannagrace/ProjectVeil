import { escapeHtml } from "@veil/shared/escape-html";

export function renderBattleLogLines(lines: readonly string[]): string {
  return lines.map((line) => `<div class="battle-log-line">${escapeHtml(line)}</div>`).join("");
}

export function renderEventLogLines(lines: readonly string[]): string {
  return lines.map((line) => `<div class="log-line">${escapeHtml(line)}</div>`).join("");
}

export function renderTimelineCopy(text: string): string {
  return `<strong class="timeline-copy">${escapeHtml(text)}</strong>`;
}

export function renderBattleModalTitle(title: string): string {
  return `<h2 data-testid="battle-modal-title">${escapeHtml(title)}</h2>`;
}

export function renderBattleModalBody(body: string): string {
  return `<p data-testid="battle-modal-body">${escapeHtml(body)}</p>`;
}
