# Project Veil Cocos Creator Primary Runtime

这个目录是 Project Veil 的 Cocos Creator 3.x 主客户端运行时。

当前目标已经从“先做壳子”切到“承接主体验运行时”，核心链路如下：

1. Cocos Creator 工程可被正常打开
2. 通过 Cocos Lobby 进入现有 Colyseus / 权威房间服务
3. 覆盖地图、战斗、账号会话恢复和返回大厅主流程
4. 直接从 Cocos 入口跳到共享配置中心完成联调

`apps/client` 现在只保留为 H5 调试 / 回归壳，不再承担主客户端职责。

## 当前内容

- `assets/scripts/VeilCocosSession.ts`
  - Cocos 侧会话桥接，直接连接现有 `veil` 房间
  - 支持首包快照、房间 push、断线后重连恢复
  - 支持把最近一次权威 `session.state` 缓存在本地，刷新或短时断线后先回放本地快照
- `assets/scripts/VeilRoot.ts`
  - 可直接挂到场景节点上的根组件
  - 现在负责 Lobby、账号会话恢复、房间连接、预测、重连恢复和战斗转场编排
  - HUD 和地图表现已经拆到独立组件，避免根节点继续膨胀
- `assets/scripts/VeilLobbyPanel.ts`
  - 负责 Cocos Lobby 主入口
  - 支持游客进入、账号登录并进入、全局仓库摘要展示，以及跳转共享配置台
  - 现在额外提供账号资料回顾入口，可在 Lobby 内分页查看最近战报摘要、事件历史和成就回顾；战报卡片支持点击展开“战报时间线”面板，直接复盘最近 6 条行动
- `assets/scripts/VeilHudPanel.ts`
  - 负责 HUD 文本面板渲染
  - 负责展示当前 `SessionUpdate + predictionStatus`
  - 会标出当前是游客还是正式账号身份
  - 当前会直接展示英雄装备位、背包分组清单，以及最近装备战利品记录，方便在主客户端内完成查看与验证闭环
- `assets/scripts/VeilBattlePanel.ts`
  - 负责右侧战斗面板
  - 现已按 `战况摘要 / 待动序列 / 我方单位 / 敌方目标 / 指令操作` 分区渲染
  - 已开始消费 `pixel/units/*`、`pixel/frames/*`、`pixel/badges/*`，在战斗队列 / 我方单位 / 目标选择里展示像素头像卡
  - 支持点击敌方目标并触发 `attack / wait / defend`
  - 回合归属、目标选择和按钮可用性已抽成纯逻辑模型并加测试锁住
- `assets/scripts/cocos-battle-unit-visuals.ts`
  - 战斗面板的单位视觉描述工具
  - 会把单位模板映射成 portrait state、faction badge、rarity badge 和 battle interaction badge
- `assets/scripts/VeilMapBoard.ts`
  - 负责地图、英雄标记和 tile 点击交互
  - 会优先驱动同节点上的 `TiledMap` 做瓦片层增量更新；若未绑定 `TiledMap`，则回退到文字版 tile 地图
  - 现已支持地图事件反馈标记，例如 `MOVE / +WOOD / XP / PVE / VICTORY`
  - 现已支持基于配置的对象标签覆盖层，资源点/守军/敌方英雄会显示稳定的 `采集 / 战斗` + 对象名小标签
  - 地图对象 marker 现已消费 `pixel/resources/*`、`pixel/buildings/*` 和 `pixel/badges/*`，会渲染主图标 + `faction / rarity / interaction` badge；没有专用图标的对象会回退到简短中文标签
  - 点击可达格可移动，点击英雄当前所在且带资源的格子可采集
- `assets/scripts/cocos-object-visuals.ts`
  - Cocos 侧对象视觉描述工具
  - 复用 `configs/object-visuals.json` 生成资源点、守军、敌方英雄的简短标签
- `assets/scripts/VeilTimelinePanel.ts`
  - 负责右侧时间线面板
  - 会统一展示系统消息和世界事件格式化结果
- `assets/scripts/cocos-ui-formatters.ts`
  - Cocos 面板层的事件/时间线格式化工具
  - 当前已用纯逻辑测试锁住时间线文案格式
- `assets/scripts/VeilTilemapRenderer.ts`
  - Cocos Tilemap 渲染适配层
  - 约定读取 `terrain / fog / fogEdge / objects / overlay` 五个图层
  - 会按 tile 签名增量更新 `gid`，避免整图重刷
  - 默认启用 `alphaFogOverlayEnabled`，会保留 Tilemap 作为主渲染路径，但把正式迷雾羽化交给 Overlay 层处理
  - `fogEdge` 可选；配置 `hiddenFogEdgeBaseGid / exploredFogEdgeBaseGid` 后会按正交邻接关系自动补迷雾边缘过渡
  - 如再配置 `hiddenFogPulseGid / exploredFogPulseGid` 与 `hiddenFogEdgePulseOffset / exploredFogEdgePulseOffset`，可得到低成本的动态迷雾脉冲效果
- `assets/scripts/VeilFogOverlay.ts`
  - Tilemap 与非 Tilemap 共用的独立迷雾覆盖层
  - 会根据 `hidden / explored / visible`、邻接 frontier 方向与迷雾相位，绘制羽化的 Alpha 混合覆盖
  - 在未挂正式 `TiledMap` 时仍可作为回退迷雾方案，避免文字网格模式下完全没有迷雾层次
- `assets/scripts/VeilMapBoard.ts`
  - 资源点/守军/敌方英雄的对象标签现已支持轻量回弹反馈
  - 当前会在拾取资源、接触守军或点击带对象的目标格时触发
- `assets/scripts/VeilUnitAnimator.ts`
  - 单位动画适配层
  - 有 Spine 资源时可走 `sp.Skeleton`
  - 有时间轴动画时可走 `Animation`
  - 没有正式动画资源时，现已优先退回到像素 portrait 帧，而不再只是 `[IDLE] / [ATTACK]` 文字
  - 当前会优先读取 `units/*`，其次 `showcaseUnits/*`，最后才退回到单帧 hero portrait
  - `hero_guard_basic / wolf_pack` 现已把多帧像素 portrait 序列正式登记到 `deliveryMode: sequence`，单帧 portrait / 文字态只作为兜底降级
  - 支持在 Inspector 里分别配置 `idle / move / attack / hit / victory / defeat` 的 Spine 名称或 Clip 名称
  - 支持为 `attack / hit / victory / defeat` 配置单次播放后自动回到 `idle` 的时长
  - 没有资源时自动退化成文字态占位
- `assets/scripts/cocos-presentation-config.ts`
  - 从 `configs/cocos-presentation.json` 读取动画 profile、音频资源路径 / 合成音效序列和加载预算
  - 当前已把 `hero_guard_basic / wolf_pack` 的回退动画前缀、交付模式和 `assetStage` 收口到配置层
  - 音频序列也会标出当前是 `placeholder` 还是 `production`，方便脚本校验和 Creator HUD 对齐
- `assets/scripts/cocos-presentation-readiness.ts`
  - 负责汇总像素图、资源音频和动画交付状态
  - 当前会统一输出 `表现 像素 ... · 音频 ... · 动画 ...` 这条摘要，供 Lobby 画册和 HUD 状态卡复用
  - 同时会把 `战斗流程 正式 4/4` 作为 battle journey 基线写入 readiness，明确 `进场 / 指令 / 受击 / 结算` 已在 copy/state 层正式化，剩余风险只继续记在资产层
  - 当像素资源和音频都达到发布要求后，会给出 `战斗流程与表现资源均已达到正式阶段`
  - 发布门禁可通过 `npm run check:cocos-release-readiness` 强制要求表现资源达到 release-ready，再串接微信小游戏构建校验
- `assets/scripts/cocos-audio-runtime.ts`
  - 轻量合成音频运行时
  - 现在会优先加载 `resources/audio/*` 下的 `AudioClip` 资源，再回退到波形合成
  - Creator / H5 预览环境下可直接验证 `explore / battle` BGM 和 `attack / skill / hit / level_up` cue 的资源音频链路
  - 资源缺失或加载失败时会安全回退到合成音频；没有 `AudioContext` 时也会保留状态机与 HUD 验证信息
- `assets/scripts/cocos-audio-resources.ts`
  - 把 `configs/cocos-presentation.json` 里声明的 `audio/*` 路径接到 Cocos `resources.load(AudioClip)` 和 `AudioSource`
  - 当前会分别维护 `ProjectVeilMusicAudio / ProjectVeilCueAudio` 两个音频节点，作为正式 BGM / SFX 的统一入口
- `assets/scripts/cocos-pixel-sprites.ts`
  - 统一加载 H5 / Cocos 共用的像素资源清单
  - 现在会按 `boot / battle` 两组做预载与按需补载，而不是一次把所有像素资源整包拉起
  - `pixel/badges/*` 已提前进 `boot` 组，因为地图对象 marker 和 HUD 空闲态也会消费这些 badge
  - 会记录最近一次像素资源加载耗时，并按 `configs/cocos-presentation.json` 的预算输出状态，方便后续 Creator / 真机验收对照
- `assets/scripts/cocos-showcase-gallery.ts`
  - Lobby 像素画册的轮播辅助层
  - 现在会按 `待机 -> 预备 -> 受击` 三个阶段切换展示帧，不再只是静态缩略图
  - 画册卡片现在也会直接显示 #33 的表现 readiness 摘要，而不是只展示缩略图
  - 现在额外带一条 `5` 格地形主题预览条，直接展示 `草原 / 山脉 / 水域 / 沙漠 / 雪原`
- `assets/scripts/VeilBattleTransition.ts`
  - 战斗转场控制器
  - 当前先用覆盖层文案占位，已经能挂接进入/退出战斗的切场时机
- `types/cc.d.ts`
  - 让仓库内的 TypeScript 检查能够识别 Cocos `cc` 模块

## 使用方式

1. 用 Cocos Creator 3.8.x 打开 `apps/cocos-client`
2. 新建一个空场景
3. 在根节点上挂载 `VeilRoot`
4. 如果要启用正式 Tilemap：
   - 在 `VeilRoot` 所在节点或其地图根节点上挂一个 `TiledMap`
   - 至少准备 `terrain / fog / objects / overlay` 四个 layer
   - 如果想启用迷雾边缘过渡，可额外加一个 `fogEdge` layer
   - 在 `VeilTilemapRenderer` Inspector 里把 terrain/fog/资源/高亮的 `gid` 映射到你的 tileset；如配置 `fogEdge`，可再设置 `hiddenFogEdgeBaseGid / exploredFogEdgeBaseGid`
   - 如需正式羽化迷雾，保持 `alphaFogOverlayEnabled = true`；如果想回退到纯 Tilemap 的硬边 fog/fogEdge layer，可手动关闭它
5. 在 Inspector 里配置：
   - `roomId`
   - `playerId`
   - `seed`
   - `remoteUrl`
   - 如需动态迷雾，可在 `VeilRoot` 上打开 `fogPulseEnabled` 并调整 `fogPulseIntervalSeconds`
   - 如未挂正式 `TiledMap`，`VeilMapBoard` 会自动走文字网格 + `VeilFogOverlay` 的回退渲染
   - 如已挂正式角色资源，可在 `VeilUnitAnimator` 上配置各状态动画名与回退时长
6. 启动后端：`npm run dev:server`
7. 在 Cocos 预览窗口运行场景
8. 没有 `roomId` 查询参数时，会先进入 Cocos Lobby；可在大厅里刷新房间、游客进入、账号登录并进入，或打开配置台
9. 如需查看账号进度回顾，可在 Lobby 左侧点击“资料回顾”，右侧会切换到 `战报 / 事件 / 成就` 三个分页标签；战报分页现在支持点击任意卡片打开“战报时间线”，会列出最新 6 条行动（含阵营、单位、动作与主要结算）并在暂无数据时给出提示
10. 进入房间后点击地图格子，观察 HUD 中的英雄坐标、移动力和资源变化
    - 会话状态卡现在会在关键恢复阶段显示明确提示：
      - `重连中`：客户端正在尝试恢复与权威房间的连接
      - `缓存快照回放`：HUD 当前展示的是本地缓存的最近一次会话快照
      - `等待权威重同步`：已经进入回放保护态，等待服务端权威快照接管
      - `降级/离线回退`：最近一次重连失败，客户端正依赖回退路径维持当前会话
11. 如需刷新当前资源占位音频，可先执行 `npm run sync:assets:audio`
12. 如需验证装备/背包/战利品闭环：
   - 先完成一场会掉落装备的战斗，确认 HUD 的“战利品”区块出现最近掉落记录
   - 查看 HUD “装备配置”卡中的“背包”分组清单，确认新掉落已进入当前英雄背包
   - 点击同一卡片下方的装备/卸下按钮，确认英雄关键属性、装备摘要与背包内容立即刷新
   - 如只跑自动化 smoke，可执行：`node --import tsx --test apps/cocos-client/test/cocos-primary-client-journey.test.ts`
   - 更完整的共享/服务端/Cocos 链路审计与验证步骤见 `docs/cocos-equipment-loot-validation.md`

## 回归入口

- Cocos 主客户端的会话恢复专项回归位于 `apps/cocos-client/test/cocos-root-orchestration.test.ts`
- 只跑这组快速回归可执行：`node --import tsx --test apps/cocos-client/test/cocos-root-orchestration.test.ts`
- 其中“本地快照回放 + 断线恢复后权威状态收敛”的专项用例是 `VeilRoot replays cached state before reconnect recovery converges on the authoritative snapshot`
- PvP 遭遇进入/恢复/结算的权威渲染约定见 `docs/cocos-pvp-encounter-lifecycle.md`

## 下一步建议

- 把资源、美术占位图和对象卡片映射继续迁到 Cocos 资源系统
- 把 `VeilUnitAnimator` 接到正式 Spine skeleton 和序列帧资源
- 用真实 BGM / SFX 或中间件替换当前 `resources/audio/*` 占位音频与合成回退
- 在 Creator / 微信开发者工具里跑真实加载耗时，对照 `configs/cocos-presentation.json` 的预算进一步压缩
- 把 `VeilBattleTransition` 替换成正式 tween / 特效 / 音效组合
- 继续压实微信小游戏构建和发布流程

## 微信小游戏基础适配

当前仓库已经先落下一层可合并的运行时基础，而不是一次把小游戏构建、微信登录和性能优化全部耦在一起：

- 新增 `assets/scripts/cocos-runtime-platform.ts`
  - 统一识别 `browser / wechat-game / unknown` 三类运行时
  - Web 继续读取 `location.search`
  - 微信小游戏改读 `wx.getLaunchOptionsSync().query`，再转换成与现有 `resolveCocosLaunchIdentity` 兼容的查询串
  - 对外暴露 `authFlow / configCenterAccess / supportsBrowserHistory`，给后续 `wx.login() -> code2Session` 接入留稳定边界
- `VeilRoot` 已改走运行时适配层
  - 不再默认假设浏览器 `history/location` 一定存在
  - 微信小游戏环境下不会尝试改写浏览器地址栏
  - 打开配置台会退化成手动提示，而不是直接依赖 `window.open`

这只是 issue #30 的基础切片，当前还没有完成：

- Cocos Creator 微信小游戏构建目标配置
- 真机性能与内存优化

## 微信登录脚手架

当前仓库的微信登录链路已经改成真实的服务端 `code2session` 交换，客户端侧仍保持最小 provider 封装：

- 新增 `assets/scripts/cocos-login-provider.ts`
  - 把 `guest / account-password / wechat-mini-game` 三类入口收口成统一 provider 抽象
  - 会按运行时能力、`wx.login()` 可用性和小游戏配置决定 Lobby 主登录按钮文案
- 新增 `loginCocosWechatAuthSession()`
  - 微信小游戏环境优先走 `wx.login()`
  - 如果当前调试壳没有原生 `wx.login()`，只有在 `NODE_ENV=test` 的服务端测试环境才允许退化到 mock code
  - 交换成功后会把会话以 `provider = "wechat-mini-game"` 写入本地缓存，方便后续 UI / 调试识别
- 服务端新增 `POST /api/auth/wechat-mini-game-login`
  - 别名仍然可用，实际实现与 `POST /api/auth/wechat-login` 相同
  - 服务端会用 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 调用微信 `code2session`
  - 同一个微信小游戏账号会稳定绑定到同一个 `playerId`
  - 服务端绝不会把微信 `session_key` 回传给客户端

当前支持的配置项：

- 客户端运行时覆盖：
  - `globalThis.__PROJECT_VEIL_RUNTIME_CONFIG__.wechatMiniGame.enabled`
  - `globalThis.__PROJECT_VEIL_RUNTIME_CONFIG__.wechatMiniGame.exchangePath`
  - `globalThis.__PROJECT_VEIL_RUNTIME_CONFIG__.wechatMiniGame.mockCode`
  - `globalThis.__PROJECT_VEIL_RUNTIME_CONFIG__.wechatMiniGame.appId`
- 服务端环境变量：
  - `WECHAT_APP_ID=<mini-game-appid>`
  - `WECHAT_APP_SECRET=<mini-game-secret>`
  - `VEIL_WECHAT_MINIGAME_CODE2SESSION_URL=https://api.weixin.qq.com/sns/jscode2session`
  - `VEIL_WECHAT_MINIGAME_LOGIN_MODE=mock` 仅用于 `NODE_ENV=test`
  - `VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE=wechat-dev-code` 仅用于 `NODE_ENV=test`

一个服务端联调用例：

```bash
WECHAT_APP_ID=wx-your-app-id \
WECHAT_APP_SECRET=wx-your-app-secret \
npm run dev:server
```

然后在小游戏预览壳里注入：

```ts
(globalThis as { __PROJECT_VEIL_RUNTIME_CONFIG__?: unknown }).__PROJECT_VEIL_RUNTIME_CONFIG__ = {
  wechatMiniGame: {
    enabled: true
  }
};
```
这样 Lobby 会优先展示“微信登录并进入”，并把 `wx.login()` 拿到的 code 交给服务端做正式交换。

## 微信小游戏构建脚手架

本仓库现在额外补了一层“可执行的构建准备与验收工具”，用来承接 issue #30 里构建配置、分包预算和域名清单这部分工作：

- 配置文件：`apps/cocos-client/wechat-minigame.build.json`
  - 统一记录小游戏项目名、`appid`、方向、主包预算、分包预算、运行时 `remoteUrl`、远程资源根路径和域名白名单
  - `domains.request / socket / downloadFile` 会按 origin 维度归一化，避免把路径误当成微信白名单
- 构建模板生成：
  - `npm run prepare:wechat-build`
  - 会生成 `apps/cocos-client/build-templates/wechatgame/`
  - 当前落地的模板文件：
    - `game.json`
    - `project.config.json`
    - `codex.wechat.build.json`
    - `README.codex.md`
- 导出结果校验：
  - `npm run validate:wechat-build -- --output-dir <wechatgame-build-dir> --expect-exported-runtime`
  - 会读取导出的 `game.json`
  - 会校验注入的 `game.json / project.config.json / codex.wechat.build.json / README.codex.md` 是否与仓库配置一致
  - 会校验导出目录里是否包含 `game.js / application.js / src/settings.json` 这些运行时 bootstrap 文件
  - 计算主包体积与 `subpackages` 总体积
  - 对照 `4MB / 30MB` 预算给出通过/失败结果
  - 会根据 `runtimeRemoteUrl` 自动推导小游戏需要的 `request / socket` 域名
  - 若远程资源 CDN 域名未出现在 `downloadFile` 白名单中，也会给出告警
- 运行时内存收口：
  - `assets/scripts/cocos-placeholder-sprites.ts`
    - 占位图资源现已按 `map / hud / battle / timeline` 分 scope retain/release
    - Map/HUD/Battle/Timeline 面板销毁时会显式释放不再使用的占位图资源，避免小游戏内长时间常驻整包贴图
    - 地图在无世界态时会释放 `map` scope；战斗 / 时间线面板在空闲态也会释放各自的装饰资源
  - `assets/scripts/cocos-runtime-memory.ts`
    - 会优先读取小游戏性能接口暴露的堆内存指标
    - 若运行时提供 `onMemoryWarning` / `triggerGC`，Root 会在收到内存告警后记录日志并请求一次 GC
    - HUD 状态卡会展示当前运行时内存与占位图 scope 健康摘要，方便在小游戏预览时快速观察压力变化

这层工具不会替代 Cocos Creator 里的正式构建操作，但它把“需要手工记住的微信小游戏发布约束”收口成了仓库里的可执行配置。下一步继续推进时，可以直接在 Creator 里把目标 Asset Bundle 标成 `Mini Game Subpackage`，再用这里的校验脚本收口。
