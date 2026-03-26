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

## 当前仓库落地内容

本仓库已经按 Phase 1 要求初始化为一个全栈 TypeScript monorepo：

- `packages/shared`
  - 共享世界状态、战斗状态、Action 协议。
  - 地图生成、玩家私有迷雾、A* 路径校验、移动路径规划、资源拾取纯函数。
  - 战斗回合排序、攻击/等待/防御、反击与确定性伤害结算纯函数。
- `configs`
  - `phase1-world.json` 管理地图尺寸、初始英雄、中立怪与资源刷率。
- `apps/server`
  - 权威房间状态骨架。
  - 玩家视角裁剪快照与 Action 校验。
  - 统一通过共享 reducer 处理客户端 Action，并在接触明雷时生成战斗快照。
  - 战斗结束后回写世界状态，胜利移除明雷并发放奖励，失败施加英雄惩罚。
  - MySQL 持久化现已包含房间快照、玩家房间档案、`player_accounts` 全局资源仓库初版，以及 `player_hero_archives` 英雄长期档初版。
- `apps/client`
  - 客户端渲染器骨架。
  - 当前以文本渲染示例验证“客户端只负责展示玩家可见状态”的边界。
- `apps/cocos-client`
  - Cocos Creator 3.x 前端壳子。
  - 当前已能连接现有 Colyseus 房间、显示玩家快照，并用点击屏幕验证英雄移动链路。
- `docs/phase1-design.md`
  - 更细的产品、技术与小程序部署方案。

## 建议的下一步

1. 将 `apps/client` 替换为 Cocos Creator 小游戏工程外壳。
2. 在 `apps/server` 接入 Colyseus 房间与消息协议。
3. 补 `configs/` 目录和 JSON 校验脚本，开始数值与地图配置生产。
4. 为共享模块添加单元测试，锁住移动和战斗结算行为。

## 本地运行

- 安装依赖：`npm install`
- 本地 WebSocket 服务：`npm run dev:server`
- 终端逻辑演示：`npm run demo:flow`
- 并发房间压测：`npm run stress:rooms -- --rooms=120 --connect-concurrency=24 --action-concurrency=24`
- 本地 H5 开发服务：`npm run dev:client`
- H5 构建验证：`npm run build:client`
- Cocos 壳子类型检查：`npm run typecheck:cocos`
- 并发房间压测会按 `world_progression / battle_settlement / reconnect` 三种场景分开跑数，并输出 CPU、内存、房间吞吐、动作吞吐等指标；可通过 `--scenarios=world_progression,reconnect` 等参数缩小范围
- 当前 H5 原型已支持：地图点击移动、可达格高亮、悬停路径预览、资源/明雷信息提示、轻量路径播放反馈、可视化战斗单位面板、目标选中、伤害飘字与战后结果弹窗。
- 当前 H5 联机体验已支持：客户端预测、断线自动重连、刷新后本地快照首帧回放，再由权威房间状态收敛。
- 当前已补上 Cocos Creator 工程壳子：
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
  - 当前支持编辑 `phase1-world.json / phase1-map-objects.json / units.json / battle-skills.json`
  - 未配置 MySQL 时走文件系统存储；配置 `VEIL_MYSQL_*` 后切换到 MySQL 主存储
  - 保存后会同时导出到 `configs/*.json`，并同步刷新服务端运行时配置，新建房间和战斗逻辑会直接读取新值
  - 当前编辑 `phase1-world.json` 时，右侧会即时生成一份地图样本预览；可切换预览 seed，对照查看地形、随机资源、保底资源、英雄与中立怪分布
  - 当前编辑 `battle-skills.json` 时，右侧会显示技能编辑器，可直接调整冷却、伤害倍率、目标类型、附加状态和状态持续参数，并同步回写 JSON 草稿
- H5 战斗面板现已补上“战术情报”区，会并排展示当前行动单位和已锁定目标的技能、状态、冷却与效果说明，便于直接核对配置是否符合预期。
- Cocos 战斗面板现已补上技能摘要和目标状态提示，概要区、目标卡与动作按钮都会带出当前技能/状态信息，而不再只有基础攻击指令。
- `phase1-map-objects.json` 现已支持配置 `buildings`，当前已接入 `recruitment_post` 招募所、`attribute_shrine` 属性神殿和 `resource_mine` 资源矿场；英雄停在建筑格上再次点击当前格即可访问或占领建筑。
- 招募所会按库存和资源消耗补充部队，并在每日推进后自动重置；属性神殿会给当前英雄永久属性加成，并记录已访问英雄避免重复领取；资源矿场则会在占领后于“推进一天”时自动结算金币/木材/矿石产出。H5 / Cocos / 配置中心地图预览都已能显示这些建筑。
- `neutralArmies` 现已支持可选 `behavior` 字段：可配置 `guard / patrol` 模式、巡逻路线和 `aggroRange`；中立怪会在每日推进时按路线巡逻、失位后回守，并在英雄靠近时主动追击，贴身时直接触发遭遇战。
- 当前 MySQL 资源持久化已补上 `player_accounts`：房间保存时会同步刷新玩家全局 `gold / wood / ore` 仓库，新建房间会先回灌这份全局资源，因此同一 `playerId` 的基础资源已能跨房间继承。
- 当前 MySQL 英雄长期档已补上 `player_hero_archives`：房间保存时会同步刷新英雄的长期成长与带兵快照，新建房间会先回灌这些长期数据，因此同一 `playerId` 的英雄属性成长和当前带兵已能跨房间继承；英雄的位置、剩余移动力和当前生命仍会按新局重置。
- 当前玩家账号骨架也已接到 `player_accounts`：账号记录现已包含 `displayName / lastRoomId / lastSeenAt / globalResources`，并开放 `GET /api/player-accounts`、`GET /api/player-accounts/:playerId`、`PUT /api/player-accounts/:playerId` 供开发态查看与改名；房间 `connect` 时会自动建档或刷新最近活跃房间。
- H5 左侧面板现已补上账号资料卡：会优先显示服务端账号昵称，也会在浏览器本地记住上次使用的游客昵称；远端房间首次 `connect` 时会把这份 `displayName` 一并带给服务端，用于初始化游客账号资料。
- H5 现在也有真正的 Lobby / 登录入口：当页面没有携带 `roomId / playerId` 查询参数时，会先进入大厅页，显示游客 `playerId / 昵称 / roomId` 表单和 `/api/lobby/rooms` 活跃房间列表；选房或手动输入房间后即可进入实例，游戏内也能一键返回大厅。
- Lobby 进入房间前现在会先请求 `POST /api/auth/guest-login`，服务端会签发一个游客登录 token；浏览器会缓存这份游客会话，因此后续页面只带 `?roomId=...` 也能直接进入房间，不再必须把 `playerId` 写进 URL。
- 服务端还新增了 `GET /api/auth/session` 与 `GET /api/player-accounts/me`、`PUT /api/player-accounts/me`：前者用于校验和刷新当前游客会话，后者用于按当前登录态读取/修改自己的账号资料，不需要前端再手拼 `playerId`。
- 账号体系现已从“纯游客模式”升级为“双模式骨架”：`player_accounts` 新增 `loginId / passwordHash / credentialBoundAt`，服务端开放 `POST /api/auth/account-bind` 与 `POST /api/auth/account-login`，可把当前游客档绑定成口令账号，并在之后直接用登录 ID + 口令进入房间。
- H5 Lobby 现已补上“账号口令登录”表单；游戏内账号资料卡也能直接绑定或更新口令账号，绑定成功后会立即把当前会话升级成账号模式，不需要重新手写 `playerId`。
- H5 Lobby 和游戏内都已补上“退出游客会话 / 切换游客账号”入口；当前 token 无效时会自动清掉本地会话并回到大厅。
- Cocos Web 启动入口现在也会复用这份游客会话：如果浏览器里已有已签名游客 token，那么直接访问 `?roomId=...` 就能沿用当前身份进房，HUD 会标出当前是云端会话、本地会话还是手动参数启动。
- Cocos Web 现在也有真正的 Lobby 面板：没有 `roomId` 查询参数时会先进入大厅，可刷新 `/api/lobby/rooms` 活跃实例、点击字段卡片修改 `playerId / 昵称 / roomId`、直接点房卡加入，并支持从游戏内一键返回大厅。
- 服务端新增 `GET /api/lobby/rooms`，会实时返回当前进程内活跃房间的 `roomId / day / seed / connectedPlayers / heroCount / activeBattles / updatedAt` 摘要，便于大厅入口和后续房间浏览器直接复用。
- 这套账号目前仍是“轻量正式化”阶段：虽然已经有口令绑定和账号登录，但还没有刷新令牌、多端撤销、正式注册流程或第三方身份接入。
- H5 会优先连接 `ws://127.0.0.1:2567` 的本地会话服务；若服务未启动，则自动回退到浏览器内嵌房间模式。
- 本地会话服务已支持房间内 `session.state` 推送同步，后续可在此基础上继续扩展多人联机。
- 多人原型已支持双英雄同房间联调，以及踩到敌方英雄格时触发玩家对玩家遭遇战。
- 当前美术接入方式为 `configs/assets.json` + `apps/client/public/assets/` 占位素材，逻辑对象已通过稳定资源 key 映射到前端表现层。
- `assets.json` 已支持多状态资源描述，当前单位和标记可按 `idle / selected / hit` 状态切换占位素材。
- 地形资源已支持稳定多变体切换，单位资源也已拆成 `portrait + frame` 槽位，后续可直接替换成正式美术素材而不改逻辑层 key。
- `units.json` 现已补上 `faction / rarity` 元数据，前端会自动挂载阵营与品质 badge，占位资源层已经具备继续细化正式 UI 的结构。
- `battle-skills.json` 现已承载战斗技能与持续状态目录，shared 战斗结算会在创建战斗和执行技能时直接读取运行时配置，不再依赖硬编码技能表。
- 当前示例技能已包含 `投矛射击 / 护甲术 / 战意激发 / 破甲投枪 / 毒牙 / 裂伤嚎叫`，并补充了 `守誓姿态` 模板；守军自动回合也会根据技能目标和效果优先选择施法，而不是固定平砍。
- 地图对象也已拆出独立视觉元数据配置，悬停地图时会通过统一对象卡片展示 `interactionType / faction / rarity` 等信息。
- 双开联调示例：
  - 大厅入口：`http://127.0.0.1:4173/`
  - 使用已缓存游客会话直进房间：`http://127.0.0.1:4173/?roomId=test-room`
  - `http://127.0.0.1:4173/?roomId=test-room&playerId=player-1`
  - `http://127.0.0.1:4173/?roomId=test-room&playerId=player-2`
