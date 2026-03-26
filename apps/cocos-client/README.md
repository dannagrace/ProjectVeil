# Project Veil Cocos Creator Shell

这个目录是 Project Veil 的 Cocos Creator 3.x 前端壳子。

当前目标不是一次性把 H5 前端完全迁完，而是先把下面这条链路打通：

1. Cocos Creator 工程可被正常打开
2. 能连接现有 Colyseus / 权威房间服务
3. 能显示玩家快照
4. 能通过简单交互验证移动链路

## 当前内容

- `assets/scripts/VeilCocosSession.ts`
  - Cocos 侧会话桥接，直接连接现有 `veil` 房间
  - 支持首包快照、房间 push、断线后重连恢复
  - 支持把最近一次权威 `session.state` 缓存在本地，刷新或短时断线后先回放本地快照
- `assets/scripts/VeilRoot.ts`
  - 可直接挂到场景节点上的根组件
  - 现在主要负责会话连接、预测、重连恢复和战斗转场编排
  - HUD 和地图表现已经拆到独立组件，避免根节点继续膨胀
- `assets/scripts/VeilHudPanel.ts`
  - 负责 HUD 文本面板渲染
  - 只消费当前 `SessionUpdate + predictionStatus`
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
8. 点击地图格子，观察 HUD 中的英雄坐标、移动力和资源变化

## 下一步建议

- 把资源、美术占位图和对象卡片映射迁到 Cocos 资源系统
- 把 `VeilUnitAnimator` 接到正式 Spine skeleton 和序列帧资源
- 把 `VeilBattleTransition` 替换成正式 tween / 特效 / 音效组合
- 再逐步替换为正式微信小游戏构建流程
