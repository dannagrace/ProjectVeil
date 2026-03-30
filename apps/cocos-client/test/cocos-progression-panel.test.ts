import assert from "node:assert/strict";
import test from "node:test";
import { VeilProgressionPanel } from "../assets/scripts/VeilProgressionPanel.ts";
import {
  createBattleReplaySummary,
  createComponentHarness,
  createProgressionPanelPage,
  findNode,
  pressNode,
  readCardLabel,
  readLabelString
} from "./helpers/cocos-panel-harness.ts";

test("VeilProgressionPanel switches sections through rendered tab buttons", () => {
  const selectedSections: string[] = [];
  const { component, node } = createComponentHarness(VeilProgressionPanel, {
    name: "ProgressionPanelRoot",
    width: 380,
    height: 440
  });

  component.configure({
    onSelectSection: (section) => {
      selectedSections.push(section);
    }
  });
  component.render({ page: createProgressionPanelPage() });

  assert.match(readCardLabel(node, "ProgressionHeader"), /账号成长/);
  assert.equal(readLabelString(findNode(node, "ProgressionTab-progression")), "成长 3");

  pressNode(findNode(node, "ProgressionTab-battle-replays"));
  pressNode(findNode(node, "ProgressionTab-achievements"));

  assert.deepEqual(selectedSections, ["battle-replays", "achievements"]);
});

test("VeilProgressionPanel emits paged navigation callbacks for event history", () => {
  const pageSelections: Array<[string, number]> = [];
  const { component, node } = createComponentHarness(VeilProgressionPanel, {
    name: "ProgressionPanelRoot",
    width: 380,
    height: 440
  });

  component.configure({
    onSelectPage: (section, page) => {
      pageSelections.push([section, page]);
    }
  });
  component.render({
    page: createProgressionPanelPage([
      { type: "section.selected", section: "event-history" },
      {
        type: "event-history.loaded",
        items: [
          {
            id: "event-page-4",
            timestamp: "2026-03-28T12:08:00.000Z",
            roomId: "room-alpha",
            playerId: "guest-1001",
            category: "combat",
            description: "完成了第四条事件",
            worldEventType: "battle.resolved",
            rewards: []
          },
          {
            id: "event-page-5",
            timestamp: "2026-03-28T12:09:00.000Z",
            roomId: "room-alpha",
            playerId: "guest-1001",
            category: "movement",
            description: "完成了第五条事件",
            worldEventType: "hero.moved",
            rewards: []
          },
          {
            id: "event-page-6",
            timestamp: "2026-03-28T12:10:00.000Z",
            roomId: "room-alpha",
            playerId: "guest-1001",
            category: "achievement",
            description: "完成了第六条事件",
            achievementId: "first_battle",
            rewards: []
          }
        ],
        page: 1,
        pageSize: 3,
        total: 7,
        hasMore: true
      }
    ])
  });

  assert.match(readCardLabel(node, "ProgressionHeader"), /当前页 2\/3/);
  pressNode(findNode(node, "ProgressionPrev"));
  pressNode(findNode(node, "ProgressionNext"));

  assert.deepEqual(pageSelections, [
    ["event-history", 0],
    ["event-history", 2]
  ]);
});

test("VeilProgressionPanel refreshes render callbacks across rerenders", () => {
  const pageSelections: Array<[string, number]> = [];
  const retriedSections: string[] = [];
  let closeCount = 0;
  const { component, node } = createComponentHarness(VeilProgressionPanel, {
    name: "ProgressionPanelRoot",
    width: 380,
    height: 440
  });

  component.configure({
    onClose: () => {
      closeCount += 1;
    },
    onRetrySection: (section) => {
      retriedSections.push(section);
    },
    onSelectPage: (section, page) => {
      pageSelections.push([section, page]);
    }
  });

  component.render({
    page: createProgressionPanelPage([
      { type: "section.selected", section: "battle-replays" },
      {
        type: "battle-replays.loaded",
        items: [
          {
            ...createBattleReplaySummary(),
            id: "replay-page-2",
            battleId: "battle-page-2",
            neutralArmyId: "neutral-2",
            startedAt: "2026-03-28T12:10:00.000Z",
            completedAt: "2026-03-28T12:11:00.000Z",
            steps: [],
            result: "attacker_victory"
          }
        ],
        page: 1,
        pageSize: 1,
        hasMore: false
      }
    ])
  });

  pressNode(findNode(node, "ProgressionPrev"));
  pressNode(findNode(node, "ProgressionClose"));

  component.render({
    page: createProgressionPanelPage([
      { type: "section.selected", section: "event-history" },
      {
        type: "section.failed",
        section: "event-history",
        message: "history_fetch_failed"
      }
    ])
  });

  assert.equal(findNode(node, "ProgressionBanner")?.active, true);
  pressNode(findNode(node, "ProgressionRetry"));
  pressNode(findNode(node, "ProgressionNext"));
  pressNode(findNode(node, "ProgressionClose"));

  component.render({ page: createProgressionPanelPage() });
  pressNode(findNode(node, "ProgressionRetry"));
  pressNode(findNode(node, "ProgressionNext"));

  assert.deepEqual(pageSelections, [["battle-replays", 0]]);
  assert.deepEqual(retriedSections, ["event-history"]);
  assert.equal(closeCount, 2);
});
