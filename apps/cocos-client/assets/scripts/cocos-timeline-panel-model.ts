export interface TimelineEntryView {
  tone: "system" | "event";
  badge: string;
  body: string;
}

export interface TimelinePanelViewModel {
  headerLines: string[];
  entries: TimelineEntryView[];
  empty: boolean;
}

function trimTimelinePrefix(entry: string, pattern: RegExp): string {
  return entry.replace(pattern, "").trim() || entry;
}

export function parseTimelineEntry(entry: string): TimelineEntryView {
  if (/^(?:\[系统\]|系统：)\s*/.test(entry)) {
    return {
      tone: "system",
      badge: "系统",
      body: trimTimelinePrefix(entry, /^(?:\[系统\]|系统：)\s*/)
    };
  }

  if (/^(?:\[事件\]|事件：)\s*/.test(entry)) {
    return {
      tone: "event",
      badge: "事件",
      body: trimTimelinePrefix(entry, /^(?:\[事件\]|事件：)\s*/)
    };
  }

  return {
    tone: "event",
    badge: "记录",
    body: entry
  };
}

export function buildTimelinePanelView(entries: string[], limit = 3): TimelinePanelViewModel {
  const visibleEntries = entries.slice(0, limit).map(parseTimelineEntry);
  return {
    headerLines: ["时间线"],
    entries: visibleEntries,
    empty: visibleEntries.length === 0
  };
}
