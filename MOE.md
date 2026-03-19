# ProjectVeil 专家点评与优化建议 (MOE)

本报告由游戏开发专家团队针对 `ProjectVeil` Phase 1 阶段的架构与核心实现进行深度评估。

## 1. 项目架构点评

### 1.1 架构一致性 (Architecture Consistency)
项目采用了 **Action -> Reduce -> State** 的单向数据流架构。通过 `packages/shared` 共享逻辑，确保了前后端计算的一致性，有效防止了多人游戏常见的“位置拉扯”和“逻辑分歧”问题。

### 1.2 状态驱动设计 (State-Driven Design)
`models.ts` 定义严谨，将世界状态（WorldState）与战斗状态（BattleState）解耦。这种设计为后续支持“异步战斗”、“大地图多线操作”提供了极佳的灵活性。

### 1.3 技术栈适配性
选用 **Colyseus** + **Cocos Creator** 针对微信小游戏和 H5 生态是极其务实的。Colyseus 的状态同步机制能完美承载此类回合制策略游戏的逻辑需求。

---

## 2. 核心优化建议

### 2.1 战争迷雾与数据安全 (Fog of War Security)
*   **问题分析**：当前 `TileState` 包含 `fog` 属性。若全量下发 `WorldState`，客户端内存中将包含全图信息，易被“透视挂”破解。
*   **建议**：
    *   **差异化同步**：服务端在下发 Snapshot 时，应根据当前玩家 ID 裁剪其视野外的 Tile 数据。
    *   **状态分离**：将迷雾状态从通用 Tile 中剥离，作为玩家私有数据维护。

### 2.2 战斗深度：反击机制 (Retaliation Mechanism)
*   **问题分析**：当前 `battle.ts` 仅实现了主动攻击和等待，缺少《英雄无敌》系列博弈核心——反击。
*   **建议**：
    *   在 `UnitStack` 模型中增加 `hasRetaliated: boolean`。
    *   在 `battle.attack` 逻辑中增加被攻击方的反击判定（每回合一次）。这将显著提升玩家在选择攻击顺序时的策略深度（如：先用低价值单位消耗对方反击机会）。

### 2.3 网络层性能优化 (Networking Optimization)
*   **问题分析**：`WorldMapState` 目前以对象数组形式存储，在大地图下 JSON 序列化开销较大。
*   **建议**：
    *   **TypedArray 压缩**：地形（Terrain）和迷雾（Fog）可改用 `Uint8Array` 存储，数据量可压缩 80% 以上。
    *   **区块化同步 (Chunking)**：若地图扩展至 64x64 以上，建议仅同步玩家英雄周边的九宫格区域。

### 2.4 逻辑健壮性：Action 校验层
*   **问题分析**：`applyBattleAction` 与 `applyWorldAction` 目前直接执行逻辑，缺乏合法性预检。
*   **建议**：
    *   引入 `validateAction(state, action): { valid: boolean, reason?: string }` 模式。
    *   在 Reduce 执行前强制校验：当前行动单位、目的地合法性、移动力剩余量等，防止非法数据包冲击逻辑层。

### 2.5 确定性随机数 (Deterministic RNG)
*   **问题分析**：战斗伤害目前基于 `Math.random()`（推测），这会导致前后端计算不一致。
*   **建议**：
    *   使用 `WorldMetaState.seed` 初始化一个伪随机数生成器（如 PCG 或 Mulberry32）。
    *   确保所有伤害浮动完全基于该序列，这样客户端仅需同步 Action 序列即可实现完美的动画复现。

---

## 3. 结论
`ProjectVeil` 的 Phase 1 基础非常扎实。若能优先落地 **Action 校验层** 与 **确定性随机数**，将极大提升项目的工业化水平和反作弊能力。
