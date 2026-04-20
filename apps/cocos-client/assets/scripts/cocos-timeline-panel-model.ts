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

export function parseTimelineEntry(entry: string): TimelineEntryView {
  if (entry.startsWith("[系统]")) {
    return {
      tone: "system",
      badge: "系统",
      body: entry.replace(/^\[系统\]\s*/, "").trim() || entry
    };
  }

  if (entry.startsWith("[事件]")) {
    return {
      tone: "event",
      badge: "事件",
      body: entry.replace(/^\[事件\]\s*/, "").trim() || entry
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
