Original prompt: 你先学习下当前项目并给出开发的计划

## Discovery notes

- 仓库是全栈 TypeScript monorepo，当前主运行时是 `apps/cocos-client`，`apps/client` 主要承担 H5 调试壳、配置联调和回归测试。
- 共享核心能力已经比较完整：世界地图、迷雾、A*、建筑交互、战斗技能、战场环境、账号/长期档、多人同步与重连都已落在 `packages/shared` 和 `apps/server`。
- `PHASE2_DEVELOPMENT_PLAN.md` 与当前代码状态有明显偏差，里面把若干已完成能力（建筑交互、战斗技能、环境系统、中立追击）仍标为未完成或低完成度。
- 当前项目已经有 Playwright E2E，但主要是面向 DOM 版 H5 调试壳；还没有按 `develop-web-game` 技能约定暴露 `window.render_game_to_text` / `window.advanceTime(ms)`。
- H5 调试壳不是单 canvas 架构，而是 DOM 面板 + 网格交互，更适合现有 Playwright spec，不适合直接套用技能里的 canvas 假设。

## Baseline checks

- `npm test` 基本通过，但有 1 个失败：`apps/server/test/config-center.test.ts`。
- 失败根因是本地环境缺少 `xlsx` 依赖，`npm ls xlsx` 返回空，`node_modules/xlsx` 不存在。
- `npm run test:e2e` 有 4 个失败，表现更像测试预期和当前配置/文案漂移，而不是核心链路彻底损坏。
- 已确认的 E2E 漂移示例：
  - 神社当前配置是 `attack +2`，但测试仍断言 `+1`。
  - 木材矿当前配置是 `income: 5` 且事件文案为中文，但测试仍断言 `Wood +2/day`。
  - 资源点/路线预期与当前地图配置不一致，导致金币收集测试失败。
  - 战斗胜利弹窗测试失败，需要进一步确认是弹窗触发时序变化还是流程回归。

## Suggested next steps

- 先修复开发基线：
  - 补齐 `xlsx` 依赖并恢复 `config-center` 测试。
  - 统一更新 H5 E2E 断言，使其匹配当前配置与文案。
- 再收口测试策略：
  - 继续把 `apps/client` 作为快速回归壳。
  - 把新增玩法优先落到 shared/server，再由 H5 和 Cocos 共用验证。
  - 如要深度使用 `develop-web-game` 自动试玩脚本，先给 H5 调试壳补 `render_game_to_text` / `advanceTime(ms)`。
- 功能开发优先级建议：
  - 先做“测试基线和配置一致性”。
  - 再做“主客户端体验收口”（Cocos 战斗/地图/UI 表现）。
  - 最后做“新系统扩展”（内容量、长期成长、更多地图/战斗玩法）。

## TODOs for next agent

- 确认 `package-lock.json` / 依赖安装链路为何漏掉 `xlsx`。
- 对照 `configs/*.json` 更新 `tests/e2e/*.spec.ts` 的旧坐标、旧数值和旧文案。
- 决定是否要为 `apps/client` 增加 `render_game_to_text` / `advanceTime(ms)`，以兼容 `develop-web-game` 技能脚本。

## Baseline repair - 2026-03-27

- 已执行 `npm install`，当前本地依赖已补齐，`xlsx` 相关测试恢复。
- 已更新 H5 基线用例：
  - `tests/e2e/battle-flow.spec.ts`
  - `tests/e2e/map-movement.spec.ts`
- 调整内容包括：
  - 中立战斗改为连续攻击直到实际结算，避免把“一击必胜”写死。
  - 招募场景改为按当前地图与迷雾逐段揭图、拿到远处金币后再回招募所。
  - 神社断言改为当前配置值 `攻击 +2`。
  - 矿场断言改为当前真实行为：首次点击立即获得 `+5` 木材，推进到下一天后可再次手动领取；当前还没有自动 `resource.produced` 日结链路。
- 当前验证结果：
  - `npm test` 通过（192/192）
  - `npm run test:e2e` 通过（5/5）
- 技能脚本补充说明：
  - 尝试运行 `develop-web-game` 自带的 `web_game_playwright_client.js` 时，因脚本从 `~/.codex` 路径执行，ESM 无法直接解析当前项目的 `playwright` 依赖。
  - 本轮改用仓库现有 Playwright E2E 完成实际交互验证；如果后续要严格接入该技能脚本，建议优先解决脚本侧模块解析，或给 H5 壳补 `render_game_to_text` / `advanceTime(ms)` 后一并收口。

## H5 automation hooks - 2026-03-27

- 已在 `apps/client/src/main.ts` 为 H5 调试壳补上：
  - `window.render_game_to_text`
  - `window.advanceTime(ms)`
  - 一个可被自动化时间推进复用的轻量 UI 调度器，用来接管原先的 `setTimeout` 动画/战斗特效时序。
- `render_game_to_text` 当前会输出：
  - 世界/战斗/大厅模式
  - 坐标系说明
  - 当前房间、天数、资源、选中英雄
  - 可见英雄、可交互地块、可达点、预演路径
  - 模态框、动画状态、战斗摘要、日志尾部
- 已修复 `apps/client/src/object-visuals.ts` 的 H5 类型漂移：
  - 神社不再引用不存在的 `visitedHeroIds`
  - 矿场不再引用不存在的 `ownerPlayerId`
  - 现改为读取 `lastUsedDay` / `lastHarvestDay`
- 已补服务端本地模式降级，避免未配置 MySQL 持久化时玩家资料接口返回 `503`：
  - `apps/server/src/player-accounts.ts`
  - 读取资料/战报/成长快照时改为返回本地空档案或空列表
  - `/me` 与本地更新接口在无持久化时也会返回 `200`，并在可用时同步回新的会话昵称
- 已补测试覆盖本地模式降级：
  - `apps/server/test/player-account-routes.test.ts`

## Hook verification - 2026-03-27

- `npm test` 通过（194/194）
- `npm run test:e2e` 通过（5/5）
- `npm run typecheck:client:h5` 此前已通过；本轮服务端改动未影响 H5 hook 类型链路。
- 为了让技能脚本解析到项目里的 Playwright 依赖，已建立软链：
  - `~/.codex/skills/develop-web-game/node_modules -> /Users/grace/Documents/project/codex/ProjectVeil/node_modules`
- 已重新运行技能脚本：
  - URL: `http://127.0.0.1:4173/?roomId=hook-check&playerId=player-1`
  - 输出目录：`output/web-game-hooks`
- 本轮脚本产物：
  - `shot-0.png`
  - `state-0.json`
  - 没有生成 `errors-0.json`
- 依据脚本实现，`errors-0.json` 只会在检测到新的控制台错误时写出；本轮未生成该文件，可视为 `503` 控制台噪声已清除。
- `state-0.json` 已确认包含正确的世界状态摘要，仍能读到：
  - `hook-check / player-1 / day 1`
  - 英雄 `凯琳` 位于 `(1,1)`
  - 可见木材、伐木场、招募所等交互对象

## Keyboard automation controls - 2026-03-27

- 为了让 `develop-web-game` 技能脚本在 DOM 网格壳上也能“实际操作”，已为 `apps/client/src/main.ts` 增加全局键盘控制：
  - 世界地图：
    - 方向键移动地图光标
    - `Enter / Space` 交互当前光标所在格
    - `B` 推进到下一天
  - 战斗中：
    - 方向键切换目标
    - `Enter / Space` 普攻
    - `A` 释放当前可用主动技能（没有可用技能时回退到普攻）
    - `B` 防御；若已在防御姿态则改为等待
  - 弹窗：
    - `Enter / Space / Escape` 关闭
- 已把 `keyboardCursor` 和快捷键说明一起写入 `render_game_to_text`，方便自动化脚本和后续 agent 直接读取当前键盘焦点与可用输入。
- 已给地图格子增加 `is-keyboard-cursor` 视觉高亮，便于从截图判断自动化光标位置。
- 已让 `advanceTime(ms)` 在推进 UI 定时任务之外，额外等待一个很短的真实时间片；这样技能脚本逐帧推进时，房间同步和战斗结算的异步回包也能稳定落地，不会因为动作发送过快而“抢跑”。

## Keyboard verification - 2026-03-27

- 新增 E2E：
  - `tests/e2e/keyboard-controls.spec.ts`
  - 覆盖“键盘拾取木材 -> 占矿 -> 推日 -> 再次领取”
  - 覆盖“键盘接战 -> 连续攻击 -> 关闭胜利弹窗”
- 当前验证结果：
  - `npm run typecheck:client:h5` 通过
  - `npm run test:e2e` 通过（7/7）
  - `npm test` 通过（194/194）
- 新增技能脚本动作文件：
  - `tests/automation/keyboard-battle.actions.json`
- 已使用技能脚本实际验证：
  - URL: `http://127.0.0.1:4173/?roomId=keyboard-hook-check&playerId=player-1`
  - 输出目录：`output/web-game-keyboard-battle`
- 本轮技能脚本结果：
  - 生成 `shot-0.png` 与 `state-0.json`
  - 未生成 `errors-0.json`
  - `state-0.json` 显示：
    - 最终已回到 `world` 模式
    - `gold = 300`
    - 英雄位于 `(5,4)`
    - `keyboardCursor = { x: 5, y: 4 }`
    - 战斗奖励与升级日志都已落入 `timelineTail / logTail`

## Resource / recruit automation scripts - 2026-03-27

- 已新增动作文件：
  - `tests/automation/keyboard-resource-flow.actions.json`
  - `tests/automation/keyboard-recruit-flow.actions.json`
- 资源流脚本覆盖：
  - 左移到木材
  - 拾取木材
  - 移动到伐木场
  - 占矿
  - 推进到下一天
  - 再次领取
- 资源流技能脚本实测结果：
  - URL: `http://127.0.0.1:4173/?roomId=resource-flow-check&playerId=player-1`
  - 输出目录：`output/web-game-resource-flow`
  - 未生成 `errors-0.json`
  - `state-0.json` 结果：
    - `day = 2`
    - `wood = 15`
    - 英雄停在 `(3,1)` 伐木场
    - `lastHarvestDay = 2`
- 招募流脚本覆盖：
  - 下移到招募所附近并消耗完第 1 天移动力
  - 推进到第 2 天
  - 下移到金币点并拾取 `gold +500`
  - 回到招募所
  - 招募 4 个 `hero_guard_basic`
- 招募流技能脚本实测结果：
  - URL: `http://127.0.0.1:4173/?roomId=recruit-flow-check&playerId=player-1`
  - 输出目录：`output/web-game-recruit-flow`
  - 未生成 `errors-0.json`
  - `state-0.json` 结果：
    - `day = 2`
    - `gold = 260`
    - `armyCount = 16`
    - 英雄停在 `(1,3)` 招募所
    - 招募所 `availableCount = 0`
- 已实际检查两张截图：
  - 资源流截图停在伐木场，无战斗面板残留，地图与说明卡一致。
  - 招募流截图停在招募所，说明卡显示今日库存已售罄，与 `availableCount = 0` 一致。

## TODOs for next agent

- 如果要继续用技能脚本做更长链路，可以在 `tests/automation/` 下追加：
  - 技能脚本（进入战斗后优先按 `A` 演练主动技能）
  - 混合脚本（拿木 -> 占矿 -> 推日 -> 拿金 -> 回招募所 -> 招募）
- 目前 `advanceTime(ms)` 的真实等待是偏稳妥的保守值；如果后续想压缩脚本运行时长，可以在不引入抖动的前提下再微调。

## TODOs for next agent

- 如需继续深度使用 `develop-web-game`，可以基于 `output/web-game-hooks/state-0.json` 开始设计更完整的动作脚本，验证拾取、占矿、招募、战斗、结算等多步链路。
- 如果要减少工作区噪声，注意当前 `configs/units.json` 只有格式化层面的改动，不是本轮玩法逻辑修改。
