游戏设计与技术白皮书概要
项目代号： Project Veil
核心品类： 移动端多人在线战棋策略（SRPG / SLG），《英雄无敌》Like
核心体验： 大地图迷雾探索、资源收集、回合制网格战斗

1. 项目目的 (Project Purpose)
核心目标： 以极低的试错成本，快速验证《英雄无敌》式的大地图探索与 PVE 战棋玩法在移动端的可行性。

长线目标： 构建一个高可扩展的联机底层架构。前期通过 PVE 跑通核心循环（探索 -> 积累 -> 战斗），后期平滑扩展至玩家间的 PVP 对抗。

技术目标： 打造一套前后端彻底解耦、基于全栈 TypeScript 的轻量化、高复用代码库。

2. 设计范围 (Design Scope)
为了控制成本并保证项目能快速落地，我们需要明确“第一阶段（Phase 1）”要做什么，坚决不做什么：

✅ Phase 1 包含内容 (In Scope)
大地图探索核心： 基于网格（正交或六边形）的地图生成、英雄寻路（A* 算法）、以及低性能消耗的图层遮罩式迷雾（Fog of War）。

基础 PVE 交互： 在地图上拾取静态资源、访问建筑触发增益/事件、触碰明雷怪物进入 PVE 战斗结算。

权威服务器架构 (Authoritative Server)： 即使是 PVE，状态流转也必须在后端完成。客户端发送 Action（移动/攻击指令），服务器校验并广播 State（位置/血量变化）。

轻量化 2D 表现： 采用 2D 瓦片地图（Tilemap）和序列帧/Spine 动画进行视觉呈现。

❌ Phase 1 不包含内容 (Out of Scope)
复杂的 3D 渲染、高级光影、物理碰撞模拟。

实时的 PVP 匹配与毫秒级帧同步（早期先用 PVE 容错）。

重度的周边系统（如复杂的公会、深度的商城 UI），前期只聚焦核心的“跑图+战斗”循环。

3. 技术与架构要求 (Technical Requirements)
这是 Project Veil 能否保持低成本且避免后期重构灾难的关键约束：

开发语言：全栈 TypeScript

实现前后端数据模型（Model）的 100% 复用。网格定义、角色属性、战斗公式打包成独立模块，前后端共用一套接口定义（Interface）。

架构范式：状态驱动与纯函数

战斗与移动逻辑必须与 UI 表现彻底解耦。采用不可变数据（Immutable）思想，将一次战斗结算封装为无副作用的纯函数。确保给同样的输入，服务器和本地演算必然得出同样的结果，彻底杜绝状态错乱。

引擎选型：

客户端： 采用 Cocos Creator 或 Phaser 等轻量级 2D 框架，客户端彻底降级为“数据状态渲染器”。

服务端： Node.js 环境，配合 Colyseus 等专为多人状态同步设计的框架，管理房间（大地图区域）和状态广播。

资源与配置管理：Web 化驱动

彻底摒弃手工维护 Excel 表格的传统模式。 搭建轻量级的可视化 Web 配置中心，管理几百种兵种、地图物件和数值。

将配置直接导出为强类型的 JSON。这种“数据即配置”的流水线可以有效避免多人协作时的版本冲突，并实现热更新的丝滑接入。

---

## Contributor Quickstart

最快的本地贡献路径已经按以下流程验证过，不需要 MySQL，也不需要先复制 `.env.example`：

### Prerequisites

- Node.js 22 LTS（CI 同款；仓库提供 `.nvmrc`）
- npm 10+
- 可选：MySQL 8+（只有在你要验证持久化时才需要）

### 5-Minute Setup

```bash
nvm use
npm ci --no-audit --no-fund
npm run validate:quickstart
```

`npm run validate:quickstart` 会做两件事：

- 构建 H5 调试壳
- 以默认内存存储启动本地服务，并校验 `health` / `auth-readiness` / `lobby` 接口

验证通过后，常用本地运行命令如下：

```bash
npm run dev:server
npm run dev:client:h5
```

默认地址：

- H5 调试壳：`http://127.0.0.1:5173/`
- 配置台：`http://127.0.0.1:5173/config-center.html`
- 服务端健康检查：`http://127.0.0.1:2567/api/runtime/health`
- 匹配队列默认会把断线玩家 5 分钟后清理掉，可用 `VEIL_MATCHMAKING_QUEUE_TTL_SECONDS`（默认 `300` 秒）覆盖

如果你要启用 MySQL 持久化，再复制 `.env.example` 到 `.env`，填入 `VEIL_MYSQL_*`，然后执行 `npm run db:migrate`。更多说明见 `docs/mysql-persistence.md`。

## 当前仓库落地内容

本仓库已经按 Phase 1 要求初始化为一个全栈 TypeScript monorepo：

- `packages/shared`
  - 共享世界状态、战斗状态、Action 协议。
  - 地图生成、玩家私有迷雾、A* 路径校验、移动路径规划、资源拾取纯函数。
  - 战斗回合排序、攻击/等待/防御、反击与确定性伤害结算纯函数。
- `configs`
  - `phase1-world.json` 管理地图尺寸、初始英雄、中立怪与资源刷率。
  - `hero-skills.json` 管理英雄长期技能树分支、等级门槛与每阶解锁的战斗技能。
- `apps/server`
  - 权威房间状态骨架。
  - 玩家视角裁剪快照与 Action 校验。
  - 统一通过共享 reducer 处理客户端 Action，并在接触明雷时生成战斗快照。
  - 战斗结束后回写世界状态，胜利移除明雷并发放奖励，失败施加英雄惩罚。
  - MySQL 持久化现已包含房间快照、玩家房间档案、`player_accounts` 全局资源仓库初版，以及 `player_hero_archives` 英雄长期档；长期档当前会携带等级成长、已学技能、装备槽位和当前带兵信息。
- `apps/client`
  - H5 调试 / 回归壳。
  - 当前保留给浏览器内快速验证、配置联调和回归测试使用，不再作为主客户端运行时。
  - `apps/client/test/main-boot.test.ts` 额外承担一层轻量 boot/session 回归：固定 `main.ts` 启动阶段的缓存会话回放、远端会话不可用时的本地回退或失败信号、以及 automation/debug hooks 注册结果。
  - 这层回归不覆盖真实浏览器导航、Colyseus 长链路重连、或 Cocos 主客户端集成；这些仍由 Playwright、`local-session.ts`/server 测试和 `apps/cocos-client` 自动化承担。
- `apps/cocos-client`
  - Cocos Creator 3.x 主客户端运行时。
  - 当前已覆盖 Lobby、地图探索、战斗、账号会话恢复和配置中心跳转的主流程。
- `docs/phase1-design.md`
  - 更细的产品、技术与小程序部署方案。
- `docs/test-coverage-audit-issue-199.md`
  - 当前 server / H5 / Cocos 自动化测试覆盖审计，以及下一批高收益补测建议。

## 建议的下一步

1. 继续把正式资源、动画和小游戏构建流程压到 `apps/cocos-client`，收口成可持续迭代的主客户端工程。
2. 在 `apps/server` 继续扩展 Colyseus 房间与消息协议，补多人玩法和更细的同步治理。
3. 继续完善 `configs/` 目录和 JSON 校验脚本，推进数值与地图配置生产流水线。
4. 维持 `apps/client` 的最小 H5 调试面，专注回归验证和配置联调，而不是继续承载主体验。

## 本地运行

- 安装依赖：`npm ci --no-audit --no-fund`
- 快速校验首条贡献路径：`npm run validate:quickstart`
- 本地 WebSocket 服务：`npm run dev:server`
- 运行时健康检查：`GET http://127.0.0.1:2567/api/runtime/health`
- 鉴权就绪摘要：`GET http://127.0.0.1:2567/api/runtime/auth-readiness`
- 运行时指标抓取：`GET http://127.0.0.1:2567/api/runtime/metrics`
- 终端逻辑演示：`npm run demo:flow`
- 主客户端入口说明：`npm run client:primary`
- Cocos 主客户端类型检查：`npm run typecheck:client`
- 微信小游戏模板刷新：`npm run prepare:wechat-build`
- 微信小游戏 CI 同款校验：`npm run check:wechat-build`
- 发布就绪快照：`npm run release:readiness:snapshot`
- 统一发布门禁汇总：`npm run release:gate:summary`
- 打包 H5 客户端 RC 冒烟：`npm run smoke:client:release-candidate`
- 微信小游戏真实导出校验：`npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`
- 微信小游戏发布包产出：`npm run package:wechat-release -- --output-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir> --expect-exported-runtime [--source-revision <git-sha>]`
- 微信小游戏 RC artifact 聚合验收：`npm run validate:wechat-rc -- --artifacts-dir <release-artifacts-dir> [--expected-revision <git-sha>] [--version <wechat-version>]`
- 微信小游戏发布彩排：`npm run release:wechat:rehearsal -- --build-dir <wechatgame-build-dir> --artifacts-dir <release-artifacts-dir>`（顺序执行 prepare / package / verify / validate，并在 `artifacts/wechat-release/` 输出 JSON + Markdown 摘要）
- Issue #33 开源素材 staging 校验：`npm run check:issue33-assets -- --require-pack`
- GitHub Actions `wechat-build-validation` 会把发布归档与 sidecar 元数据作为 artifact `wechat-release-<sha>` 上传，便于提审前下载与回溯
- 统一发布门禁汇总默认输出到 `artifacts/release-readiness/release-gate-summary-<short-sha>.json` 和 `.md`，用于 CI artifact、PR 评论或人工巡检；详情见 `docs/release-gate-summary.md`
- H5 调试壳开发服务：`npm run dev:client:h5`
- H5 调试壳构建验证：`npm run build:client:h5`
- H5 调试壳类型检查：`npm run typecheck:client:h5`
- H5 开发态诊断导出：
  `window.export_diagnostic_snapshot()` 返回稳定 JSON；
  `window.render_diagnostic_snapshot_to_text()` 返回与面板一致的紧凑文本摘要，便于自动化留档
- H5 / Lobby Playwright 冒烟：`npm run test:e2e:smoke`
- 打包 H5 客户端 RC 冒烟会把结构化结果写入 `artifacts/release-readiness/`
- 多人联机 Playwright 冒烟：`npm run test:e2e:multiplayer:smoke`
- GitHub Actions `playwright-smoke` 会执行上述两条冒烟回归，并在失败时上传 Playwright trace / screenshot / video 诊断材料
- MySQL 首次初始化 / 升级：`npm run db:migrate`
- MySQL 回滚上一版 schema：`npm run db:migrate:rollback`
- `npm run db:init:mysql` 现已委托给同一条迁移链路，不再走独立一次性建表逻辑
- 并发房间压测：`npm run stress:rooms -- --rooms=120 --connect-concurrency=24 --action-concurrency=24`
- 并发房间压测启动后，也可直接查看同进程观测面：`/api/runtime/health`、`/api/runtime/auth-readiness` 与 `/api/runtime/metrics`
- 战斗平衡验证：`npm run validate:battle -- --count=1000 --scenario=all --skill-config=configs/battle-skills-v1.1.json`
- 内容包一致性验证：`npm run validate:content-pack -- --report-path artifacts/content-pack-validation-report.json`
- 覆盖率 CI 同款校验：`npm run test:coverage:ci`
- 覆盖率摘要：`.coverage/summary.md`
- 共享客户端载荷 contract 快照：`npm run test:contracts`
- 并发房间压测会按 `world_progression / battle_settlement / reconnect` 三种场景分开跑数，并输出 CPU、内存、房间吞吐、动作吞吐等指标；可通过 `--scenarios=world_progression,reconnect` 等参数缩小范围
- 当前客户端边界：`apps/cocos-client` 负责主玩法运行时；`apps/client` 只保留浏览器调试、配置联调和回归验证。
- 微信小游戏构建 / 发布 / 回滚说明：`docs/wechat-minigame-release.md`
- 核心玩法发布门禁清单：`docs/core-gameplay-release-readiness.md`
- 发布就绪快照说明：`docs/release-readiness-snapshot.md`
- 共享 contract 快照说明：`docs/shared-contract-snapshots.md`
- 当前 H5 调试壳仍支持：地图点击移动、可达格高亮、悬停路径预览、资源/明雷信息提示、轻量路径播放反馈、可视化战斗单位面板、目标选中、伤害飘字与战后结果弹窗。
- 当前 H5 联机体验已支持：客户端预测、断线自动重连、刷新后本地快照首帧回放，再由权威房间状态收敛。
- 当前 Cocos Creator 主客户端已补齐：
  - 工程目录：`apps/cocos-client`
  - 入口脚本：`apps/cocos-client/assets/scripts/VeilRoot.ts`
  - 组件拆分：`VeilRoot` 负责联机流程编排，`VeilHudPanel` 负责 HUD，`VeilMapBoard` 负责地图与点击交互，`VeilBattlePanel / VeilTimelinePanel` 负责右侧信息与战斗面板
  - `VeilBattlePanel` 现已按 `战况摘要 / 待动序列 / 我方单位 / 敌方目标 / 指令操作` 分区渲染，并支持按回合归属自动启停 `attack / wait / defend`
  - 当前支持：连接现有 Colyseus 服务、显示 HUD、优先驱动 `TiledMap` 图层渲染地图；未绑定资源时回退到文字版网格，并保持点击移动/采集
  - Tilemap 现已支持可选 `fogEdge` 迷雾过渡层，以及地图事件反馈标记（如 `MOVE / +WOOD / XP / PVE / VICTORY`）
  - `VeilRoot` 现已支持低成本动态迷雾脉冲，未接正式 shader 前也能先得到持续变化的 fog / fogEdge 表现
  - 非 Tilemap 回退模式现已补上独立 `VeilFogOverlay` 迷雾覆盖层，会随迷雾相位切换透明度与字符遮罩
  - Cocos 地图层现已开始复用对象配置，资源点/守军/敌方英雄会显示稳定的小标签覆盖层，并在拾取/接敌时给出轻量回弹反馈
  - 当前已同步接入客户端预测，Cocos 点击移动也会先本地预演再等待服务端确认
  - 当前也支持断线重连时读取最近快照，先回放本地缓存再等待房间同步
  - `VeilUnitAnimator` 现已支持按状态配置 Spine / Animation 名称，并可为一次性动作设置自动回到 `idle` 的时长
  - 已补骨架：Tilemap 增量渲染、单位动画适配层（Spine/Animation/文字占位）、战斗转场控制器
  - 详细接入步骤见：`apps/cocos-client/README.md`
- 当前已补上配置中心 MVP：
  - 前端入口：`http://127.0.0.1:4173/config-center.html`
  - 后端 API：`/api/config-center/configs`
  - 当前支持编辑 `phase1-world.json / phase1-map-objects.json / units.json / battle-skills.json / battle-balance.json`
  - 未配置 MySQL 时走文件系统存储；配置 `VEIL_MYSQL_*` 后切换到 MySQL 主存储
  - 保存后会同时导出到 `configs/*.json`，并同步刷新服务端运行时配置，新建房间和战斗逻辑会直接读取新值
  - 当前已补上版本快照、快照差异对比、历史回滚，以及 Easy / Normal / Hard 三档内置预设和自定义预设保存
  - 实时校验现已带出对应配置 schema 摘要、必填根字段、逐项修复建议，以及跨 `world / mapObjects / units / battleSkills / battleBalance` 的 content-pack 一致性结果；非法值会阻止保存
  - 导出除 JSON 注释版外，还支持带 `Meta / Schema / Fields` 工作表的 Excel，以及更轻量的字段清单 CSV
  - 当前编辑 `phase1-world.json` 时，右侧会即时生成一份地图样本预览；可切换预览 seed，对照查看地形、随机资源、保底资源、英雄与中立怪分布
  - 当前编辑 `battle-skills.json` 时，右侧会显示技能编辑器，可直接调整冷却、伤害倍率、目标类型、附加状态和状态持续参数，并同步回写 JSON 草稿
  - 当前编辑 `battle-balance.json` 时，右侧会显示战斗平衡编辑器，可直接调整伤害公式、路障/陷阱阈值、附加状态和 ELO K；非法值会在 Schema/语义校验里给出修复建议并阻止保存
- H5 战斗面板现已补上“战术情报”区，会并排展示当前行动单位和已锁定目标的技能、状态、冷却与效果说明，便于直接核对配置是否符合预期。
- Cocos 战斗面板现已补上技能摘要和目标状态提示，概要区、目标卡与动作按钮都会带出当前技能/状态信息，而不再只有基础攻击指令。
- `phase1-map-objects.json` 现已支持配置 `buildings`，当前已接入 `recruitment_post` 招募所、`attribute_shrine` 属性神殿和 `resource_mine` 资源矿场；英雄停在建筑格上再次点击当前格即可访问或占领建筑。
- 招募所会按库存和资源消耗补充部队，并在每日推进后自动重置；属性神殿会给当前英雄永久属性加成，并记录已访问英雄避免重复领取；资源矿场则会在占领后于“推进一天”时自动结算金币/木材/矿石产出。H5 / Cocos / 配置中心地图预览都已能显示这些建筑。
- `neutralArmies` 现已支持可选 `behavior` 字段：可配置 `guard / patrol` 模式、显式巡逻路线或 `patrolRadius` 自动巡逻圈，并可按 `detectionRadius / chaseDistance / speed` 精细调节巡逻、追击与返回节奏；中立怪会在每日推进时按路线巡逻、失位后回守，并在英雄靠近时主动追击，贴身时直接触发遭遇战。
- 当前 MySQL 资源持久化已补上 `player_accounts`：房间保存时会同步刷新玩家全局 `gold / wood / ore` 仓库，新建房间会先回灌这份全局资源，因此同一 `playerId` 的基础资源已能跨房间继承。
- 当前 MySQL 英雄长期档已补上 `player_hero_archives`：房间保存时会同步刷新英雄的长期成长、已学技能、装备槽位与带兵快照，新建房间会先回灌这些长期数据，因此同一 `playerId` 的英雄属性成长、build 和当前带兵已能跨房间继承；英雄的位置、剩余移动力和当前生命仍会按新局重置。
- 装备系统的第一批基础能力现已落到 shared/core：共享层补上了 `weapon / armor / accessory` 三类装备目录、品质与特殊效果元数据，英雄长期档里的装备槽位 ID 会直接映射成可计算的属性加成，并且会在创建战斗栈时折算进攻击/防御，方便后续继续接掉落、锻造与 UI。
- 当前玩家账号骨架也已接到 `player_accounts`：账号记录现已包含 `displayName / lastRoomId / lastSeenAt / globalResources`，并开放 `GET /api/player-accounts`、`GET /api/player-accounts/:playerId`、`PUT /api/player-accounts/:playerId` 供开发态查看与改名；房间 `connect` 时会自动建档或刷新最近活跃房间。
- 玩家账号进度读模型现已补上共享世界事件日志与成就摘要接口：服务端会把移动、建筑、战斗、技能、成就解锁，以及玩家可见的 `neutral.moved` 追击/巡逻事件写入 `recentEventLog`，并开放 `GET /api/player-accounts/:playerId/event-log`、`/achievements`、`/progression` 供 H5 / Cocos 直接读取；多阶段成就还会追加“成就进度推进”日志，方便后续做提示或回顾面板。
- 这轮又补了一层独立的玩家事件历史读模型：`savePlayerAccountProgress()` 会把账号 `recentEventLog` 里新增的结构化事件增量追加到 MySQL `player_event_history`，并开放 `GET /api/player-accounts/:playerId/event-history` / `/me/event-history`（支持 `limit`、`offset` 和现有事件筛选条件），让前端可以先做分页历史回顾而不用等完整战斗回放或完整成就 UI。
- 玩家事件历史接口现已支持可选 `since` / `until` 时间范围筛选，且本地模式与 MySQL 持久化模式保持一致，方便后续只拉取某个时间窗内的世界事件或成就回顾。
- 事件日志的共享基础当前收敛在 `packages/shared/src/event-log.ts`：除了事件/成就 schema、归一化和查询助手外，这里也统一提供世界事件日志工厂与成就日志工厂，服务端只负责把共享 `WorldEvent[]` 喂给这些 helper；完整战斗回放、完整成就 UI 和更长历史存储仍留给后续 issue 继续扩展。

## Coverage Policy

`npm run test:coverage:ci` 是 coverage CI 的本地复现命令。它会按 `shared`、`server`、`client`、`cocos-client` 四个 scope 分开运行 `node:test`，并同时执行 line、branch、function 三类 floor 校验。

当前 policy 是：

- `shared`: lines `90%`, branches `70%`, functions `90%`
- `server`: lines `75%`, branches `65%`, functions `75%`
- `client`: lines `78%`, branches `65%`, functions `70%`
- `cocos-client`: lines `55%`, branches `70%`, functions `60%`

运行后会生成 `.coverage/summary.md` 和 `.coverage/summary.json`。如果任一 scope 的任一 metric 低于 floor，摘要顶部会明确列出失败的 scope 和具体阈值差距，方便直接对照 CI 失败原因。
- 战斗回放读模型当前已补上两块更适合前端直接消费的能力：`GET /api/player-accounts/:playerId/battle-replays` 现支持 `limit` + `offset` 分页，shared 侧也新增了可从 `initialState + steps` 推导每步回合与伤害/减员结算的 replay timeline helper，H5 战报面板会直接显示这些逐步结算摘要。
- Cocos Lobby 现已复用这套 timeline helper：账号资料回顾的“战报”卡片可直接点击进入战报时间线面板，会按行动阵营/单位、动作类型和主要结算概览显示最近 6 条步骤，并在没有战斗或回放缺失时回退提示。
- H5 账号资料卡现在会额外拉取 `/api/player-accounts/:playerId/progression` 覆盖成就/事件摘要，因此即使基础账号接口只返回轻量档案，前端也能稳定展示最新的成就推进、最近解锁和世界事件日志，而不会继续依赖旧的内嵌快照。
- H5 账号资料卡的成就/事件展示本轮也补了一层可读性整理：成就卡会把“已解锁”和“最近推进”的项目排到前面，并显示最近推进时间；世界事件日志则会把 `battle.started`、`first_battle` 这类内部 ID 转成中文标签，同时在摘要里补充各事件类别计数，方便后续继续接提示面板或筛选器。
- H5 左侧面板现已补上账号资料卡：会优先显示服务端账号昵称，也会在浏览器本地记住上次使用的游客昵称；远端房间首次 `connect` 时会把这份 `displayName` 一并带给服务端，用于初始化游客账号资料。`/api/player-accounts/me` 返回的 `globalResources` 也会直接显示成“全局仓库”摘要，方便确认跨房间继承的金币/木材/矿石。
- H5 现在也有真正的 Lobby / 登录入口：当页面没有携带 `roomId / playerId` 查询参数时，会先进入大厅页，显示游客 `playerId / 昵称 / roomId` 表单和 `/api/lobby/rooms` 活跃房间列表；选房或手动输入房间后即可进入实例，游戏内也能一键返回大厅。
- Lobby 进入房间前现在会先请求 `POST /api/auth/guest-login`，服务端会签发一个游客登录 token；浏览器会缓存这份游客会话，因此后续页面只带 `?roomId=...` 也能直接进入房间，不再必须把 `playerId` 写进 URL。
- 服务端还新增了 `GET /api/auth/session` 与 `GET /api/player-accounts/me`、`PUT /api/player-accounts/me`：前者用于校验和刷新当前游客会话，后者用于按当前登录态读取/修改自己的账号资料，不需要前端再手拼 `playerId`。
- 账号体系现已从“纯游客模式”升级为“双模式骨架”：`player_accounts` 新增 `loginId / passwordHash / credentialBoundAt`，服务端开放 `POST /api/auth/account-bind` 与 `POST /api/auth/account-login`，可把当前游客档绑定成口令账号，并在之后直接用登录 ID + 口令进入房间。
- 鉴权入口现已补上进程内安全闸门：`POST /api/auth/guest-login`、`/account-login`、`/account-bind` 都会按来源 IP 走滑动窗口限流，`account-login` 还会在连续失败达到阈值后临时锁定账号；默认值分别来自 `VEIL_RATE_LIMIT_AUTH_WINDOW_MS=60000`、`VEIL_RATE_LIMIT_AUTH_MAX=10`、`VEIL_AUTH_LOCKOUT_THRESHOLD=10`、`VEIL_AUTH_LOCKOUT_DURATION_MINUTES=15`，游客会话缓存还会受 `VEIL_MAX_GUEST_SESSIONS=10000` 的 LRU 上限约束。
- 正式账号会话现在补上了过期、设备列表与撤销链路：访问令牌默认 1 小时（`VEIL_AUTH_ACCESS_TTL_SECONDS`），刷新令牌默认 30 天（`VEIL_AUTH_REFRESH_TTL_SECONDS`），游客 token 默认 7 天（`VEIL_AUTH_GUEST_TTL_SECONDS`）；服务端新增 `POST /api/auth/refresh`、`POST /api/auth/logout`、`GET /api/player-accounts/me/sessions` 与 `DELETE /api/player-accounts/me/sessions/:sessionId`，正式账号可在 H5 资料卡查看当前设备列表、标记当前设备并撤销其他设备会话，账号口令修改仍会同步撤销现有会话。
- 服务端现已补上正式注册令牌投递适配层：`POST /api/auth/account-registration/request` 可为全新正式账号预留 `loginId` 并生成短时效注册令牌，`POST /api/auth/account-registration/confirm` 会创建新的 `player_accounts` 档案、绑定口令并立即签发首个账号会话；默认仍用 `VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE=dev-token` 直出联调令牌，也可切到 `webhook` 走外部投递且不再把 token 回给客户端，TTL 由 `VEIL_ACCOUNT_REGISTRATION_TTL_MINUTES` 控制。Webhook 投递现已补上有界重试 / dead-letter 机制，`request` 响应会附带 `deliveryStatus`，临时失败会返回 `202 + retry_scheduled` 而不是立即丢失投递。
- 服务端现已补上密码找回令牌投递适配层：`POST /api/auth/password-recovery/request` 会为已绑定口令账号生成短时效重置令牌，`POST /api/auth/password-recovery/confirm` 可用该令牌重置口令并撤销旧会话；默认通过 `VEIL_PASSWORD_RECOVERY_DELIVERY_MODE=dev-token` 直接回传开发态令牌，也可切到 `webhook` 走外部投递且不再把 token 回给客户端，TTL 由 `VEIL_PASSWORD_RECOVERY_TTL_MINUTES` 控制，且找回申请/确认都会写入账号 `recentEventLog` 的 `account` 审计事件。运行时新增 `GET /api/runtime/account-token-delivery` 与对应 Prometheus 指标，方便查看最近投递尝试、重试队列和 dead-letter。详细说明见 `docs/account-auth-lifecycle.md`。
- H5 Lobby 现已补上“账号口令登录”表单；游戏内账号资料卡也能直接绑定或更新口令账号，绑定成功后会立即把当前会话升级成账号模式，不需要重新手写 `playerId`，并会继续沿用同一份英雄长期档与全局资源仓库。
- H5 Lobby 现已补上开发态“正式注册 / 密码找回”入口：大厅页会直接展示 request / confirm 表单，可申请 dev token、确认注册或重置口令，并在成功后立即缓存正式账号会话进入目标房间。
- H5 Lobby 和游戏内都已补上“退出游客会话 / 切换游客账号”入口；当前 token 无效时会自动清掉本地会话并回到大厅。
- Cocos Web 启动入口现在会复用和 H5 共用的 `project-veil:auth-session`：如果浏览器里已有已签名会话，那么直接访问 `?roomId=...` 就能沿用当前游客或正式账号身份进房，HUD 会标出当前是云端游客、正式账号还是本地/手动参数启动。
- Cocos Web 现在也有真正的 Lobby 面板：没有 `roomId` 查询参数时会先进入大厅，可刷新 `/api/lobby/rooms` 活跃实例、点击字段卡片修改 `playerId / 昵称 / roomId / 登录 ID`、直接游客进入，或走“账号登录并进入”直连正式账号；Lobby 还会通过 `/api/player-accounts/me` / `GET /api/player-accounts/:playerId` 同步当前账号资料与全局仓库摘要。
- Cocos Lobby 现已追加“正式注册 / 密码找回”按钮：沿用当前 prompt 式输入链路完成 request / confirm 联调，开发态可直接复用响应里的 token 完成新账号注册或重置后登录，不再需要手拼 API 请求。
- Cocos Lobby 现在也提供“打开配置台”入口，会按当前联机目标自动跳到共享的 `config-center.html`，把配置联调从 H5 侧迁成主客户端可达链路。
- 服务端新增 `GET /api/lobby/rooms`，会实时返回当前进程内活跃房间的 `roomId / day / seed / connectedPlayers / heroCount / activeBattles / updatedAt` 摘要，便于大厅入口和后续房间浏览器直接复用。
- 这套账号目前仍是“轻量正式化”阶段：虽然已经有独立正式注册、口令绑定、前端注册 / 找回入口、设备会话列表 / 定向撤销和刷新令牌轮换，但更完整的第三方身份接入与更细的账号安全策略仍留给后续 issue 继续扩展。
- H5 会优先连接 `ws://127.0.0.1:2567` 的本地会话服务；若服务未启动，则自动回退到浏览器内嵌房间模式。
- 本地会话服务已支持房间内 `session.state` 推送同步，后续可在此基础上继续扩展多人联机。
- 多人原型已支持双英雄同房间联调，以及踩到敌方英雄格时触发玩家对玩家遭遇战。
- 当前美术接入方式为 `configs/assets.json` + `apps/client/public/assets/` 占位素材，逻辑对象已通过稳定资源 key 映射到前端表现层。
- `assets.json` 已支持多状态资源描述，当前单位和标记可按 `idle / selected / hit` 状态切换占位素材。
- 地形资源已支持稳定多变体切换，单位资源也已拆成 `portrait + frame` 槽位，后续可直接替换成正式美术素材而不改逻辑层 key。
- `assets.json` 现已强制声明 `metadata`：每个被引用的资源路径都要带 `slot / stage / source`，用于追踪“当前占位图对应哪个稳定槽位、是否已经转正、来源是什么”。
- `metadata.stage` 现已区分 `placeholder / prototype / production`，`metadata.source` 现已支持 `open-source`，便于把免费像素包的本地 staging 和仓库内预演资源分开审计。
- issue #33 的免费素材接入约定见 `docs/issue-33-asset-integration.md`；本地未提交的素材包统一放在 `external-assets/issue-33-open-source`，通过 `npm run check:issue33-assets -- --require-pack` 校验完整性。
- `npm run validate:assets` 现在除了校验 schema 和文件存在性，也会拦截缺失元数据、重复槽位和游离元数据；后续正式美术替换可直接沿用同一套 manifest 规则补齐审计信息。
- `units.json` 现已补上 `faction / rarity` 元数据，前端会自动挂载阵营与品质 badge，占位资源层已经具备继续细化正式 UI 的结构。
- `battle-skills.json` 现已承载战斗技能与持续状态目录，shared 战斗结算会在创建战斗和执行技能时直接读取运行时配置，不再依赖硬编码技能表。
- `battle-balance.json` 现已接入配置中心：支持可视化编辑伤害公式、遭遇战环境和 PVP ELO 参数，保存后会联动导出 JSON 并直接刷新 shared/runtime 读取链路；实时校验还会检查阈值范围以及陷阱状态是否与 `battle-skills.json` 对齐。
- `docs/release-evidence/content-pack-validation-report.example.json` 提供了一份 bundle-level 内容包校验样例，可直接对照 CI 产出的同结构 report 做 release review。
- 当前示例技能已包含 `投矛射击 / 护甲术 / 战意激发 / 破甲投枪 / 毒牙 / 裂伤嚎叫`，并补充了 `守誓姿态` 模板；守军自动回合也会根据技能目标和效果优先选择施法，而不是固定平砍。
- 英雄长期成长现已补上技能树：`hero.progressed` 在升级时会发放技能点，H5 英雄卡会直接显示分支、当前阶数和“学习 / 强化”按钮；已学技能会写入英雄长期档，并在下一场战斗里额外挂到英雄部队技能栏。
- 地图对象也已拆出独立视觉元数据配置，悬停地图时会通过统一对象卡片展示 `interactionType / faction / rarity` 等信息。
- 双开联调示例：
  - 大厅入口：`http://127.0.0.1:4173/`
  - 使用已缓存游客会话直进房间：`http://127.0.0.1:4173/?roomId=test-room`
  - `http://127.0.0.1:4173/?roomId=test-room&playerId=player-1`
  - `http://127.0.0.1:4173/?roomId=test-room&playerId=player-2`
