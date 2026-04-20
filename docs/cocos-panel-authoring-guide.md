# Cocos Panel Authoring Guide

`apps/cocos-client/assets/scripts/` 里的前台面板统一遵循 `View / ViewModel` 分层：

- `VeilXxxPanel.ts`
  - 只负责 Cocos 节点绑定、布局绘制、事件委托、按钮命中和 callback 分发。
- `cocos-xxx-panel-model.ts`
  - 只负责把 room/account/runtime 状态整理成可渲染的纯数据。
  - 不依赖 `cc`，方便单测和回归。

## 命名约定

- View 组件：`VeilHudPanel.ts`
- ViewModel：`cocos-hud-panel-model.ts`
- 测试：`apps/cocos-client/test/cocos-hud-panel-model.test.ts`

历史遗留特例：

- `cocos-settings-panel.ts` 仍保留旧文件名作为 View 组件。
- 它对应的 ViewModel 已迁到 [cocos-settings-panel-model.ts](/Users/grace/Documents/project/codex/ProjectVeil/apps/cocos-client/assets/scripts/cocos-settings-panel-model.ts)。

## 允许的依赖方向

View 组件可以做 value import 的模块：

- `cc`
- `@veil/shared/*`
- `./cocos-*.ts`
- `./project-shared/*.ts`

额外规则：

- panel 组件不能再从别的 `Veil*.ts` 组件里拿业务计算。
- 纯计算、文案拼装、状态映射都要进 `cocos-*-panel-model.ts`。
- type-only import 不受上面的 value import 约束。

门禁脚本：

- [check-cocos-panel-boundaries.mjs](/Users/grace/Documents/project/codex/ProjectVeil/scripts/check-cocos-panel-boundaries.mjs)
- [audit-cocos-panel-view-models.mjs](/Users/grace/Documents/project/codex/ProjectVeil/scripts/audit-cocos-panel-view-models.mjs)

## 新建面板

用生成器起步：

```bash
npm run generate:cocos:panel -- --name QuestTracker
```

它会生成：

- `apps/cocos-client/assets/scripts/VeilQuestTrackerPanel.ts`
- `apps/cocos-client/assets/scripts/cocos-quest-tracker-panel-model.ts`
- `apps/cocos-client/test/cocos-quest-tracker-panel-model.test.ts`

## 迁移 checklist

1. 先把当前 panel 的纯计算搬到 `cocos-*-panel-model.ts`
2. 给 model 补 focused unit tests
3. 把 panel 改成只消费 model 输出
4. 通过 `npm run lint:cocos:panels`
5. 通过 `npm run typecheck -- cocos`
6. 跑 `npm run smoke -- cocos:canonical-journey`

## 当前覆盖面

当前已纳入 panel/model 配对审计的 surface：

- `VeilBattlePanel`
- `VeilCampaignPanel`
- `VeilEquipmentPanel`
- `VeilHudPanel`
- `VeilLobbyPanel`
- `VeilMapBoard`
- `VeilProgressionPanel`
- `VeilTimelinePanel`
- `cocos-settings-panel`
