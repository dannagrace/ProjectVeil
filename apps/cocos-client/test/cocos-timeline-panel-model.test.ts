import assert from "node:assert/strict";
import test from "node:test";
import { buildTimelinePanelView, parseTimelineEntry } from "../assets/scripts/cocos-timeline-panel-model.ts";

test("parseTimelineEntry keeps explicit badges and falls back to generic records", () => {
  assert.deepEqual(parseTimelineEntry("[系统] 资源已同步"), {
    tone: "system",
    badge: "系统",
    body: "资源已同步",
  });
  assert.deepEqual(parseTimelineEntry("[事件] 英雄升级"), {
    tone: "event",
    badge: "事件",
    body: "英雄升级",
  });
  assert.deepEqual(parseTimelineEntry("普通记录"), {
    tone: "event",
    badge: "记录",
    body: "普通记录",
  });
});

test("buildTimelinePanelView limits the rendered entries while keeping the fixed header", () => {
  const view = buildTimelinePanelView(
    ["[系统] 房间同步", "[事件] 完成任务", "普通记录", "额外记录"],
    3
  );

  assert.deepEqual(view.headerLines, ["时间线"]);
  assert.equal(view.empty, false);
  assert.equal(view.entries.length, 3);
  assert.deepEqual(
    view.entries.map((entry) => entry.badge),
    ["系统", "事件", "记录"]
  );
});
