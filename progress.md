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

## Bugfix branch - Cocos battle rejection feedback - 2026-03-29

- 已修复 Cocos Preview 中的战斗拒绝态反馈缺失：
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
  - `apps/cocos-client/assets/scripts/cocos-ui-formatters.ts`
  - `apps/cocos-client/test/cocos-ui-formatters.test.ts`
- 现在 `battle.attack / battle.skill / battle.wait / battle.defend` 这类战斗指令在返回 `SessionUpdate.reason` 时，会像世界操作一样把拒绝结果写进顶层日志和 `predictionStatus`，并统一翻译 battle reason：
  - `friendly_fire_blocked -> 不能攻击友军`
  - `skill_on_cooldown -> 这个技能还在冷却中`
  - `skill_target_missing -> 技能目标不存在`
  - `unit_not_active / attacker_not_active -> 当前还没轮到这个单位行动`
- 进一步修复时间线中的系统拒绝项仍显示内部 reason code 的问题；现在时间线会显示中文原因，而不是 `friendly_fire_blocked` 这类内部字符串。
- Cocos Preview 实跑验证：
  - `New Run -> 移动到 (5,4) -> 非法攻击自己`
    - 顶部日志：`战斗指令被拒绝：不能攻击友军`
    - 状态栏：`战斗指令被拒绝：不能攻击友军`
    - 时间线：`系统：操作被拒绝，原因是 不能攻击友军`
  - 在同一场战斗里，随后对敌方打出一次合法普攻，旧拒绝状态会清空，不会残留。
  - `power_shot` 首次施放成功，第二次会正确返回并显示 `这个技能还在冷却中`。
- 自动验证：
  - `node --import tsx --test ./apps/cocos-client/test/cocos-ui-formatters.test.ts`
  - `npm run typecheck:cocos`
  - `npm test` 通过（`424/424`）
- 运行时产物：
  - `output/cocos-battle-rejection-runtime-3/battle-rejection.png`
  - `output/cocos-battle-rejection-runtime-3/result.json`
- 备注：
  - 一次技能 probe 误把 `targetId` 写成了 `targetUnitId`，导致假性 `skill_target_missing`；已确认这是测试脚本误传，不是客户端 bug。
  - `develop-web-game` 技能脚本对 Cocos Preview 的 headless 截图仍是黑屏（`output/cocos-battle-rejection-baseline-2/shot-0.png`），所以本轮仍以 headed Playwright + Creator Preview 截图为准。

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

## Issue #30 - WeChat login slice - 2026-03-28

- 当前分支：`codex/issue-30-wechat-code2session`
- 本轮聚焦 `#30 微信小游戏适配与发布` 里的“微信登录集成”子任务，已补齐：
  - `wx.login() -> code2Session` 的真实/Mock 双路径
  - WeChat OpenID 绑定到现有账号系统
  - 微信昵称 / 头像同步到玩家资料
- 服务端本轮落点：
  - `apps/server/src/auth.ts`
    - 新增 `production/mock/disabled` 三态小游戏登录配置
    - 生产模式下调用 `code2Session`
    - 已登录账号携带 Bearer token 时，会把 OpenID 绑定到现有账号，并保留 `loginId` / `account` 会话语义
    - 同一 OpenID 再次登录时会复用已绑定玩家，而不是接受新的伪造 `playerId`
  - `apps/server/src/persistence.ts`
    - 玩家账号持久化新增 `avatar_url`
    - 玩家账号持久化新增 `wechat_mini_game_open_id / union_id / bound_at`
    - MySQL schema 和内存仓库都已补齐对应字段与唯一索引/映射
  - `apps/server/src/player-accounts.ts`
    - 玩家资料路由现在可读写 `avatarUrl`
    - 对外返回时不会泄漏 WeChat OpenID / UnionID
- Cocos 端本轮落点：
  - `apps/cocos-client/assets/scripts/cocos-lobby.ts`
    - 小游戏登录时优先尝试 `wx.getUserProfile`
    - 把昵称、头像和当前 Bearer token 一并发到 `/api/auth/wechat-mini-game-login`
  - `apps/cocos-client/assets/scripts/cocos-login-provider.ts`
    - 登录 provider 已支持透传 `authToken`
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`

- 本轮新增/更新测试：
  - `apps/server/test/auth-guest-login.test.ts`
    - 覆盖 production `code2Session` 交换
    - 覆盖已登录账号绑定 OpenID
    - 覆盖同一 OpenID 再次登录时复用已绑定账号
  - `apps/cocos-client/test/cocos-lobby.test.ts`
    - 覆盖 `Authorization` header、昵称和头像同步
- 本轮验证结果：
  - `npm run typecheck:server` 通过
  - `npm run typecheck:cocos` 通过
  - 定向测试通过（`44/44`）
  - `npm test` 通过（`273/273`）
  - 按 `develop-web-game` 技能脚本做了 H5 烟测：
    - URL: `http://127.0.0.1:4173/?roomId=wechat-issue-30-smoke&playerId=player-1`
    - 动作文件：`tests/automation/keyboard-battle.actions.json`
    - 最终 `state-0.json` 仍正常回到 `world`
    - `gold = 300`
    - 英雄停在 `(5,4)`
    - 未生成 `errors-0.json`
    - 截图已人工检查，无残留战斗 UI；临时 `output/wechat-issue-30-smoke` 产物已清理
- 还未覆盖的 `#30` 范围：
  - Cocos Creator 微信小游戏构建目标与分包/CDN 配置
  - 纹理压缩、按需加载、内存剖析
  - 触控操作、分享转发、安全域名与开发者工具 / 真机验收

## Issue #30 - WeChat build scaffold - 2026-03-28

- 在上一轮登录集成的基础上，本轮继续推进 `#30` 的“构建配置 / 分包预算 / 域名清单”子项。
- 新增配置文件：`apps/cocos-client/wechat-minigame.build.json`
  - 统一记录小游戏项目名、`appid`、构建输出目录、主包预算、总分包预算、网络超时、远程资源根路径与白名单域名
- 新增纯函数工具：`apps/cocos-client/assets/scripts/cocos-wechat-build.ts`
  - 负责归一化小游戏构建配置
  - 生成 `build-templates/wechatgame` 所需模板内容
  - 分析导出结果里的 `game.json` 与 `subpackages` 体积
  - 校验主包 `4MB` / 总分包 `30MB` 预算
- 新增脚本：
  - `scripts/prepare-wechat-minigame-build.ts`
    - 命令：`npm run prepare:wechat-build`
    - 会生成 `apps/cocos-client/build-templates/wechatgame/`
  - `scripts/validate-wechat-minigame-build.ts`
    - 命令：`npm run validate:wechat-build -- --output-dir <wechatgame-build-dir>`
    - 会读取导出目录，输出主包、总分包和分包明细
- 本轮实际生成的模板目录：
  - `apps/cocos-client/build-templates/wechatgame/game.json`
  - `apps/cocos-client/build-templates/wechatgame/project.config.json`
  - `apps/cocos-client/build-templates/wechatgame/codex.wechat.build.json`
  - `apps/cocos-client/build-templates/wechatgame/README.codex.md`
- 文档已补充到：`apps/cocos-client/README.md`
  - 说明如何生成模板
  - 说明如何对导出结果做预算校验
  - 说明当前脚手架与 Creator 内正式 Asset Bundle / Mini Game Subpackage 设置的关系
- 本轮验证结果：
  - `npm run prepare:wechat-build` 通过
  - `npm run typecheck:cocos` 通过
  - 新增测试 `apps/cocos-client/test/cocos-wechat-build.test.ts` 通过（`4/4`）
  - `npm run validate:wechat-build -- --output-dir apps/cocos-client/build-templates/wechatgame` 通过
    - 当前模板目录给出告警：`No subpackages were detected or configured for this build`
    - 这是预期行为，因为还没在 Cocos Creator 中把实际 Asset Bundle 标成 `Mini Game Subpackage`
  - `npm test` 通过（`277/277`）
  - 按 `develop-web-game` 技能脚本回归 H5：
    - URL: `http://127.0.0.1:4173/?roomId=wechat-build-smoke&playerId=player-1`
    - 动作文件：`tests/automation/keyboard-battle.actions.json`
    - 最终 `state-0.json` 显示仍回到 `world`
    - `gold = 300`
    - 英雄位于 `(5,4)`
    - 无 `errors-0.json`
    - 截图已人工检查，无残留战斗 UI；临时产物已清理
- 下一步建议：
  - 在 Cocos Creator 里把目标资源目录真正拆成 Asset Bundle，并设置 `Mini Game Subpackage`
  - 导出一次真实 `wechatgame` 构建目录，再用 `validate:wechat-build` 跑预算校验
  - 补远程资源 CDN 路径与 `downloadFile` 合法域名

## TODOs for next agent

- 如需继续深度使用 `develop-web-game`，可以基于 `output/web-game-hooks/state-0.json` 开始设计更完整的动作脚本，验证拾取、占矿、招募、战斗、结算等多步链路。
- 如果要减少工作区噪声，注意当前 `configs/units.json` 只有格式化层面的改动，不是本轮玩法逻辑修改。

## #33 map object marker polish - 2026-03-28

- 已把地图对象 marker 从“文本 token + 小图标”推进到统一像素资源链路：
  - `apps/cocos-client/assets/scripts/cocos-object-visuals.ts`
    - 新增 `resolveCocosTileMarkerVisual()`
    - 统一输出 map marker 的 `iconKey / fallbackLabel / faction / rarity / interactionType`
    - 空白可移动地块继续隐藏 marker；没有专用图标的泛化建筑会回退到 `建筑` 文本标签
  - `apps/cocos-client/assets/scripts/VeilMapBoard.ts`
    - 对象 chip 现已渲染像素主图标 + `faction / rarity / interaction` badge
    - badge 节点按 chip 尺寸动态排布，缺资源时会自动隐藏
    - 没拿到像素主图标时会回退到简短中文 label，而不是留空
    - 顺手把对象 marker 的点击绑定挪回创建阶段，避免 render 时重复叠加事件监听
- 已把 `pixel/badges/*` 从 `battle` 预载组前移到 `boot`：
  - 地图对象 marker 在 world 空闲态也会用到 badge，不能等进战斗后才补载
  - 对应更新：
    - `configs/cocos-presentation.json`
    - `apps/cocos-client/test/cocos-presentation-config.test.ts`
    - `apps/cocos-client/test/cocos-pixel-sprite-manifest.test.ts`
- 新增/更新测试：
  - `apps/cocos-client/test/cocos-object-visuals.test.ts`
  - 补 `resolveCocosTileMarkerVisual()` 的资源点、敌方英雄、建筑、generic building fallback 覆盖
- 当前验证结果：
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - 定向测试通过
  - `npm test` 通过（281/281）
  - `develop-web-game` smoke 已跑：
    - URL: `http://127.0.0.1:4173/?roomId=issue-33-map-marker-badges&playerId=player-1`
    - 已检查 `shot-0.png`
    - `state-0.json` 显示最终回到 `world`，`gold = 300`，英雄在 `(5,4)`
    - 未生成 `errors-0.json`
    - 临时 `output/` 产物已在核对后清理
- 留给最终人工验收的点：
  - Cocos Creator 里肉眼确认 map marker 的 badge 位置、chip 尺寸和文本回退在不同分辨率下没有挤压

## Feature roadmap analysis - 2026-03-27

- 已新建分支：`codex/feature-roadmap-analysis`
- 本轮未改玩法逻辑，主要补了分析文档：`docs/next-feature-plan.md`
- 用 `develop-web-game` 技能脚本再次验证了 3 条关键链路：
  - 战斗流：守军战斗胜利后 `gold = 300`，英雄升到 `Lv 2`
  - 资源流：木材采集 + 占矿 + 推日后 `wood = 15`
  - 招募流：招募后 `armyCount = 16`，`gold = 260`
- 已实际检查 3 张截图，当前 H5 调试壳的玩法验证没有明显错位，问题主要集中在“主客户端产品化”和“已有系统前台承接不足”：
  - Cocos 仍有占位式战斗转场和占位资源表现
  - 装备 / 战利品 / 战报等数据链路已经存在，但主客户端还没形成完整操作闭环
  - 当前内容循环可玩，但内容密度还不足以支撑下一阶段长线验证
- 本轮分析时生成的临时 `output/` 截图产物已清理，避免给工作区增加噪声。
- 建议下一阶段功能点已整理为 5 项，见 `docs/next-feature-plan.md`

## Cocos equipment loop - 2026-03-27

- 已按 roadmap 第一优先级推进 `Cocos 装备背包与战利品闭环`，本轮主要改动：
  - `apps/cocos-client/assets/scripts/VeilCocosSession.ts`
    - 新增 `equipHeroItem / unequipHeroItem`
    - `WorldAction` / `WorldEvent` 已补 `hero.equip / hero.unequip / hero.equipmentChanged`
  - `apps/cocos-client/assets/scripts/cocos-prediction.ts`
    - 本地预测已支持装备穿戴 / 卸下，失败时返回共享层校验原因
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 已接入装备穿戴 / 卸下交互处理、预演状态与失败回滚
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
    - HUD 新增装备操作区，支持直接点击穿戴 / 卸下
  - `apps/cocos-client/assets/scripts/cocos-ui-formatters.ts`
    - 时间线已补 `hero.equipmentChanged` 文案
  - `apps/cocos-client/assets/scripts/cocos-hero-equipment.ts`
    - 新增装备按钮和背包分组的纯逻辑辅助模块
- 新增 / 更新测试：
  - `apps/cocos-client/test/cocos-hero-equipment.test.ts`
  - `apps/cocos-client/test/cocos-ui-formatters.test.ts`
  - `package.json` 已把新测试接进 `npm test`
- 当前验证结果：
  - `npm run typecheck:cocos` 通过
  - `node --import tsx --test ./apps/cocos-client/test/cocos-ui-formatters.test.ts ./apps/cocos-client/test/cocos-hero-equipment.test.ts` 通过
  - `npm test` 通过（198/198）
  - `develop-web-game` H5 回归脚本再次通过：
    - 战斗流仍能正常结算，最终 `gold = 300`
    - 已实际检查截图，H5 调试壳没有出现新回归
- 当前已知限制：
  - 本轮环境里没有直接打开 Cocos Creator 预览窗口，所以 Cocos 装备区的“代码层 / 类型层 / 测试层”已经闭环，但还需要后续在 Creator 里做一轮肉眼布局验收。

## Cocos battle transition polish - 2026-03-27

- 已继续推进 roadmap 第三项 `Cocos 战斗表现正式化`，先把“战斗转场”从占位状态拉到可用状态：
  - `apps/cocos-client/assets/scripts/VeilBattleTransition.ts`
    - 转场层已改为带遮罩、边框、徽标、标题、副标题的正式 UI
    - 进入 / 退出战斗会根据上下文切换配色与文案，不再只有单行占位提示
  - `apps/cocos-client/assets/scripts/cocos-battle-transition-copy.ts`
    - 新增纯逻辑文案构建器
    - 已根据 `battle.started / hero.collected / hero.equipmentFound / hero.progressed` 生成进入战斗与结算离场文案
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 战斗开始时会把事件上下文传给 `playEnter`
    - 战斗结束时会根据真实结算结果区分胜利 / 失利，不再把退出转场固定写成胜利
  - `apps/cocos-client/types/cc.d.ts`
    - 为本地类型桩补了 `Tween / tween / Graphics.rect`
    - 让转场动画相关代码能通过 Cocos 客户端的 TS 校验
- 新增 / 更新测试：
  - `apps/cocos-client/test/cocos-battle-transition-copy.test.ts`
  - `package.json` 已把转场文案测试接进 `npm test`
- 当前验证结果：
  - `node --import tsx --test ./apps/cocos-client/test/cocos-battle-transition-copy.test.ts ./apps/cocos-client/test/cocos-hero-equipment.test.ts ./apps/cocos-client/test/cocos-ui-formatters.test.ts` 通过（8/8）
  - `npm run typecheck:cocos` 通过
  - `npm test` 通过（200/200）
  - `develop-web-game` H5 回归脚本再次通过：
    - URL: `http://127.0.0.1:4173/?roomId=transition-regression-20260327&playerId=player-1`
    - 输出目录：`/tmp/project-veil-transition-regression`
    - 生成 `shot-0.png` 与 `state-0.json`
    - 未生成 `errors-0.json`
    - `state-0.json` 显示：
      - 最终已回到 `world` 模式
      - `gold = 300`
      - 英雄停在 `(5,4)`
      - `timelineTail` 含“战斗胜利，世界状态已回写”
  - 已实际检查截图：
    - H5 调试壳在战斗结束后正常回到地图视图
    - 右侧战斗面板显示为空闲态，没有出现结算残留或明显 UI 错位
- 当前已知限制：
  - 本轮环境里仍然没有直接打开 Cocos Creator 预览窗口，所以转场的“动效节奏 / 实机字号 / 不同分辨率排版”还需要在 Creator 里做一轮肉眼验收。

## Battle report center surface - 2026-03-27

- 已继续推进 roadmap 第三优先级 `战报 / 回放中心`，先把“最近战报摘要”接到当前双端可见入口：
  - `apps/client/src/account-history.ts`
    - 新增 `renderRecentBattleReplays`
    - H5 账号卡现在会渲染最近 3 场战斗的回放摘要、阵营、步数和攻击 / 技能计数
  - `apps/client/src/main.ts`
    - H5 账号资料卡已接入“最近战报”区块
  - `apps/client/src/styles.css`
    - 已补战报条目、胜利 / 失利徽标和元信息样式
  - `apps/client/src/player-account.ts`
    - 加载账号资料时会额外请求 `/battle-replays`
    - 避免“公开账号资料里没有 recentBattleReplays，导致战报区永远为空”
  - `apps/cocos-client/assets/scripts/cocos-lobby.ts`
    - Cocos 账号资料加载同样会额外请求 `/battle-replays`
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
    - HUD 状态区已接入最近一场战斗的简要摘要
  - `apps/cocos-client/assets/scripts/cocos-battle-report.ts`
    - 新增 Cocos 侧战报摘要构建器，负责压缩最新 replay 为两行稳定文案
- 新增 / 更新测试：
  - `apps/client/test/account-history-render.test.ts`
  - `apps/client/test/player-account-storage.test.ts`
  - `apps/cocos-client/test/cocos-lobby.test.ts`
  - `apps/cocos-client/test/cocos-battle-report.test.ts`
  - `package.json` 已把 Cocos 战报摘要测试接进 `npm test`
- 当前验证结果：
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - 定向测试通过：
    - `node --import tsx --test ./apps/client/test/player-account-storage.test.ts ./apps/client/test/account-history-render.test.ts ./apps/cocos-client/test/cocos-lobby.test.ts ./apps/cocos-client/test/cocos-battle-report.test.ts`
  - `npm test` 通过（204/204）
  - `develop-web-game` H5 回归脚本再次通过：
    - URL: `http://127.0.0.1:4173/?roomId=battle-report-regression-final-20260327&playerId=player-1`
    - 输出目录：`/tmp/project-veil-battle-report-regression-final`
    - 生成 `shot-0.png` 与 `state-0.json`
    - 未生成 `errors-0.json`
    - `state-0.json` 显示：
      - 最终已回到 `world` 模式
      - `gold = 300`
      - `timelineTail` 仍含“战斗胜利，世界状态已回写”
- 当前已知限制：
  - 当前本地 dev server 的公开战报接口实测仍返回空列表：
    - `GET /api/player-accounts/player-1/battle-replays -> {"items":[]}`
  - 所以 H5 首屏截图里看到的是“最近战报”的正确 empty state，不代表前端没接通；代码层与测试层已经覆盖“接口返回 replay 数据时，双端都能正常渲染”的路径。

## Local replay persistence fallback - 2026-03-27

- 已继续把“本地跑起来能看到真实战报”这条链路补通，问题根因是 dev server 在没有 MySQL 配置时没有持久化账号 / 回放数据：
  - `apps/server/src/memory-room-snapshot-store.ts`
    - 新增本地内存版 `RoomSnapshotStore`
    - 现在会在同一进程里保存房间快照、账号资料、最近战报、英雄归档和登录映射
  - `apps/server/src/dev-server.ts`
    - dev server 启动时如果没有外部持久化配置，会自动回退到内存存储
    - 这样本地打一场后，`/api/player-accounts/:playerId` 与 `/battle-replays` 就会返回真实数据，而不是一直走空数据分支
  - `apps/server/src/player-accounts.ts`
    - 顺手收敛了 local mode 账号构造里的可选字段写法
    - 兼容 `exactOptionalPropertyTypes`，避免新增本地存储后触发 TS 报错
- 新增 / 更新测试：
  - `apps/server/test/memory-room-snapshot-store.test.ts`
  - `apps/server/test/player-account-routes.test.ts`
  - `package.json` 已把新的 server 侧内存存储测试接进 `npm test`
- 当前验证结果：
  - `npm run typecheck:server` 通过
  - 定向测试通过：
    - `node --import tsx --test ./apps/server/test/memory-room-snapshot-store.test.ts ./apps/server/test/player-account-routes.test.ts`
  - `npm test` 通过（206/206）
  - 本地联调已验证：
    - `npm run dev:server` 启动后会输出 `Local in-memory room persistence enabled`
    - 初始 `GET /api/player-accounts/player-1/battle-replays` 为空，是因为账号尚未生成
    - 通过 `develop-web-game` 跑完一场本地战斗后，再请求同一路径会返回真实 replay 条目
    - H5 账号卡已能显示非空“最近战报”，包含胜负、对手、回放步数与攻击 / 技能统计
- 当前结论：
  - 现在这条本地预览链路已经从“只能看到 empty state”变成“打一场后即可看到真实最近战报”
  - 下一步再做回放中心详情页时，可以直接复用这条本地数据链路继续迭代，不需要先补环境依赖。

## H5 replay detail controls - 2026-03-28

- 已在 `#27 世界事件日志与成就系统` 下继续推进“战斗回放控制”这一段，当前先把 H5 调试壳补成可用的最近战报详情区：
  - `apps/client/src/account-history.ts`
    - 最近战报条目改为可点击入口，支持高亮当前选中的 replay
    - 新增 `renderBattleReplayInspector`，可渲染回放状态、当前动作、下一动作、存活单位列表与步骤轨迹
  - `apps/client/src/main.ts`
    - 新增 H5 侧 replay 详情状态
    - 点击战报会请求 `/battle-replays/:replayId` 详情，并在本地用 shared playback helper 执行 `play / pause / step / reset`
    - `render_game_to_text` 现已输出当前 replay 的选中状态与步骤进度，方便自动化回归
  - `apps/client/src/styles.css`
    - 补齐 replay 详情区、控制按钮、步骤列表和单位状态卡的样式
- 新增 / 更新测试：
  - `apps/client/test/account-history-render.test.ts`
    - 覆盖回放条目选中态
    - 覆盖 replay inspector 的控制按钮与步骤文案
- 当前验证结果：
  - `npm run typecheck:client:h5` 通过
  - `node --import tsx --test ./apps/client/test/account-history-render.test.ts ./apps/client/test/player-account-storage.test.ts` 通过（20/20）
  - `npm test` 通过（269/269）
  - 本地 H5 联调已验证：
    - 先用 `develop-web-game` 脚本跑 `tests/automation/keyboard-battle.actions.json` 生成真实 replay
    - 再次用 `develop-web-game` 打开同一房间并点击最近战报，`state-0.json` 已出现：
      - `replayDetail.replayId = replay-detail-20260328:battle-neutral-1:player-1`
      - `currentStepIndex = 0`
      - `totalSteps = 4`
      - `nextAction = battle.skill`
    - 额外用 Playwright 实点 `step -> play -> pause -> reset`，状态流转为：
      - 初始 `0/4`
      - `step` 后 `1/4`
      - `play` 后推进到 `2/4`
      - `pause` 停在 `2/4`
      - `reset` 回到 `0/4`
    - 已实际检查账号卡截图，最近战报详情区和控制按钮在页面中可见
- 当前下一步：
  - 可以继续把当前 H5 回放详情区往“独立回放中心页面”推进
  - 或者把同一套 replay detail / playback 交互补到 Cocos 端入口上。

## H5 battle report center parity - 2026-04-03

- 已把 H5 最近遭遇入口补齐到和 Cocos 一致的战报读模型：
  - `apps/client/src/player-account.ts`
    - 账号资料加载时现在会并行请求 `/battle-reports`
    - H5 资料卡不再只依赖本地从 replay + event log 推导的 fallback，可直接消费服务端战报中心返回的证据状态
  - `apps/client/src/main.ts`
    - 选择最近遭遇时，如果该条目只有战报摘要而没有 replay 详情，H5 会保留选中态并进入“战报详情”视图，而不是退回空白提示
  - `apps/client/src/account-history.ts`
    - 回放详情区新增 report-only 展示：可查看结果、回合/步数、收益证据与“完整回放暂不可用”提示
- 新增 / 更新测试：
  - `apps/client/test/player-account-storage.test.ts`
  - `apps/client/test/account-history-render.test.ts`

## H5 pixel asset bundle - 2026-03-28

- 已切到 `#33 高质量像素美术资源集成` 分支：`codex/issue-33-h5-pixel-assets`
- 本轮先推进一个可交付的小闭环：把 H5 调试壳里最常见的一批占位 SVG 切到像素风 PNG，并补一条可复用的资源同步脚本
  - `scripts/sync-h5-pixel-assets.mjs`
    - 从 `apps/cocos-client/assets/resources/placeholder` 同步地形、资源、建筑、地图标记和战斗头像到 `apps/client/public/assets/pixel`
    - 当前同步 27 个 PNG 资源，作为 H5 端的像素预览包
  - `package.json`
    - 新增 `npm run sync:assets:h5-pixel`
  - `configs/assets.json`
    - H5 世界地图 / 资源 / 建筑 / 标记 / 两个现有战斗单位头像已切到 `/assets/pixel/**.png`
    - `metadata` 已同步更新，仍保持 36 个注册资源且全部通过 schema 校验
  - `apps/client/src/styles.css`
    - 地图格、资源点、标记、建筑角标、战斗头像都补上 `image-rendering: pixelated`
  - `packages/shared/test/shared-core.test.ts`
    - 新增断言，防止 H5 关键资产回退到旧 SVG 路径
- 当前验证结果：
  - `npm run sync:assets:h5-pixel` 通过，生成 27 个 PNG 文件
  - `npm run validate:assets` 通过
  - `npm run typecheck:client:h5` 通过
  - `node --import tsx --test ./packages/shared/test/shared-core.test.ts` 通过（103/103）
  - `npm test` 通过（270/270）
  - 已按 `develop-web-game` 技能实际联调并检查截图：
    - 世界地图截图：`/tmp/project-veil-pixel-world/shot-0.png`
      - 草地 / 土地 / 水面 / 资源点 / 建筑角标 / 英雄标记都已切成像素风 PNG
    - 战斗截图：`/tmp/project-veil-pixel-battle/shot-0.png`
      - 我方与敌方单位头像都已改为新的像素包，战斗卡片仍正常渲染
- 当前结论：
  - `#33` 还没有完成正式高质量美术与 Spine / 音效 / 压缩优化，但 H5 已不再完全依赖旧 SVG 占位图
  - 下一步可以继续把这套像素资源从“调试壳预览包”升级成正式资产流水线，并补到 Cocos 端的更细粒度单位 / 建筑表现上

## Pixel asset pipeline + Cocos consumption - 2026-03-28

- 已继续推进 `#33 高质量像素美术资源集成`，把“只在 H5 预览生效”的像素包，扩成 H5 / Cocos 共用的一条正式资源链路：
  - `scripts/sync-h5-pixel-assets.mjs`
    - 同步范围已从 H5 预览扩展为 H5 + Cocos 双端
    - 现在会把地形 / 资源 / 建筑 / 单位标记同步到 `apps/client/public/assets/pixel` 与 `apps/cocos-client/assets/resources/pixel`
    - 新增生成型像素 UI 资产：`badges/*`、`frames/*`
    - Cocos 侧新生成的 `.png.meta` 默认使用 `nearest` 采样，保证像素资源在 Creator / 运行时不被线性模糊
  - `configs/assets.json`
    - 单位卡框已从旧 `SVG` 切到 `/assets/pixel/frames/*.png`
    - faction / rarity / interaction badges 已从旧 `SVG` 切到 `/assets/pixel/badges/*.png`
    - 资源注册总数仍为 36，schema 与 metadata 覆盖保持通过
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprite-manifest.ts`
    - 新增 Cocos 像素资源清单，把 shared `assets.json` 映射到 Creator `resources` 路径
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprites.ts`
    - 新增 Cocos 像素 sprite loader，替代旧的 `cocos-placeholder-sprites.ts`
  - `apps/cocos-client/assets/scripts/VeilMapBoard.ts`
  - `apps/cocos-client/assets/scripts/VeilBattlePanel.ts`
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
  - `apps/cocos-client/assets/scripts/VeilTimelinePanel.ts`
    - 已全部切到新的像素 loader，不再硬编码读取旧 `placeholder/*` 路径
  - `apps/client/src/styles.css`
    - 对象卡图标与 object badges 也补上 `image-rendering: pixelated`
  - `apps/cocos-client/test/cocos-pixel-sprite-manifest.test.ts`
    - 新增 manifest / resource-path 映射测试
  - `packages/shared/test/shared-core.test.ts`
    - 新增断言，防止 unit frame / badges 回退到旧 SVG 路径
- 当前验证结果：
  - `npm run sync:assets:pixel` 通过
    - 同步 60 个镜像资源，生成 18 个像素 UI 资产
  - `npm run validate:assets` 通过
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - `npm test` 通过（272/272）
  - 已按 `develop-web-game` 技能实际回归：
    - 世界态截图 `output/pixel-world-check/shot-0.png`
      - 已肉眼确认地图地块、资源点、建筑角标、英雄 / 中立标记走新的像素包
    - 战斗态截图 `output/pixel-battle-settled/shot-0.png`
      - 顶部截图停在 battle 页面上半屏，`state-0.json` 已确认 battle 数据和单位状态正常载入，且未生成新的 `errors-0.json`
- 当前结论：
  - `#33` 现在已经不只是“H5 预览换图”，而是有了 shared manifest -> H5 public -> Cocos resources 的共用像素资源流水线
  - 仍未完成的剩余范围主要是：
    - 更高质量的正式美术替换（当前仍是 generated / placeholder stage）
    - Spine 动画接入
    - 音效资源与播放配置
    - Cocos Creator / 真机上的加载时长与压缩验收

## Pixel presentation config + audio scaffolding - 2026-03-28

- 继续推进 `#33 高质量像素美术资源集成`，把“像素资源已接入”往前收成更完整的表现层配置：
  - 新增 `configs/cocos-presentation.json`
    - 收口 `hero_guard_basic / wolf_pack` 的动画 profile
    - 收口 `explore / battle` BGM 与 `attack / skill / hit / level_up` cue 的合成音频参数
    - 补 `targetMs = 1800 / hardLimitMs = 3000` 的像素资源加载预算与 preload group 约定
  - 新增 `apps/cocos-client/assets/scripts/cocos-presentation-config.ts`
    - 负责 JSON 归一化、默认值兜底和按单位模板解析动画 profile
  - 新增 `apps/cocos-client/assets/scripts/cocos-audio-runtime.ts`
    - 先用轻量合成音频把 Cocos 里的 `explore / battle / attack / skill / hit / level_up` 事件接起来
    - 没有 `AudioContext` 时安全回退，只保留状态与测试链路
  - `apps/cocos-client/assets/scripts/VeilUnitAnimator.ts`
  - `apps/cocos-client/assets/scripts/VeilMapBoard.ts`
    - 单位动画已支持按 profile 批量套用命名和回退时序，地图英雄会按模板切对应 profile
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 已把 `attack / skill / hit / level_up` cue 与 `explore / battle` 场景音乐接到运行时
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprites.ts`
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
    - 像素资源 loader 会记录首轮加载耗时，HUD 状态卡会显示预算命中情况与当前音频场景
  - 新增测试：
    - `apps/cocos-client/test/cocos-presentation-config.test.ts`
    - `apps/cocos-client/test/cocos-audio-runtime.test.ts`
- 本轮验证结果：
  - `npm run typecheck:cocos` 通过
  - `node --import tsx --test ./apps/cocos-client/test/cocos-presentation-config.test.ts ./apps/cocos-client/test/cocos-audio-runtime.test.ts` 通过（4/4）
  - `npm run typecheck:client:h5` 通过
  - `npm test` 通过（276/276）
  - 已按 `develop-web-game` 技能补跑轻量 H5 smoke：
    - `state-0.json` 显示仍正常停在 world 模式，`errors-0.json` 未生成
    - 截图确认 H5 调试壳主界面与像素地图表现仍正常

## Pixel preload groups + runtime loading strategy - 2026-03-28

- 继续推进 `#33` 的加载优化部分，不再只停留在 `loadingBudget` 配置：
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprite-manifest.ts`
    - manifest 现已补齐 `units / frames / badges` 路径
    - 新增 `pixelSpriteResourcePaths` 与 `resolvePixelSpritePreloadPaths("boot" | "battle")`
    - 会按 `configs/cocos-presentation.json` 的 wildcard preload group 实际解析出要预载的资源集合
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprites.ts`
    - 从“整包一次性 load”改成按组预载
    - 现在会分别跟踪 `requestedGroups / loadedGroups / pendingGroups`
    - `boot` 负责地图 / HUD / 时间线资源，`battle` 负责单位头像 / 框 / badge / battle icon
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
  - `apps/cocos-client/assets/scripts/VeilMapBoard.ts`
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
  - `apps/cocos-client/assets/scripts/VeilTimelinePanel.ts`
  - `apps/cocos-client/assets/scripts/VeilBattlePanel.ts`
    - 已按面板职责切换到 `boot / battle` 分组预载；战斗发生时也会主动补热 `battle` 组
  - `apps/cocos-client/test/cocos-pixel-sprite-manifest.test.ts`
    - 新增 preload group 解析测试，锁住 `boot` 不带 battle icon、`battle` 覆盖 units / frames / badges
- 本轮验证结果：
  - `npm run typecheck:cocos` 通过
  - `node --import tsx --test ./apps/cocos-client/test/cocos-pixel-sprite-manifest.test.ts ./apps/cocos-client/test/cocos-presentation-config.test.ts ./apps/cocos-client/test/cocos-audio-runtime.test.ts` 通过（7/7）
  - `npm run typecheck:client:h5` 通过
  - `npm test` 通过（277/277）
  - 已按 `develop-web-game` 技能补跑轻量 H5 smoke：
    - `state-0.json` 仍正常停在 world 模式
    - `errors-0.json` 未生成
    - 截图确认 H5 调试壳与像素地图表现没有回归

## Battle panel pixel unit cards - 2026-03-28

- 继续推进 `#33` 的 Cocos 前台承接，把预载进来的 `units / frames / badges` 真正用到战斗面板：
  - 新增 `apps/cocos-client/assets/scripts/cocos-battle-unit-visuals.ts`
    - 负责把 battle unit 的 `templateId / faction / rarity / selected / damaged` 映射成可渲染的像素视觉描述
  - 新增 `apps/cocos-client/test/cocos-battle-unit-visuals.test.ts`
    - 锁住 `hero_guard_basic / wolf_pack / unknown template` 的 portrait / faction / rarity 规则
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprites.ts`
    - 资源快照现在除了 `tiles / icons` 外，也会暴露 `units / badges`
  - `apps/cocos-client/assets/scripts/VeilBattlePanel.ts`
    - 战斗队列、我方单位、敌方目标三种 row 都已补左侧像素单位卡
    - 当前会显示 portrait + frame + faction badge + rarity badge + battle interaction badge
    - portrait 会按选中 / 行动中 / 受伤状态切 `selected / hit / idle`
- 本轮验证结果：
  - `npm run typecheck:cocos` 通过
  - `node --import tsx --test ./apps/cocos-client/test/cocos-battle-unit-visuals.test.ts ./apps/cocos-client/test/cocos-pixel-sprite-manifest.test.ts ./apps/cocos-client/test/cocos-battle-panel-model.test.ts` 通过（10/10）
  - `npm test` 通过（280/280）
  - 已按 `develop-web-game` 技能补跑轻量 H5 smoke：
    - `state-0.json` 正常停在 world 模式
    - `errors-0.json` 未生成
    - H5 截图没有新增回归
- 仍待外部验收：
  - Cocos Creator 预览里肉眼确认 battle row 的头像尺寸、badge 位置和文本挤压是否满意

## Cocos preview validation and runtime node cleanup - 2026-03-28

- 为了让 Creator 预览不再直接吃仓库外的 `packages/shared/src`，补了两层修复：
  - `packages/shared/src/*.ts`
    - shared 内部相对导入统一改成显式 `.ts`
  - `apps/cocos-client/assets/scripts/project-shared/`
    - 新增 Cocos 本地镜像，Creator 预览现在优先引用项目内 shared runtime 副本
  - `tsconfig.base.json`
    - 同步允许 `.ts` 扩展导入，保证 repo 内 typecheck 正常
- 为了收掉 Creator 预览里的 `Can't add renderable component to this node because it already have one.`，把启动路径上高频 UI 节点改成“背景 node + 文本子节点”：
  - `apps/cocos-client/assets/scripts/VeilMapBoard.ts`
    - tile label / object fallback label / feedback label 改到子节点
  - `apps/cocos-client/assets/scripts/VeilFogOverlay.ts`
    - fog overlay label 改到子节点
  - `apps/cocos-client/assets/scripts/VeilLobbyPanel.ts`
    - lobby action button label 改到子节点
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
    - skill / equipment / action button label 改到子节点
- Creator + Chrome 实测结果：
  - 已能从 Creator 成功触发 `项目 -> 运行预览 / 刷新预览`
  - `http://localhost:7456/?roomId=test-room&playerId=player-1` 可稳定进入 world 态
  - map marker / badge 已能在 Cocos 预览里肉眼看到
  - 浏览器控制台不再出现 renderable 冲突告警
  - 当前仍会看到 Chrome 的 `AudioContext was not allowed to start` 提示，属于无首个用户手势时的浏览器自动播放限制，不是 Cocos 渲染错误
- 本轮验证结果：
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - `npm test` 通过（281/281）
  - Playwright + headed Chrome 已实际抓取 Creator preview 截图并复核 world 态像素 marker
- 仍待人工体验验收：
  - 左侧 HUD 当前在 `960x640` 设计分辨率下仍偏拥挤，虽然不再报 renderable 告警，但字号/卡片密度后续还可以继续收口

## Audio unlock gate for Creator preview - 2026-03-28

- 继续推进 `#33` 的音频体验收口，把 WebAudio 改成“首个用户手势后再启音”，避免 Creator/Chrome 预览阶段刷出自动播放告警：
  - `apps/cocos-client/assets/scripts/cocos-audio-runtime.ts`
    - 新增 `unlock()`，支持在首次触摸/点击后再创建并恢复 `AudioContext`
    - `setScene()` 在支持 WebAudio 但尚未解锁时，不再预先挂静音 loop timer
    - 运行时状态新增 `unlocked`
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 全局 `TOUCH_END / MOUSE_UP` 输入现在会先触发音频解锁，再分发 HUD 行为
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
    - HUD 的 presentation 状态文案从“已接音频运行时”细化成“待首次点击启音 / 已解锁音频运行时”
  - `apps/cocos-client/test/cocos-audio-runtime.test.ts`
    - 新增“支持 WebAudio 但必须等待用户手势解锁”的测试
- Creator / Chrome 实测：
  - `http://localhost:7456/?roomId=test-room&playerId=player-1` 点击前 `warning/error = 0`
  - 首次点击进入交互后 `warning/error = 0`
  - 之前那串 `AudioContext was not allowed to start` 已不再出现
- 本轮验证结果：
  - `npm run typecheck:cocos` 通过
  - `node --import tsx --test ./apps/cocos-client/test/cocos-audio-runtime.test.ts` 通过（2/2）
  - `npm run typecheck:client:h5` 通过
  - `npm test` 通过（282/282）

## Asset catalog expansion and lobby art deck - 2026-03-28

- 继续推进 `#33` 的像素资源整合，把“目录里已有资源”推进成“运行时可见的画册入口”：
  - `configs/assets.json`
    - 新增 `heroes / showcaseUnits / showcaseBuildings`
    - 当前登记了 4 张 hero portrait、6 组 showcase unit、1 个 `forge_hall`
  - `packages/shared/src/assets-config.ts`
    - shared 资产 schema 新增上述三个 section
    - `collectAssetPaths()` / 校验逻辑已覆盖新资源组
  - `scripts/sync-h5-pixel-assets.mjs`
    - 新增 hero portraits、showcase units、forge hall 的 PNG 生成与 H5/Cocos 双端同步
  - `scripts/validate-assets.ts`
    - 资产校验新增 issue-33 coverage 规则：
      - 至少 4 张 hero portrait
      - `units + showcaseUnits` 合计至少 8 套 unit sprite
      - `showcaseBuildings.forge_hall` 必须存在
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprite-manifest.ts`
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprites.ts`
    - Cocos manifest / runtime snapshot 现在会暴露 `heroes / showcaseUnits / showcaseBuildings`
  - `configs/cocos-presentation.json`
    - `boot` preload group 追加 `pixel/showcase-units/*`
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
    - HUD hero badge 现在优先走 hero portrait，不再只显示通用 hero marker
  - `apps/cocos-client/assets/scripts/VeilLobbyPanel.ts`
    - Lobby 右侧新增 `像素画册` 卡片
    - 当前固定展示 8 个 tile：
      - 4 位英雄 portrait
      - 3 个 showcase unit
      - 1 个 forge hall building icon
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 改成由 root 统一管理 `boot / battle` 资源组异步加载完成后的重绘，避免 Lobby 首次只显示“加载中”而不刷新
- Creator Preview 实测结果：
  - 先通过 `项目 -> 刷新预览` 强制更新 bundle
  - 再通过 Playwright + 页面内 Cocos scene-tree 探针确认：
    - `ProjectVeilLobbyPanel` 下面已出现 `LobbyShowcase`
    - `LobbyShowcase` 下已生成 `ShowcaseTile-0` 到 `ShowcaseTile-7`
    - 最终文案已切到：
      - `Lobby 已直连 #33 像素资源包，可在进入房间前先看主视觉。`
    - 8 个 tile 的 `Icon.active` 全部为 `true`
- 本轮验证结果：
  - `npm run sync:assets:pixel` 通过
  - `npm run validate:assets` 通过
  - `node --import tsx --test ./apps/cocos-client/test/cocos-pixel-sprite-manifest.test.ts ./packages/shared/test/shared-core.test.ts` 通过（106/106）
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - `npm run typecheck:server` 通过
  - `npm test` 通过（282/282）
- 后续仍可继续补：
  - 把剩余 3 个 showcase unit 也做成可翻页或轮播的 art deck，而不是当前固定 8 格
  - 用正式高质量美术替换 generated placeholder
  - 继续接 Spine / 真正的音频资源 / Creator 真机加载验收

## Issue-33 asset spec uplift - 2026-03-28

- 继续把 `#33` 往原始 issue 的资源规格要求推进，不再只验证“有没有 PNG”，而是开始校验尺寸和双端同步：
  - `scripts/sync-h5-pixel-assets.mjs`
    - `hero_guard_basic / wolf_pack` 的 core unit portrait 不再复用旧 `48x48` placeholder icon，而是改成生成式 `32x32`
    - `recruitment_post / attribute_shrine / resource_mine / forge_hall` 统一改成生成式 `256x256` building icon
    - marker 仍保留独立路径，不再和 core unit portrait 混在同一份旧镜像里
  - `scripts/validate-assets.ts`
    - 新增 issue-33 规格校验：
      - hero portrait 必须为 `16x16`
      - unit / showcase unit portrait 必须为 `32x32`
      - terrain tile 至少 `64x64`
      - building / showcase building icon 至少 `256x256`
    - 现在会同时检查 H5 public 与 Cocos resources 两端文件是否都存在
    - 校验输出新增 `public / cocos` bundle 体积摘要，便于继续做加载优化
- 本轮资源规格结果：
  - `apps/client/public/assets/pixel/units/hero-guard-basic.png` -> `32x32`
  - `apps/client/public/assets/pixel/units/wolf-pack.png` -> `32x32`
  - `apps/client/public/assets/pixel/buildings/resource-mine.png` -> `256x256`
  - `apps/client/public/assets/pixel/buildings/forge-hall.png` -> `256x256`
  - 当前 `validate:assets` 汇总：
    - `public 35 KiB / cocos 35 KiB`
- Creator Preview 回归：
  - 再次执行 `项目 -> 刷新预览`
  - 用 Playwright + Cocos scene-tree 探针复核 `LobbyShowcase`
  - 当前仍能读到：
    - `Lobby 已直连 #33 像素资源包，可在进入房间前先看主视觉。`
    - `ShowcaseTile-0..7` 的 `Icon.active` 全部为 `true`
- 本轮验证结果：
  - `npm run sync:assets:pixel` 通过
  - `npm run validate:assets` 通过
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - `npm run typecheck:server` 通过
  - `npm test` 通过（282/282）

## Issue-33 asset-backed audio bridge - 2026-03-28

- 继续把 `#33` 往“真实内容资产”推进，这一轮先补的是可选资源音频链路，而不是把现有合成音频直接删掉：
  - `configs/cocos-presentation.json`
    - 为 `explore / battle` BGM 和 `attack / skill / hit / level_up` cue 增加 `assetPath / assetVolume`
    - 当前统一指向 `resources/audio/*`，后续换正式资源时只需要改配置和文件，不用重写 runtime
  - `apps/cocos-client/assets/scripts/cocos-audio-runtime.ts`
    - 新增 `assetBridge` 能力，支持：
      - 有资源时优先播 `AudioClip`
      - 资源缺失或加载失败时自动回退到合成音频
      - HUD 状态里额外暴露 `assetBacked / musicMode / cueMode`
  - `apps/cocos-client/assets/scripts/cocos-audio-resources.ts`
    - 新增 Cocos 资源桥接层
    - 会在 root 下维护 `ProjectVeilMusicAudio / ProjectVeilCueAudio` 两个 `AudioSource` 节点
    - 统一通过 `resources.load(AudioClip)` 加载 `audio/*`
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 改成在 `onLoad()` 时用 Cocos 资源桥重新初始化 audio runtime，避免继续只走 WebAudio 合成
  - `scripts/sync-cocos-audio-assets.mjs`
    - 新增占位音频生成脚本
    - 现在会从 `configs/cocos-presentation.json` 读取 6 段 BGM / cue 定义，生成：
      - `explore-loop.wav`
      - `battle-loop.wav`
      - `attack.wav`
      - `skill.wav`
      - `hit.wav`
      - `level-up.wav`
  - `scripts/validate-assets.ts`
    - 现在除了像素资源，也会校验 `configs/cocos-presentation.json` 里声明的 `resources/audio/*.wav`
    - 会检测 WAV 是否存在以及时长是否大于 `120ms`
    - 汇总输出新增 `audio` bundle 体积
- 文档与测试：
  - `apps/cocos-client/README.md`
    - 说明 audio runtime 已优先走 `resources/audio/*`，并保留合成音频回退
    - 补充 `npm run sync:assets:audio`
  - `apps/cocos-client/test/cocos-audio-runtime.test.ts`
    - 新增 asset-backed 播放和失败回退到 synth 的断言
  - `apps/cocos-client/test/cocos-presentation-config.test.ts`
    - 新增 `assetPath / assetVolume` 规范断言
- 本轮验证结果：
  - `npm run sync:assets:audio` 通过
  - `node --import tsx --test ./apps/cocos-client/test/cocos-presentation-config.test.ts ./apps/cocos-client/test/cocos-audio-runtime.test.ts` 通过（7/7）
  - `npm run validate:assets` 通过
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - `npm run typecheck:server` 通过
  - `npm test` 通过（284/284）
- Creator Preview / 有头浏览器探针复核：
  - 通过 `项目 -> 刷新预览` 强制让 Creator 重新导入 `resources/audio/*`
  - 预览页运行后已确认：
    - `ProjectVeilMusicAudio` 存在，`AudioSource.clip.name = explore-loop`
    - `ProjectVeilCueAudio` 存在，处于 one-shot 待命状态
    - `VeilHudPanel.currentState.presentation.audio.musicMode = asset`
    - HUD 状态文案已更新为：
      - `音频 已解锁资源音频 · 场景 探索 · BGM 资源`
  - 页面内 `consoleErrors` 为空，没有新的 Creator 预览告警

## Issue-33 pixel animation fallback polish - 2026-03-28

- 继续把 `#33` 往“即使还没接正式 Spine，也先把视觉表现做得可看”推进：
  - `apps/cocos-client/assets/scripts/cocos-unit-animation-fallback.ts`
    - 新增纯逻辑 helper，把 `idle / move / attack / hit / victory / defeat` 映射到像素 portrait 的 `idle / selected / hit`
    - 回退资源优先级：
      - `units/*`
      - `showcaseUnits/*`
      - `heroes/*`
  - `apps/cocos-client/assets/scripts/VeilUnitAnimator.ts`
    - 不再在缺少 Spine / Timeline 时只显示文字占位
    - 现在会优先把像素 portrait 帧挂到 `HeroIcon` 或节点自身的 `Sprite`
    - `attack / move / victory` 会轻微放大，`hit / defeat` 会缩小并染成受击色
    - 修正了“像素资源晚于模板到位时，animator 不会自动刷新”的问题
  - `apps/cocos-client/assets/scripts/VeilMapBoard.ts`
    - 地图英雄 marker 改成允许 `VeilUnitAnimator` 接管 `HeroIcon`
    - 当像素 portrait 回退可用时，不再强行覆写成通用 hero marker
- 测试与回归：
  - 新增 `apps/cocos-client/test/cocos-unit-animation-fallback.test.ts`
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - `npm run typecheck:server` 通过
  - `npm test` 通过（288/288）
- Creator Preview / 有头浏览器探针复核：
  - `ProjectVeilHero -> HeroIcon.active = true`
  - `VeilUnitAnimator.hasPixelFallback() = true`
  - `HeroIcon` 已持有非空 `spriteFrame`
  - 说明地图英雄 marker 已不再只依赖通用 hero marker 图标，而是进入像素帧回退链路

## Issue-33 presentation readiness surfacing - 2026-03-28

- 把 #33 当前的“资源交付真实状态”显式编码到了配置与 UI：
  - `configs/cocos-presentation.json`
    - 动画 profile 新增 `deliveryMode / assetStage`
    - 探索/战斗 BGM 与 4 组 cue 也新增 `assetStage`
  - `apps/cocos-client/assets/scripts/cocos-presentation-config.ts`
    - 新增 `CocosPresentationAssetStage / CocosAnimationDeliveryMode`
    - 会把 `placeholder / production` 与 `fallback / clip / spine` 规范化到运行时配置
  - `apps/cocos-client/assets/scripts/cocos-presentation-readiness.ts`
    - 新增纯逻辑 helper，汇总像素图、音频、动画三块的 readiness
    - 当前会输出：
      - `像素 占位 0/59`
      - `音频 占位 0/6`
      - `动画 回退 2/2`
    - 同时会给出下一步提示：
      - `待替换 正式像素美术 / 真实 BGM/SFX / Spine Skeleton`
- Cocos 前台接线：
  - `apps/cocos-client/assets/scripts/VeilLobbyPanel.ts`
    - `LobbyShowcase` 现在会显示 readiness 摘要和下一步收口提示，不再只是像素画册说明文案
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
    - 状态卡新增一行 `表现 ...` 摘要，直接反映当前 #33 的资产阶段
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - Lobby 和 HUD 都改由根节点统一下发 readiness 状态
- 校验与测试：
  - `scripts/validate-assets.ts`
    - 现在会校验 `configs/cocos-presentation.json` 里的 `assetStage / deliveryMode`
    - 成功输出里会附带 readiness 摘要，避免只看到体积和数量
  - 新增 `apps/cocos-client/test/cocos-presentation-readiness.test.ts`
  - 更新 `apps/cocos-client/test/cocos-presentation-config.test.ts`
- 本轮验证结果：
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - `node --import tsx --test ./apps/cocos-client/test/cocos-presentation-config.test.ts ./apps/cocos-client/test/cocos-presentation-readiness.test.ts` 通过（5/5）
  - `npm run validate:assets` 通过
- Creator Preview / 有头浏览器探针复核：
  - Lobby 空态已读到：
    - `表现 像素 占位 0/59 · 音频 占位 0/6 · 动画 回退 2/2`
    - `待替换 正式像素美术 / 真实 BGM/SFX / Spine Skeleton`
  - 游戏态 HUD 已读到：
    - `表现 像素 占位 0/59 · 音频 占位 0/6 · 动画 回退 2/2`

## Issue-33 terrain showcase coverage - 2026-03-28

- 把 issue #33 里点名但工程里还没成体系的地形主题补进了像素资源清单：
  - `packages/shared/src/assets-config.ts`
  - `apps/cocos-client/assets/scripts/project-shared/assets-config.ts`
    - 新增 `showcaseTerrain`
    - 现在共享资产配置可以正式声明独立于世界地形类型之外的展示地形主题
  - `configs/assets.json`
    - 新增 `showcaseTerrain.grassland / mountain / water / desert / snow`
    - metadata 同步补齐 `5` 条 `showcase_terrain.*`
  - `scripts/sync-h5-pixel-assets.mjs`
    - 新增 `64x64` 地形展示图生成：
      - `grassland-tile`
      - `mountain-tile`
      - `water-tile`
      - `desert-tile`
      - `snow-tile`
    - 同步到：
      - `apps/client/public/assets/pixel/showcase-terrain`
      - `apps/cocos-client/assets/resources/pixel/showcase-terrain`
- Cocos 前台接线：
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprite-manifest.ts`
  - `apps/cocos-client/assets/scripts/cocos-pixel-sprites.ts`
    - 现在会把 `showcaseTerrain` 纳入 manifest、预载和运行时快照
  - `configs/cocos-presentation.json`
    - `boot` 预载组新增 `pixel/showcase-terrain/*`
  - `apps/cocos-client/assets/scripts/cocos-showcase-gallery.ts`
    - 新增 `lobbyTerrainShowcaseEntries`
    - 支持解析 `草原 / 山脉 / 水域 / 沙漠 / 雪原` 的 terrain frame
  - `apps/cocos-client/assets/scripts/VeilLobbyPanel.ts`
    - `LobbyShowcase` 卡片现在增加 `5` 格 terrain strip
    - 标题文案改为：
      - `4 英雄 / 6 展示兵种 / 5 地形 / Forge Hall`
- 校验与测试：
  - `scripts/validate-assets.ts`
    - 新增 `showcaseTerrain >= 5` 覆盖校验
    - 新增 `showcaseTerrain.*` 必须为 `64x64` 的尺寸校验
  - 更新测试：
    - `packages/shared/test/shared-core.test.ts`
    - `apps/cocos-client/test/cocos-pixel-sprite-manifest.test.ts`
    - `apps/cocos-client/test/cocos-showcase-gallery.test.ts`
    - `apps/cocos-client/test/cocos-presentation-readiness.test.ts`
- 本轮验证结果：
  - `npm run sync:assets:pixel` 通过
  - 定向测试通过（112/112）
  - `npm run validate:assets` 通过
    - 摘要更新为：
      - `64 registered files`
      - `readiness 像素 占位 0/64 · 音频 占位 0/6 · 动画 回退 2/2`
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:client:h5` 通过
  - `npm run typecheck:server` 通过
- Creator Preview / 自动化探针复核：
  - `ShowcaseTerrain-0` 到 `ShowcaseTerrain-4` 全部存在
  - `草原 / 山脉 / 水域 / 沙漠 / 雪原` 五个 tile 的 `Icon.active = true`
  - 五个 terrain tile 都已持有非空 `spriteFrame`

## Issue-33 lobby building strip + unit carousel - 2026-03-28

- 把 Lobby 画册从“地形补齐但建筑仍是单点展示”推进成了完整的 `4 建筑` strip：
  - `apps/cocos-client/assets/scripts/cocos-showcase-gallery.ts`
    - 新增 `lobbyBuildingShowcaseEntries`
    - `resolveLobbyBuildingFrame()` 现在优先读 `showcaseBuildings.*`，缺失时回退到通用 `icons`
  - `apps/cocos-client/assets/scripts/VeilLobbyPanel.ts`
    - `LobbyShowcase` 卡片高度从 `178` 提到 `220`
    - 补上 `ShowcaseBuilding-0..3`：
      - `招募 / 神社 / 矿场 / 锻炉`
    - terrain row / building row 的 Y 轴重新排布，避免第四排贴底裁切
- 继续把标题里写明的 `6 展示兵种` 做成真正可见的轮播：
  - `apps/cocos-client/assets/scripts/cocos-showcase-gallery.ts`
    - 新增 `lobbyHeroShowcaseEntries`
    - 新增 `lobbyShowcaseUnitEntries`
    - 新增 `getLobbyShowcaseUnitPageCount() / nextLobbyShowcaseUnitPage() / resolveLobbyShowcaseEntries()`
    - 第二排单位改为 `4` 格滑窗：
      - 第 1 页：`晨枪 / 苔影 / 余烬 / 铁卫`
      - 第 2 页：`余烬 / 铁卫 / 沙袭 / 霜卫`
  - `apps/cocos-client/assets/scripts/VeilLobbyPanel.ts`
    - `showcaseUnitPage` 会在 `idle -> selected -> hit -> idle` 完整一轮后切页
    - 标题文案改为：
      - `4 英雄 / 6 展示兵种轮播 / 5 地形 / 4 建筑`
- 服务端顺手补掉了 Creator 预览里的游客空档案 404 噪声：
  - `apps/server/src/player-accounts.ts`
    - 当公共 `:playerId` 路由命中 `guest-*` 且档案不存在时，不再返回 `404`
    - 现在会为游客 ID 返回：
      - 空 account
      - 空 replay list
      - 空 event log
      - 默认 achievement/progression 快照
  - `apps/server/test/player-account-routes.test.ts`
    - 新增游客公共路由 fallback 覆盖
- 测试与验证：
  - 更新 `apps/cocos-client/test/cocos-showcase-gallery.test.ts`
    - 新增 building frame fallback 覆盖
    - 新增 unit carousel page/window 覆盖
  - 定向测试通过：
    - `node --import tsx --test ./apps/server/test/player-account-routes.test.ts ./apps/cocos-client/test/cocos-lobby.test.ts`（32/32）
  - 全量验证通过：
    - `npm run validate:assets`
    - `npm run typecheck:cocos`
    - `npm run typecheck:server`
    - `npm run typecheck:client:h5`
    - `npm test`（297/297）
- Creator Preview / 浏览器探针复核：
  - `LobbyShowcase` 已读到新标题：
    - `4 英雄 / 6 展示兵种轮播 / 5 地形 / 4 建筑`
  - `ShowcaseBuilding-0..3` 全部存在，`Icon.active = true`，且都持有非空 `spriteFrame`
  - 第二排单位会从：
    - `晨枪 / 苔影 / 余烬 / 铁卫`
    - 轮播到 `余烬 / 铁卫 / 沙袭 / 霜卫`
  - 刷新后的 Creator Preview 在 `http://localhost:7456` 下实测 `console warning/error = 0`
  - `develop-web-game` 脚本本轮仍会生成黑屏截图：
    - `output/web-game/shot-0.png`
    - 原因仍是 headless WebGL 抓屏限制，实际可见验证已改用有头探针

## Issue-33 battle stage banner - 2026-03-28

- 把战斗面板从纯文本摘要推进成了带像素地形条幅的战场入口信息：
  - `apps/cocos-client/assets/scripts/cocos-battle-panel-model.ts`
    - 新增 `BattlePanelStageView`
    - 战斗态现在会从 `battle.encounterPosition` 或英雄当前位置推导：
      - 地形 `terrain`
      - 标题 `草野/荒地/沙原/水域战场`
      - 副标题 `坐标 + 阻挡/陷阱摘要`
      - `PVE / PVP / BATTLE` badge
    - 只统计 `blocker` 和已揭示陷阱，不把未揭示陷阱提前暴露到 UI
  - `apps/cocos-client/assets/scripts/VeilBattlePanel.ts`
    - 新增 `BattleStageBanner`
    - 条幅会在标题下方渲染像素地形缩略图、战场标题、副标题和阵营 badge
    - 地形图走 `getPixelSpriteAssets().tiles.*`
    - 缺资源时会补请求 `loadPixelSpriteAssets("boot")`
- 模型测试补齐：
  - `apps/cocos-client/test/cocos-battle-panel-model.test.ts`
    - idle 态断言 `stage = null`
    - PVE / PVP 地形标题断言
    - `encounterPosition` 优先级断言
    - `1 阻挡 / 1 陷阱` 可见 hazard 摘要断言
- 验证：
  - `node --import tsx --test ./apps/cocos-client/test/cocos-battle-panel-model.test.ts`（5/5）
  - `npm run typecheck:cocos`
  - `npm run typecheck:client:h5`
  - `npm run typecheck:server`
  - `npm test`（298/298）
- Creator Preview / 浏览器探针复核：
  - 需要对 `CocosCreator` 执行一次 `Cmd+R` 才会让预览吃到新的 battle panel bundle
  - 新房间 `issue-33-banner-refresh-check` 实测进入 `battle-neutral-1` 后：
    - `BattleStageBanner` 节点已创建并激活
    - 标题为 `荒地战场 · 中立遭遇`
    - 副标题为 `坐标 (5,4) · 无额外障碍`
    - badge 为 `PVE`
    - 地形 sprite 已持有非空 `spriteFrame`
  - 可视化截图已保存：
    - `output/battle-stage-banner-preview.png`
- `develop-web-game` 脚本本轮也跑过一次：
  - `output/web-game/shot-0.png`
  - 结果仍是 headless WebGL 黑屏，结论和之前一致，实际画面以有头探针与 Creator Preview 为准

## Issue-33 terrain-aware battle transition - 2026-03-28

- 把战斗转场从“统一文案卡片”推进成了带地形语义的像素遭遇卡：
  - `apps/cocos-client/assets/scripts/cocos-battle-transition-copy.ts`
    - `buildBattleEnterCopy()` 现在直接吃 `SessionUpdate`
    - 会从 `battle.encounterPosition` 和世界地图 tile 推导地形
    - PVE / PVP 进入文案会带上 `草野/荒地/沙原/水域战场` 与坐标
    - `BattleTransitionCopy` 新增 `terrain`
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 战斗进入改为 `buildBattleEnterCopy(update)`，让转场能读到 battle/world 联合上下文
  - `apps/cocos-client/assets/scripts/VeilBattleTransition.ts`
    - 新增 `ProjectVeilBattleOverlayTerrain`
    - 进入转场会在卡片左侧显示像素地形预览
    - 标题/副标题在有 terrain art 时会自动右移收口
    - enter tone 的描边/高光会按 terrain 切换色相
- 测试与验证：
  - 更新 `apps/cocos-client/test/cocos-battle-transition-copy.test.ts`
    - 断言 PVE / PVP 进入文案附带 terrain 与坐标
    - 断言 exit copy 显式保持 `terrain: null`
  - 通过：
    - `node --import tsx --test ./apps/cocos-client/test/cocos-battle-transition-copy.test.ts`
    - `npm run typecheck:cocos`
    - `npm run typecheck:client:h5`
    - `npm run typecheck:server`
    - `npm test`（298/298）
- Creator Preview / 有头探针复核：
  - 需要先对 `CocosCreator` 执行一次 `Cmd+R`
  - 新房间 `issue-33-transition-verify` 实测进入遭遇时，转场 overlay 在动画过程中可读到：
    - `title = 遭遇中立守军`
    - `subtitle = 荒地战场 · 目标 neutral-1 · 坐标 (5,4)`
    - `badge = PVE`
    - `terrainActive = true`
    - `terrainHasFrame = true`
  - 截图已保存：
    - `output/battle-transition-terrain-preview.png`
- `develop-web-game` 脚本本轮仍然只产出黑屏：
  - `output/web-game/shot-0.png`
  - 继续判定为 headless WebGL 抓屏限制，实际验收以 Creator Preview 和有头浏览器为准

## Issue-33 battle reward transition chips - 2026-03-28

- 继续收口战斗退出转场的奖励摘要：
  - `apps/cocos-client/assets/scripts/cocos-battle-transition-copy.ts`
    - `buildBattleExitCopy()` 不再逐事件直接截取前 3 条 chips
    - 同类 `hero.collected` 资源现在会先聚合，再生成 `金币/木材/矿石 +N`
    - 当奖励项超过 3 个时，会优先保留：
      - `装备掉落`
      - `等级提升 / 经验`
      - 然后再补最关键的资源收益
    - 装备 chip 现在带 `普通 / 稀有 / 史诗` 稀有度前缀，并对过长装备名做截断，降低底部横向挤压风险
- 测试补齐：
  - `apps/cocos-client/test/cocos-battle-transition-copy.test.ts`
    - 新增 overflow case
    - 验证 `gold + wood + ore + equipment + levelup` 时，最终会稳定保留：
      - `史诗 余烬王冠`
      - `Lv 2`
      - `金币 +250`
- 本轮验证：
  - `node --import tsx --test ./apps/cocos-client/test/cocos-battle-transition-copy.test.ts`（3/3）
  - `npm run typecheck:cocos`
  - `npm run typecheck:client:h5`
  - `npm run typecheck:server`
  - `npm test`（299/299）
  - `develop-web-game` 技能脚本：
    - `output/issue-33-transition-h5-check-2/shot-0.png`
    - `output/issue-33-transition-h5-check-2/state-0.json`
    - 本轮无 `errors-0.json`
- 备注：
  - 当前本机 `Cocos Creator` 进程仍在，但浏览器 Preview 端口 `7456` 这一轮没有自动拉起；因此这次主要先用单测、类型检查和 H5 自动化确认 shared/server/H5 基线未被 battle reward 摘要逻辑带坏。

## Issue #30 - WeChat share + domain readiness - 2026-03-28

- 当前分支仍是 `codex/issue-30-wechat-code2session`
- 本轮继续推进 `#30 微信小游戏适配与发布` 的“分享与转发功能 / 安全域名配置”两段基础设施：
  - `apps/cocos-client/assets/scripts/cocos-wechat-share.ts`
    - 新增小游戏分享桥接工具
    - 会按当前 `roomId / inviterId / scene / day` 生成稳定分享 payload
    - 自动挂接 `showShareMenu / onShareAppMessage / shareAppMessage`
    - 分享 query 只带 `roomId + inviterId`，不复用分享发起人的 `playerId`，避免好友从分享入口进房时错误继承身份
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 在启动、登录、进入房间、返回大厅、切换草稿身份和收到新快照后，都会重新同步小游戏分享卡片
    - Lobby 面板会显示当前分享状态提示，但本轮刻意没有新增单独的“分享”按钮
    - 当前选择是优先复用微信小游戏右上角菜单，避免 Cocos Lobby 左侧按钮区继续膨胀并压缩核心登录入口
  - `apps/cocos-client/assets/scripts/VeilLobbyPanel.ts`
    - 当前状态卡新增 `shareHint`
    - 可直接提示“分享仅小游戏可用 / 已同步转发卡片 / 请使用右上角菜单分享”等状态
  - `apps/cocos-client/assets/scripts/cocos-wechat-build.ts`
    - 小游戏构建配置新增 `runtimeRemoteUrl`
    - `domains.request / socket / uploadFile / downloadFile` 现统一按 origin 归一化，而不是保留路径
    - 构建模板会自动推导运行时真正需要的 `request / socket / downloadFile` 域名
    - `README.codex.md` 与 `codex.wechat.build.json` 现会明确列出“已配置域名 / 必需域名 / 缺口域名”
    - `validate:wechat-build` 现在会对白名单缺口给出显式告警，不再只检查远程资源 CDN
  - `apps/cocos-client/wechat-minigame.build.json`
    - 先补上本地调试默认值：`runtimeRemoteUrl = http://127.0.0.1:2567`
    - 同步记录本地 request/socket 域名，后续切正式环境时再替换成 HTTPS/WSS 域名
- 本轮新增 / 更新测试：
  - `apps/cocos-client/test/cocos-wechat-share.test.ts`
    - 覆盖分享 payload 文案、launch query、菜单挂接和直接转发回执
  - `apps/cocos-client/test/cocos-wechat-build.test.ts`
    - 覆盖 origin 归一化
    - 覆盖 `runtimeRemoteUrl -> request/socket` 推导
    - 覆盖缺口域名告警
- 本轮验证结果：
  - `npm run prepare:wechat-build` 通过
  - `npm run typecheck:cocos` 通过
  - 定向测试通过：
    - `node --import tsx --test ./apps/cocos-client/test/cocos-wechat-share.test.ts ./apps/cocos-client/test/cocos-wechat-build.test.ts ./apps/cocos-client/test/cocos-lobby.test.ts ./apps/cocos-client/test/cocos-login-provider.test.ts`
    - 结果 `26/26`
  - `npm run validate:wechat-build -- --output-dir apps/cocos-client/build-templates/wechatgame` 通过
    - 当前唯一保留告警：`No subpackages were detected or configured for this build`
    - 这和 Creator 里还没正式配置 `Mini Game Subpackage` 一致，属于预期状态
  - `npm test` 通过（`282/282`）
  - 已按 `develop-web-game` 技能再跑一轮 H5 烟测：
    - URL: `http://127.0.0.1:4173/?roomId=wechat-domain-smoke&playerId=player-1`
    - 动作文件：`tests/automation/keyboard-battle.actions.json`
    - `state-0.json` 结果：
      - 最终回到 `world`
      - `gold = 300`
      - 英雄停在 `(5,4)`
      - `timelineTail` 仍包含战斗胜利和奖励日志
    - 未生成 `errors-0.json`
    - 已人工检查截图：地图和右侧战斗面板都回到了空闲态，没有残留战斗 UI
- 当前对 `#30` 的结论：
  - 已完成：
    - 微信小游戏登录链路基础打通
    - 微信小游戏构建模板与预算校验脚手架
    - 分享卡片自动挂桥
    - 基于 `runtimeRemoteUrl` 的域名白名单显式校验
  - 仍未完成：
    - Cocos Creator 内真实 Asset Bundle / Mini Game Subpackage 配置
    - 正式导出 `wechatgame` 构建目录并在微信开发者工具运行
    - 远程资源 CDN 真部署与正式域名白名单
    - 纹理压缩、按需加载、内存剖析、真机 FPS / 内存验收

## Issue #30 - Runtime memory readiness - 2026-03-28

- 本轮继续补 `#30` 的“内存优化 / 运行时收口”部分，重点不是虚报 `< 256MB` 已验收，而是先把仓库内能完成的内存管理边界做实。
- 占位图资源管理已从“首次渲染时全量常驻缓存”改成“按 UI scope retain/release”：
  - 新增 `apps/cocos-client/assets/scripts/cocos-placeholder-sprite-plan.ts`
    - 显式定义 `map / hud / battle / timeline` 四类占位图 scope 以及它们各自需要的贴图路径
  - 重构 `apps/cocos-client/assets/scripts/cocos-placeholder-sprites.ts`
    - 支持 `load / retain / release`
    - 支持统计当前 retained scope、已加载路径和引用计数
    - Map/HUD/Battle/Timeline 组件销毁时会释放不再需要的占位图资源
  - 已接线文件：
    - `apps/cocos-client/assets/scripts/VeilMapBoard.ts`
    - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
    - `apps/cocos-client/assets/scripts/VeilBattlePanel.ts`
    - `apps/cocos-client/assets/scripts/VeilTimelinePanel.ts`
  - 后续又继续收紧了一层：
    - `VeilMapBoard` 在没有世界态（例如大厅 / 等待房间）时会释放 `map` scope
    - `VeilBattlePanel` 在空闲态会释放 `battle` scope
    - `VeilTimelinePanel` 在没有事件条目时会释放 `timeline` scope
- 运行时内存监控已补一层小游戏适配：
  - 新增 `apps/cocos-client/assets/scripts/cocos-runtime-memory.ts`
    - 优先读取小游戏 performance memory，其次回退浏览器 `performance.memory`
    - 若小游戏运行时暴露 `onMemoryWarning` / `triggerGC`，则允许注册内存告警并手动请求 GC
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 启动时绑定内存告警监听
    - 收到告警时会写日志并尝试请求一次 GC
    - HUD 状态卡现会显示“当前内存 / 资源 scope / 是否支持 GC”的摘要
  - `apps/cocos-client/assets/scripts/VeilHudPanel.ts`
    - 状态区现多展示一行 `runtimeHealth`
- 本轮新增 / 更新测试：
  - `apps/cocos-client/test/cocos-placeholder-sprites.test.ts`
    - 锁住占位图 scope 规划与去重规则
  - `apps/cocos-client/test/cocos-runtime-memory.test.ts`
    - 锁住小游戏 / 浏览器内存快照优先级、状态文案和 warning/GC 挂接
- 本轮验证结果：
  - `npm run typecheck:cocos` 通过
  - 定向测试通过：
    - `node --import tsx --test ./apps/cocos-client/test/cocos-runtime-memory.test.ts ./apps/cocos-client/test/cocos-placeholder-sprites.test.ts ./apps/cocos-client/test/cocos-wechat-build.test.ts ./apps/cocos-client/test/cocos-wechat-share.test.ts ./apps/cocos-client/test/cocos-lobby.test.ts ./apps/cocos-client/test/cocos-login-provider.test.ts`
    - 结果 `33/33`
  - `npm test` 通过（`289/289`）
  - 已按 `develop-web-game` 补跑一轮 H5 烟测：
    - URL: `http://127.0.0.1:4173/?roomId=wechat-issue-30-final&playerId=player-1`
    - 动作文件：`tests/automation/keyboard-battle.actions.json`
    - `state-0.json` 结果：
      - 最终回到 `world`
      - `gold = 300`
      - 英雄停在 `(5,4)`
      - 未生成 `errors-0.json`
    - 截图已人工检查，地图和右侧战斗面板都正常回到空闲态
- 到当前为止，`#30` 在仓库内能落地的部分基本都已经收口：
  - 登录、分享、域名配置、按需加载/释放、运行时内存告警挂桥都已完成
  - 剩余真正未完成的都是外部环境依赖项：
    - 在 Cocos Creator 里把真实 Asset Bundle 标成 `Mini Game Subpackage`
    - 导出 `wechatgame` 构建目录
    - 在微信开发者工具里验证域名、分包、FPS 与内存
    - iOS / Android 真机验收

## Issue #199 - Test coverage audit - 2026-03-29

- 已新增审计文档：
  - `docs/test-coverage-audit-issue-199.md`
- 本轮结论：
  - 服务端当前最需要补的是 `dev-server`、`schema-migrations`、`colyseus-room` 与 replay 编排相关覆盖。
  - H5 侧当前最大空白是 `apps/client/src/main.ts`、`local-session.ts` 与 `config-center.ts`。
  - Cocos 侧 helper 覆盖面已经较广，但 `VeilRoot`、`VeilCocosSession` 和各个 `Veil*Panel / VeilMapBoard / VeilTilemapRenderer / VeilUnitAnimator` 这类真正的运行时入口仍缺直接测试。
- 已顺手修复测试基线偏差：
  - 根 `npm test` 脚本此前只执行 `57/62` 个已存在的 Node 测试文件。
  - 本轮已把遗漏的 `account-token-delivery`、battle replay routes、`cocos-battle-replay-timeline`、`cocos-hero-progression` 补回默认测试入口。

## Bugfix branch - Cocos preview runtime - 2026-03-29

- 当前工作分支：
  - `codex/bugfix-cocos-preview-runtime`
- 这轮已直接修掉两个阻断 Cocos Preview 主链路的 bug：
  - 微信小游戏构建工具原先放在 `apps/cocos-client/assets/scripts/cocos-wechat-build.ts`，会被 Preview 运行时打包并在浏览器里尝试加载 `node:fs` / `node:path`，导致 Preview 黑屏。
    - 现已迁到 `apps/cocos-client/tooling/cocos-wechat-build.ts`
    - 对应脚本和测试 import 已全部改到 `tooling/`
  - guest / formal account 以非模板 `playerId` 首次进入新房间时，会因为默认世界只给 `player-1` / `player-2` 分配英雄而落成“旁观者视角”，`ownHeroes = []`、迷雾全黑。
    - `apps/server/src/colyseus-room.ts` 现在会在 connect 时认领一个可用默认槽位，把英雄、房间资源和可见性键位从 `player-*` 重绑到真实账号 `playerId`
    - 同时补了一个回归修复：认领默认槽位时不会再把现有账号的 `globalResources` 误覆盖成新房间的 `0/0/0`
- 这轮补的服务端兼容 / 测试调整：
  - `apps/server/src/persistence.ts`
  - `apps/server/src/memory-room-snapshot-store.ts`
  - `apps/server/test/auth-guest-login.test.ts`
  - `apps/server/test/colyseus-persistence-recovery.test.ts`
  - `apps/server/test/player-account-routes.test.ts`
  - `apps/server/test/player-account-battle-replay-detail-routes.test.ts`
  - `apps/server/test/player-account-battle-replay-playback-routes.test.ts`
  - `savePlayerAccountProgress()` 现在支持可选 `globalResources` patch，方便在“房间快照保存”和“账号全局资源”语义需要拆开的场景里做最小修复
- 已重新按最新代码重启本地 dev server，并实际在 Cocos Preview 跑通完整链路：
  - `Lobby -> New Run -> 移动开图 -> 遭遇 neutral-1 -> 两次攻击结算战斗 -> 次日回前线招募所补兵`
  - 最终 smoke 结果：
    - `gold = 60`
    - `armyCount = 16`
    - 英雄停在 `(1,3)`
    - 无新的浏览器 console error
  - 运行态截图：
    - `output/cocos-preview-final-smoke.png`
- 本轮验证结果：
  - `npm run typecheck:cocos` 通过
  - `npm run typecheck:server` 通过
  - `npm test` 通过（`421/421`）
- 仍值得继续扫的 Cocos 运行态边角：
  - 战后立即学习技能 / 打开技能面板的完整 UI 路径
  - 神殿访问后的前端表现和 toast / 时间线一致性
  - 矿场次日产出在 Cocos HUD / 时间线中的持续反馈
  - 账号面板 / 战报面板在 Preview 内的连续切换与刷新稳定性

## Bugfix branch - Cocos preview runtime follow-up - 2026-03-29

- 本轮继续针对 Cocos Preview 跑运行态回归，并实际修掉了两个前端 bug：
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 之前 `learnSkill / equip / unequip / recruit / visit / claimMine / collect / move` 这些入口只要拿到 `SessionUpdate` 就会无条件写“已结算”成功日志，即使服务端返回了 `update.reason`
    - 现在统一走 `pushSessionActionOutcome()`，会把 `reason` 翻译成玩家可读文案，并在拒绝时播放 `hit` 动画，不再误报成功
    - `describeSessionError()` 也补上了共享 reason 到中文文案的映射，避免直接把内部 reason code 暴露给前端日志
  - `apps/cocos-client/assets/scripts/VeilBattlePanel.ts`
    - battle 面板里的 `IdleBadge / StageBanner badge / roster badge` 之前直接在 `Label` 节点上追加 `Graphics`
    - Creator Preview 会反复报 `Can't add renderable component to this node because it already have one.`
    - 现在 badge 背景改挂到专门的子节点 `${badgeNodeName}-Background`，并在运行时清掉遗留在 `Label` 节点上的旧 `Graphics`
- 本轮新增纯逻辑覆盖：
  - `apps/cocos-client/assets/scripts/cocos-ui-formatters.ts`
    - 新增 `formatSessionActionReason()` 与 `describeSessionActionOutcome()`
  - `apps/cocos-client/test/cocos-ui-formatters.test.ts`
    - 锁住 `building_on_cooldown / not_enough_skill_points / equipment_not_in_inventory` 的用户向文案
    - 锁住“成功 / 拒绝”两类 `SessionUpdate.reason` 分支的结果
- 本轮 Creator / Playwright 运行态实测：
  - 已用 Creator Preview + 有头 Playwright 直接调用运行时组件验证：
    - `New Run -> neutral-1 战斗 -> 战斗结算`
      - `battleSteps = 2`
      - 战后 `gold = 300`
      - 英雄到 `Lv 2`
      - `skillPoints = 1`
      - 浏览器 `warning/error = 0`
    - `次日回前线招募所 -> 第一次招募成功 -> 第二次同日重复招募`
      - 第一次后 `armyCount = 16`
      - `gold = 60`
      - `availableCount = 0`
      - 第二次时间线正确出现 `系统：操作被拒绝，原因是 building_depleted`
      - 前端日志正确出现 `招募被拒绝：这个建筑今天已经没有可领取内容了`
      - 不再出现误导性的第二条 `招募已结算。`
    - `战后学习 war_banner -> 再次学习`
      - 时间线正确出现 `not_enough_skill_points`
      - 说明技能学习这条也吃到了统一拒绝态后置处理
  - 已通过运行时钩子确认 battle 面板不再向已有 `Label` 节点追加 `Graphics`
    - 重新 `项目 -> 刷新预览` 后，battle enter 阶段的重复 renderable warning 已清零
- 本轮验证结果：
  - `node --import tsx --test ./apps/cocos-client/test/cocos-ui-formatters.test.ts` 通过
  - `npm run typecheck:cocos` 通过
  - `npm test` 通过（`423/423`）
- 当前剩余值得继续扫的运行态边角：
  - 如果后续还要继续测“神殿冷却”这条，需要先找到带 `attribute_shrine` 的种子或房间布局；当前这轮自动 smoke 的地图里只有 `recruit-post-1` 与 `mine-wood-1`
  - `npm test` 里仍会出现已有的 `MaxListenersExceededWarning` / `--localstorage-file` warning，它们不是这轮新引入的

## Bugfix branch - Cocos move feedback polish - 2026-03-29

- 本轮继续针对 Cocos Preview 做交互拒绝态回归，并修掉了“移动力不足被误报成不可达”的前端提示问题：
  - `apps/cocos-client/assets/scripts/VeilRoot.ts`
    - 当英雄点击的目标格不在当前 `reachableTiles` 里时，不再一律写 `地块 (x, y) 当前不可达`
    - 现在会额外用 shared `predictPlayerWorldAction()` 复核一次目标，如果是 `not_enough_move_points`，前端会明确提示 `移动被拒绝：移动力不足`
    - 对应 tile feedback 也从统一的 `不可达` 区分成了 `不足 / 占用 / 不可达`
  - `apps/cocos-client/assets/scripts/cocos-ui-formatters.ts`
    - 新增 `describeMoveAttemptFeedback()`，把移动失败的玩家文案和格子反馈 chip 抽成纯函数
  - `apps/cocos-client/test/cocos-ui-formatters.test.ts`
    - 新增对 `not_enough_move_points / destination_occupied / path_not_found` 三类移动反馈文案的覆盖
- 本轮 Creator / Playwright 运行态实测：
  - 先通过运行时探针确认 `(6,1)` 附近存在一批“可见可走但本回合走不完”的格子：
    - `(5,2) / (4,1) / (6,3) / (7,2)`
  - Creator `项目 -> 刷新预览` 后，实际复跑：
    - `New Run -> 移动到 (6,1) -> 剩余移动力 1 -> 点击 (5,2)`
    - 现在前端日志首条正确变成 `移动被拒绝：移动力不足`
    - `predictionStatus` 同步为 `移动被拒绝：移动力不足`
    - 英雄位置保持在 `(6,1)`，移动力仍为 `1`
    - 浏览器 `warning/error = 0`
  - 额外确认：
    - 同一目标 `(5,2)` 在 `advanceDay()` 之后可以正常移动成功，说明这条修复针对的确实是“移动力不足”，不是路径本身不可达
- 本轮验证结果：
  - `node --import tsx --test ./apps/cocos-client/test/cocos-ui-formatters.test.ts` 通过
  - `npm run typecheck:cocos` 通过
  - `npm test` 通过（`424/424`）

## Issue #1173 - WeChat release gate evidence chain - 2026-04-10

- 本轮补齐了同一候选 revision 的 WeChat release gate 证据链，并收掉了两个真实阻塞点：
  - `apps/server/src/auth.ts`
    - 修复 guest 会话在 `/api/auth/session` 刷新后没有重新注册到 `guestSessionsById` 的问题
    - 之前 H5 packaged RC smoke 会在“恢复缓存会话 -> 重新进房”时拿着新 token 被服务端判成 `unauthorized`
    - 现在 refresh token 后会同步注册新的 guest session，房间连接可继续复用刷新后的 bearer token
  - `scripts/release-gate-summary.ts`
    - release gate 汇总现在支持递归发现 `artifacts/release-readiness/**` 下的 rehearsal 证据目录
    - 修掉了顶层汇总把 `release-readiness-dashboard-*.json` 误当成正式 snapshot 的问题，避免明明候选包已通过却仍被总门禁判成 failed
  - `scripts/validate-wechat-release-candidate.ts`
    - WeChat RC 校验现在会自动识别候选包目录中的 `codex.wechat.manual-review.json / wechat-manual-review.json / wechat-manual-checks.json`
    - 这样 `release:phase1:candidate-rehearsal` 复制 artifacts 后，能继续复用同一份人工验收结论，不会重建成 pending/blocked 候选摘要
- E2E / smoke 辅助链路也做了配套收口：
  - `tests/e2e/fixtures.ts`
    - 改成先在同源页面清空 `localStorage/sessionStorage`，避免 Playwright 在无 origin 状态下静默失败，污染 RC smoke
  - `tests/e2e/smoke-helpers.ts` 与多条 H5 smoke spec
    - 新增 `acceptLobbyPrivacyConsent()`，把隐私同意流程纳进自动化链路
    - release-candidate smoke 不再强依赖 diagnostics panel，以匹配打包版 H5 的真实 UI 形态
  - `tsconfig.base.json` / `tsconfig.json`
    - 为 `tsx` 路径解析补上根级 tsconfig 和 `cc` stub 映射，避免 release/ops 脚本在仓库根目录运行时吃不到统一配置
- 本轮已拿到的同 revision 证据：
  - `npm run smoke:client:release-candidate` 通过
  - `npm run release:reconnect-soak` 通过
  - `npm run release:phase1:candidate-rehearsal -- --target-surface wechat` 通过
  - `npm run release:gate:summary -- --target-surface wechat` 通过
  - 顶层 release gate 当前结论为 `status = passed`，摘要为 `Target surface wechat has current required evidence.`
- 本轮定向验证结果：
  - `npm run typecheck:server` 通过
  - `npm run typecheck:ops` 通过
  - `node --import tsx --test ./scripts/test/wechat-release-artifacts.test.ts ./scripts/test/release-gate-summary.test.ts ./scripts/test/phase1-candidate-rehearsal.test.ts` 通过

## Issue #1174 - WeChat RC DevTools evidence bundle - 2026-04-10

- 本轮把 `release:wechat:rehearsal` 从“prepare / package / verify / validate”四段式彩排，补成了能直接收口 WeChat RC 证据包的工作流：
  - `scripts/wechat-release-rehearsal.ts`
    - 新增可选的 `install-launch-evidence` 阶段：当传入 `--candidate --environment --operator --status` 时，会自动调用 `release:wechat:install-launch-evidence`
    - 新增可选的 `smoke` 阶段：当传入 `--runtime-evidence <json>` 时，会自动生成同目录的 `codex.wechat.smoke-report.json`
    - `validate` 阶段现在支持直接复用 `--manual-checks <json>`，这样同一条 rehearsal 可以把 candidate summary / RC validation / smoke / DevTools 验收记录一起收成一个 artifacts dir
    - 摘要里的 `## Artifacts` 也补出了 `codex.wechat.install-launch-evidence.json/.md`，方便 reviewer 直接校对同一候选 revision 的开发者工具验收记录
  - `scripts/test/wechat-release-rehearsal.test.ts`
    - 新增“带 DevTools install-launch evidence + runtime evidence + manual review”的完整 rehearsal 覆盖
    - 锁住新增阶段顺序、artifact 检测和 candidate summary 产出，避免以后回退到只剩 package/verify
  - `docs/wechat-minigame-release.md`
    - 补上了一条 one-shot 命令示例，说明如何在同一次 rehearsal 里把 DevTools 验收记录、smoke report 和 candidate summary 收到同一候选包
  - `docs/release-script-inventory.md`
    - 同步更新 `release:wechat:rehearsal` 的能力说明与产物列表
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `node --import tsx --test ./scripts/test/wechat-release-rehearsal.test.ts ./scripts/test/wechat-release-artifacts.test.ts` 通过

## Issue #1183 - Commercial review go/no-go packet - 2026-04-10

- 本轮给 `release:go-no-go-packet` 补上了商运外放结论的正式输入面：
  - `scripts/release-go-no-go-decision-packet.ts`
    - 新增 `--commercial-review <path>` 参数，支持显式传入商运复核证据
    - 默认也会从 WeChat artifacts 目录自动发现 `codex.wechat.commercial-review.json / wechat-commercial-review.json / commercial-review.json`
    - packet 里新增 `commercialReadinessSummary` 与 `unresolvedCommercialChecks`
    - 必填商运检查会对 `owner / recordedAt / revision / artifactPath` 做元数据完整性校验，缺失时直接作为 blocker 纳入最终 go/no-go 结论
    - Markdown 输出新增 `Commercial Readiness Summary` 和 `Unresolved Commercial Checks` 两段，方便 release reviewer 直接查看支付、订阅、埋点、合规、真机体验的阻塞项
- 为了让人工填写格式稳定下来，新增了商运复核模板：
  - `docs/release-evidence/wechat-commercial-review.example.json`
    - 覆盖 `payment / subscription / analytics / compliance / device_experience` 五类复核项
    - 约定了 `summary / checks / blockers` 的 JSON 契约，供后续候选包沿用
- 说明文档也同步到了：
  - `docs/release-go-no-go-decision-packet.md`
    - 新增 `--commercial-review` 用法示例
    - 明确要求在跑 go/no-go packet 前附带商运复核文件
- 测试收口：
  - `scripts/test/release-go-no-go-decision-packet.test.ts`
    - 新增商运 blocker 会把最终结论压成 `no_go` 的覆盖
    - 同时修正 CLI 用例的仓库根路径解析，避免环境相关的假失败
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `node --import tsx --test ./scripts/test/release-go-no-go-decision-packet.test.ts` 通过（`4/4`）

## Issue #1185 - Unify go/no-go packet with commercial verification artifacts - 2026-04-10

- 本轮把 go/no-go packet 的商运输入统一到了正式产物链路：
  - `scripts/release-go-no-go-decision-packet.ts`
    - 新增 `--commercial-verification <path>`，同时继续兼容旧的 `--commercial-review <path>`
    - 自动发现逻辑现在会优先读取 `codex.wechat.commercial-verification-<short-sha>.json`，缺失时才回退到旧 `commercial-review` 文件
    - packet 可以直接解析 `release:wechat:commercial-verification` 的正式 JSON 产物，并把它归一到现有的 `commercialReadinessSummary / unresolvedCommercialChecks / blockerSummary`
    - 对 verification report 中已有的 `metadataFailures` 继续原样吸收，避免 packet 侧再丢掉 `stale recordedAt` 这类商运阻塞信号
- 文档主链路也改成了同一个来源：
  - `docs/release-go-no-go-decision-packet.md`
    - 改为推荐先跑 `npm run release:wechat:commercial-verification`
    - 显式说明 go/no-go packet 会优先自动发现 `commercial-verification` 产物
  - `docs/wechat-minigame-release.md`
    - 在商运验证步骤后补上了 go/no-go packet 的直接消费说明，不再建议额外手填独立 review 文件
  - `docs/release-script-inventory.md` 与 `scripts/release-script-inventory.ts`
    - 同步更新 `release:go-no-go-packet` 的职责说明，避免 inventory 再回滚成旧描述
- 测试收口：
  - `scripts/test/release-go-no-go-decision-packet.test.ts`
    - 新增自动发现 `codex.wechat.commercial-verification-abc1234.json` 的覆盖
    - 旧 `commercial-review` 路径的兼容用例继续保留
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `node --import tsx --test ./scripts/test/release-go-no-go-decision-packet.test.ts ./scripts/test/wechat-commercial-verification.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`10/10`）

## Issue #1187 - WeChat rehearsal commercial verification stage - 2026-04-10

- 本轮把 `release:wechat:rehearsal` 从“技术候选包彩排”继续推进成“可选收口商运结论”的一键链路：
  - `scripts/wechat-release-rehearsal.ts`
    - 新增 `--run-commercial-verification`，用于在 rehearsal 末尾追加 `release:wechat:commercial-verification`
    - 新增 `--commercial-checks <json>` 与 `--commercial-freshness-hours <hours>`，可直接把 candidate 专属商运复核 contract 透传给 commercial verification 阶段
    - `DetectedArtifacts` 和 Markdown summary 现在会自动收集并展示 `codex.wechat.commercial-verification-<short-sha>.json/.md`
    - 保持旧调用方式不变：不传上述参数时，rehearsal 仍只跑原有 `prepare / package / verify / install-launch / smoke / validate`
- 文档与 inventory 已同步：
  - `docs/wechat-minigame-release.md`
    - 更新 `release:wechat:rehearsal` 的命令示例与发布彩排摘要，明确可选 commercial verification 阶段
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 更新 `release:wechat:rehearsal` 的职责与产物说明
- 测试收口：
  - `scripts/test/wechat-release-rehearsal.test.ts`
    - 新增“rehearsal 可追加 commercial verification artifacts”的完整覆盖
    - 断言阶段序列扩展为 `prepare -> package -> verify -> install-launch-evidence -> smoke -> validate -> commercial-verification`
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `node --import tsx --test ./scripts/test/wechat-release-rehearsal.test.ts ./scripts/test/wechat-commercial-verification.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`7/7`）

## Issue #1190 - WeChat rehearsal go/no-go packet stage - 2026-04-10

- 本轮继续把 `release:wechat:rehearsal` 往最终决策附件推进了一步：
  - `scripts/wechat-release-rehearsal.ts`
    - 新增 `--run-go-no-go-packet`
    - 新增 `--dossier <path>` 与 `--release-gate-summary <path>`，用于把同一 candidate revision 的 Phase 1 dossier 和 release gate summary 显式透传给 go/no-go packet
    - 当启用该阶段时，rehearsal 会在 `commercial-verification` 之后追加 `release:go-no-go-packet`
    - 产物固定收口到当前 artifacts dir 下：
      - `codex.wechat.go-no-go-decision-packet.json`
      - `codex.wechat.go-no-go-decision-packet.md`
    - `DetectedArtifacts` 与 Markdown summary 现在也会自动列出 go/no-go packet
- 文档与 inventory 已同步：
  - `docs/wechat-minigame-release.md`
    - 更新 `release:wechat:rehearsal` 的命令示例与发布彩排摘要，明确可选追加最终决策 packet
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 更新 `release:wechat:rehearsal` 的职责与产物说明，包含 go/no-go packet
- 测试收口：
  - `scripts/test/wechat-release-rehearsal.test.ts`
    - 新增“rehearsal 可追加 go/no-go packet”的完整覆盖
    - 锁住阶段序列：`prepare -> package -> verify -> install-launch-evidence -> smoke -> validate -> commercial-verification -> go-no-go-packet`
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `node --import tsx --test ./scripts/test/wechat-release-rehearsal.test.ts ./scripts/test/release-go-no-go-decision-packet.test.ts ./scripts/test/wechat-commercial-verification.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`13/13`）

## Issue #1192 - Phase 1 candidate rehearsal go/no-go packet - 2026-04-10

- 本轮把 `release:phase1:candidate-rehearsal` 继续收口成了“同一候选 revision 的最终决策彩排”：
  - `scripts/phase1-candidate-rehearsal.ts`
    - 在既有 `phase1-candidate-dossier` 阶段后新增 `go-no-go-packet` 阶段
    - 该阶段会复用同一次 rehearsal 产出的 dossier 与 release gate summary，并把 stable WeChat artifacts dir 透传给 `release:go-no-go-packet`
    - rehearsal artifacts 现在会固定记录：
      - `goNoGoPacketPath`
      - `goNoGoPacketMarkdownPath`
    - staged bundle 的 `requiredArtifacts` 也追加了最终 go/no-go packet，避免 `SUMMARY.md` 只收 dossier 不收最终决策附件
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 candidate rehearsal 现在会收口到 final go/no-go packet
    - 补充 `release:go-no-go-packet` 属于该链路复用的核心命令
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 final go/no-go packet
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 新增 `go-no-go-packet` 阶段断言
    - 锁住 `goNoGoPacketPath` 与 `goNoGoPacketMarkdownPath` 两个 staged artifact
    - 校验生成的 `SUMMARY.md` 会显式列出 go/no-go packet
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `node --import tsx --test ./scripts/test/phase1-candidate-rehearsal.test.ts ./scripts/test/release-go-no-go-decision-packet.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`9/9`）

## Issue #1198 - Phase 1 candidate rehearsal evidence front-door - 2026-04-10

- 本轮把 `release:phase1:candidate-rehearsal` 又往 reviewer 前门推进了一步：
  - `scripts/phase1-candidate-rehearsal.ts`
    - 复用了 `phase1-same-revision-evidence-bundle` 生成的 owner ledger，并在 rehearsal 顶层 packet 再 stage 一份稳定路径
    - 新增 `candidate-evidence-audit` 阶段，直接生成候选级 evidence audit JSON / Markdown
    - 新增 `release-evidence-index` 阶段，基于当前 rehearsal packet 生成 reviewer first-stop 的 current release evidence index
    - rehearsal artifacts 现在会显式记录：
      - `manualEvidenceLedgerPath`
      - `candidateEvidenceAuditPath`
      - `candidateEvidenceAuditMarkdownPath`
      - `releaseEvidenceIndexPath`
      - `releaseEvidenceIndexMarkdownPath`
    - candidate evidence audit 会按“产物生成成功”收口，不会因为 manual sign-off 仍待完成就把整条 rehearsal generation 判成失败
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal 现在会附带 reviewer 前门的 evidence audit 与 current evidence index
    - 补充 candidate evidence audit 在 manual sign-off 仍 pending 时属于预期信息性阻塞，不视为 generation failure
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 candidate evidence audit 与 current evidence index
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 `candidate-evidence-audit` 与 `release-evidence-index` 两个新阶段
    - 校验 rehearsal summary 会显式列出 reviewer 前门产物
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `node --import tsx --test ./scripts/test/phase1-candidate-rehearsal.test.ts ./scripts/test/release-evidence-index.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`6/6`）

## Issue #1220 - Phase 1 candidate rehearsal exit gates - 2026-04-11

- 本轮把 `release:phase1:candidate-rehearsal` 的最终 reviewer gate 也收进了同一个 candidate packet：
  - `scripts/phase1-candidate-rehearsal.ts`
    - 新增 `phase1-exit-audit` 阶段，直接在 rehearsal 中生成 Phase 1 exit audit JSON / Markdown
    - 新增 `phase1-exit-dossier-freshness-gate` 阶段，校验 dossier / exit audit / snapshot / gate / owner ledger 的同 revision 一致性
    - final reviewer gate 现在会复用同一轮 rehearsal 已生成的 dossier，并把 exit audit 内部引用的 snapshot / gate / ledger 路径归一到当前 candidate packet
    - rehearsal artifacts 现在会显式记录：
      - `phase1ExitAuditPath`
      - `phase1ExitAuditMarkdownPath`
      - `phase1ExitDossierFreshnessGatePath`
      - `phase1ExitDossierFreshnessGateMarkdownPath`
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal 现在会附带 Phase 1 exit audit 与 exit-dossier freshness gate
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 final reviewer gate
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 `phase1-exit-audit` 与 `phase1-exit-dossier-freshness-gate` 两个新阶段
    - 校验 rehearsal summary 会显式列出 final reviewer gate 产物
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `node --import tsx --test ./scripts/test/phase1-candidate-rehearsal.test.ts ./scripts/test/phase1-exit-dossier-freshness-gate.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`7/7`）

## Issue #1243 - Phase 1 rehearsal owner reminders - 2026-04-11

- 本轮把 `release:phase1:candidate-rehearsal` 的 candidate audit companion artifacts 也收进了同一个 reviewer packet：
  - `scripts/phase1-candidate-rehearsal.ts`
    - `candidate-evidence-audit` 阶段现在会同步产出并登记：
      - `candidateEvidenceOwnerReminderPath`
      - `candidateEvidenceOwnerReminderMarkdownPath`
      - `candidateEvidenceFreshnessHistoryPath`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出 candidate owner reminder 与 freshness history
  - `scripts/same-candidate-evidence-audit.ts`
    - 导出 owner reminder / freshness history 辅助函数，供 rehearsal 直接复用同一条 candidate audit 逻辑
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal reviewer front door 现在包含 candidate owner reminder 与 freshness history
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 audit companion artifacts
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 owner reminder / freshness history 的 artifact path 与 summary 呈现
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `npm run docs:release-script-inventory` 通过
  - `node --import tsx --test ./scripts/test/phase1-candidate-rehearsal.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`4/4`）

## Issue #1245 - Phase 1 rehearsal freshness guard - 2026-04-11

- 本轮把 `release:phase1:candidate-rehearsal` 的 authoritative same-candidate gate 也收进了同一个 reviewer packet：
  - `scripts/phase1-candidate-rehearsal.ts`
    - 新增 `candidate-evidence-freshness-guard` 阶段
    - rehearsal artifacts 现在会显式登记：
      - `candidateEvidenceFreshnessGuardPath`
      - `candidateEvidenceFreshnessGuardMarkdownPath`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出 candidate freshness guard
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal reviewer front door 现在包含 candidate freshness guard
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 dedicated freshness guard
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 freshness guard 阶段、artifact path 与 summary 呈现
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `npm run docs:release-script-inventory` 通过
  - `node --import tsx --test ./scripts/test/phase1-candidate-rehearsal.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`4/4`）

## Issue #1247 - Phase 1 rehearsal PR summary - 2026-04-11

- 本轮把 `release:phase1:candidate-rehearsal` 的最终 reviewer digest 也收进了同一个 candidate packet：
  - `scripts/phase1-candidate-rehearsal.ts`
    - 新增 `release-pr-summary` 阶段
    - rehearsal artifacts 现在会显式登记：
      - `releasePrCommentPath`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出 release PR summary
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 现在包含 reviewer-facing release PR summary
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 release PR summary
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 `release-pr-summary` 阶段、artifact path 与 summary 呈现
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `npm run docs:release-script-inventory` 通过
  - `node --import tsx --test ./scripts/test/phase1-candidate-rehearsal.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`4/4`）

## Issue #1249 - Phase 1 rehearsal primary diagnostics - 2026-04-11

- 本轮把 `release:cocos:primary-diagnostics` 也收进了 `release:phase1:candidate-rehearsal` 的 candidate packet：
  - `scripts/phase1-candidate-rehearsal.ts`
    - 新增 `cocos-primary-diagnostics` 阶段
    - rehearsal artifacts 现在会显式登记：
      - `cocosPrimaryDiagnosticsPath`
      - `cocosPrimaryDiagnosticsMarkdownPath`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出 Cocos primary diagnostics
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 现在包含 Cocos primary-client diagnostic snapshots
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 Cocos primary diagnostics
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 `cocos-primary-diagnostics` 阶段、artifact path 与 summary 呈现
- 本轮定向验证结果：
  - `npm run typecheck:ops` 通过
  - `npm run docs:release-script-inventory` 通过
  - `node --import tsx --test ./scripts/test/phase1-candidate-rehearsal.test.ts ./scripts/test/release-script-inventory.test.ts` 通过（`4/4`）

## Issue #1255 - Phase 1 rehearsal candidate triage digest - 2026-04-11

- 本轮把 `release:candidate-triage:digest` 也收进了 `release:phase1:candidate-rehearsal` 的 candidate packet：
  - `scripts/phase1-candidate-rehearsal.ts`
    - 新增 `candidate-revision-triage-digest` 阶段
    - 会从 `cocos-primary-client-diagnostic-snapshots` 汇总 `checkpoints[].diagnostics.errorEvents`
    - 生成并登记：
      - `candidateRevisionTriageInputPath`
      - `candidateRevisionTriageDigestPath`
      - `candidateRevisionTriageDigestMarkdownPath`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出 candidate revision triage digest
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 现在包含基于 Cocos primary diagnostics 导出的 triage input/digest pair
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 triage digest
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 `candidate-revision-triage-digest` 阶段、artifact path 与 summary 呈现

## Issue #1257 - Phase 1 rehearsal primary journey evidence - 2026-04-11

- 本轮把 `release:cocos:primary-journey-evidence` 也收进了 `release:phase1:candidate-rehearsal` 的 candidate packet：
  - `scripts/phase1-candidate-rehearsal.ts`
    - 新增 `cocos-primary-journey-evidence` 阶段
    - 生成并登记：
      - `cocosPrimaryJourneyEvidencePath`
      - `cocosPrimaryJourneyEvidenceMarkdownPath`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出 Cocos primary journey evidence
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 现在包含 standalone 的 Cocos primary-client journey evidence
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 primary journey evidence
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 `cocos-primary-journey-evidence` 阶段、artifact path 与 summary 呈现

## Issue #1259 - Phase 1 rehearsal main-journey replay gate - 2026-04-11

- 本轮把 `cocos-main-journey-replay-gate` 从 `release:cocos-rc:bundle` 的内部产物提升成了 `release:phase1:candidate-rehearsal` 的显式 reviewer packet 入口：
  - `scripts/phase1-candidate-rehearsal.ts`
    - 新增 `cocos-main-journey-replay-gate` staging 阶段
    - 显式登记：
      - `cocosMainJourneyReplayGatePath`
      - `cocosMainJourneyReplayGateMarkdownPath`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出 Cocos main-journey replay gate
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 现在包含 standalone 的 Cocos main-journey replay gate
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 main-journey replay gate
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 `cocos-main-journey-replay-gate` 阶段、artifact path 与 summary 呈现

## Issue #1262 - Phase 1 rehearsal drift gate front door - 2026-04-11

- 本轮把 `phase1-release-evidence-drift-gate` 提升成了 `release:phase1:candidate-rehearsal` 的显式 reviewer front door 入口：
  - `scripts/phase1-candidate-rehearsal.ts`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出：
      - `phase1ReleaseEvidenceDriftGatePath`
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 会把 paired Phase 1 release evidence drift gate 作为 packet-level same-revision checkpoint 前置展示
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 drift gate front door
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 reviewer front door 对 `phase1ReleaseEvidenceDriftGatePath` 的展示

## Issue #1264 - Phase 1 rehearsal exit audit front door - 2026-04-11

- 本轮把 `phase1-exit-audit` 提升成了 `release:phase1:candidate-rehearsal` 的显式 reviewer front door 入口：
  - `scripts/phase1-candidate-rehearsal.ts`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出：
      - `phase1ExitAuditPath`
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 会把 Phase 1 exit audit 作为 packet-level reviewer checkpoint 前置展示
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 exit audit front door
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 reviewer front door 对 `phase1ExitAuditPath` 的展示

## Issue #1266 - Phase 1 rehearsal exit-dossier freshness front door - 2026-04-11

- 本轮把 `phase1-exit-dossier-freshness-gate` 提升成了 `release:phase1:candidate-rehearsal` 的显式 reviewer front door 入口：
  - `scripts/phase1-candidate-rehearsal.ts`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出：
      - `phase1ExitDossierFreshnessGatePath`
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 会把 Phase 1 exit-dossier freshness gate 作为 packet-level reviewer checkpoint 前置展示
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 exit-dossier freshness gate front door
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 reviewer front door 对 `phase1ExitDossierFreshnessGatePath` 的展示

## Issue #1269 - Phase 1 rehearsal go/no-go front door - 2026-04-11

- 本轮把 `go-no-go packet` 提升成了 `release:phase1:candidate-rehearsal` 的显式 reviewer front door 入口：
  - `scripts/phase1-candidate-rehearsal.ts`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出：
      - `goNoGoPacketPath`
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 会把 final go/no-go packet 作为 packet-level reviewer checkpoint 前置展示
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 go/no-go packet front door
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 reviewer front door 对 `goNoGoPacketPath` 的展示

## Issue #1271 - Phase 1 rehearsal dossier front door - 2026-04-11

- 本轮把 `phase1-candidate-dossier` 提升成了 `release:phase1:candidate-rehearsal` 的显式 reviewer front door 入口：
  - `scripts/phase1-candidate-rehearsal.ts`
    - `SUMMARY.md` 的 reviewer front door 现在会直接列出：
      - `phase1CandidateDossierPath`
- 文档与 inventory 已同步：
  - `docs/phase1-candidate-rehearsal.md`
    - 明确 rehearsal packet 会把 Phase 1 candidate dossier 作为 packet-level reviewer checkpoint 前置展示
  - `scripts/release-script-inventory.ts` / `docs/release-script-inventory.md`
    - 同步更新 `release:phase1:candidate-rehearsal` 的职责与产物说明，包含 candidate dossier front door
- 测试收口：
  - `scripts/test/phase1-candidate-rehearsal.test.ts`
    - 锁住 reviewer front door 对 `phase1CandidateDossierPath` 的展示
