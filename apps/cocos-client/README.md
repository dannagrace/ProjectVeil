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
- `assets/scripts/VeilHudPanel.ts`
  - 负责 HUD 文本面板渲染
  - 负责展示当前 `SessionUpdate + predictionStatus`
  - 会标出当前是游客还是正式账号身份
- `assets/scripts/VeilBattlePanel.ts`
  - 负责右侧战斗面板
  - 现已按 `战况摘要 / 待动序列 / 我方单位 / 敌方目标 / 指令操作` 分区渲染
  - 支持点击敌方目标并触发 `attack / wait / defend`
  - 回合归属、目标选择和按钮可用性已抽成纯逻辑模型并加测试锁住
- `assets/scripts/VeilMapBoard.ts`
  - 负责地图、英雄标记和 tile 点击交互
  - 会优先驱动同节点上的 `TiledMap` 做瓦片层增量更新；若未绑定 `TiledMap`，则回退到文字版 tile 地图
  - 现已支持地图事件反馈标记，例如 `MOVE / +WOOD / XP / PVE / VICTORY`
  - 现已支持基于配置的对象标签覆盖层，资源点/守军/敌方英雄会显示稳定的 `采集 / 战斗` + 对象名小标签
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
  - 支持在 Inspector 里分别配置 `idle / move / attack / hit / victory / defeat` 的 Spine 名称或 Clip 名称
  - 支持为 `attack / hit / victory / defeat` 配置单次播放后自动回到 `idle` 的时长
  - 没有资源时自动退化成文字态占位
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
9. 进入房间后点击地图格子，观察 HUD 中的英雄坐标、移动力和资源变化

## 下一步建议

- 把资源、美术占位图和对象卡片映射继续迁到 Cocos 资源系统
- 把 `VeilUnitAnimator` 接到正式 Spine skeleton 和序列帧资源
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
- 真正接微信 `code2Session / openid / unionid` 的生产登录链路
- OpenID 绑定、头像昵称同步
- 真机性能与内存优化

## 微信登录脚手架

本轮在运行时基础之上，继续补了一层“可合并但不虚假宣称生产完成”的登录脚手架：

- 新增 `assets/scripts/cocos-login-provider.ts`
  - 把 `guest / account-password / wechat-mini-game` 三类入口收口成统一 provider 抽象
  - 会按运行时能力、`wx.login()` 可用性和小游戏配置决定 Lobby 主登录按钮文案
- 新增 `loginCocosWechatAuthSession()`
  - 微信小游戏环境优先走 `wx.login()`
  - 如果当前调试壳没有原生 `wx.login()`，但配置了 mock code，则允许退化到 mock 交换
  - 交换成功后会把会话以 `provider = "wechat-mini-game"` 写入本地缓存，方便后续 UI / 调试识别
- 服务端新增 `POST /api/auth/wechat-mini-game-login`
  - 默认返回 `501`
  - 仅在 `VEIL_WECHAT_MINIGAME_LOGIN_MODE=mock` 时启用 mock 交换
  - 当前只是开发脚手架，不会触发真实微信 `code2Session`

当前支持的配置项：

- 客户端运行时覆盖：
  - `globalThis.__PROJECT_VEIL_RUNTIME_CONFIG__.wechatMiniGame.enabled`
  - `globalThis.__PROJECT_VEIL_RUNTIME_CONFIG__.wechatMiniGame.exchangePath`
  - `globalThis.__PROJECT_VEIL_RUNTIME_CONFIG__.wechatMiniGame.mockCode`
  - `globalThis.__PROJECT_VEIL_RUNTIME_CONFIG__.wechatMiniGame.appId`
- 服务端环境变量：
  - `VEIL_WECHAT_MINIGAME_LOGIN_MODE=mock`
  - `VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE=wechat-dev-code`

一个本地联调用例：

```bash
VEIL_WECHAT_MINIGAME_LOGIN_MODE=mock \
VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE=wechat-dev-code \
npm run dev:server
```

然后在小游戏预览壳里注入：

```ts
(globalThis as { __PROJECT_VEIL_RUNTIME_CONFIG__?: unknown }).__PROJECT_VEIL_RUNTIME_CONFIG__ = {
  wechatMiniGame: {
    enabled: true,
    mockCode: "wechat-dev-code"
  }
};
```

这样 Lobby 会优先展示“微信登录并进入”，但它仍然只是 mock / scaffold，不代表已经完成生产发布链路。
