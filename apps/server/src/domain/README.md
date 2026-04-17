# `domain/`

业务服务层。承载游戏规则、账号生命周期、经济/成长/社交等子域逻辑。

**允许 import**：`infra/` / `adapters/` / `@veil/shared`
**禁止 import**：`transport/`（业务不应该知道协议）

规则由 `.dependency-cruiser.cjs` 强制；完整说明见 [`docs/architecture-boundaries.md`](../../../../docs/architecture-boundaries.md)。

当前为 #1558 Phase 1 创建的占位目录，实际文件将由后续 issue（如 #1559）逐步归位。
