import type { SessionUpdate } from "../VeilCocosSession.ts";

export function cloneSessionUpdate(update: SessionUpdate): SessionUpdate {
  return JSON.parse(JSON.stringify(update)) as SessionUpdate;
}

export function collapseAdjacentEntries(entries: string[]): string[] {
  const collapsed: string[] = [];
  for (const entry of entries) {
    if (collapsed[collapsed.length - 1] === entry) {
      continue;
    }
    collapsed.push(entry);
  }
  return collapsed;
}
