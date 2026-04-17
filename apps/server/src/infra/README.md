# `infra/`

基础设施层——数据库连接池、Redis、schema 迁移、备份存储。**最底层**，只被引用、不引用更高层。

**允许 import**：`@veil/shared`、Node 原生、第三方库
**禁止 import**：`transport/` / `domain/` / `adapters/`

规则由 `.dependency-cruiser.cjs` 强制；完整说明见 [`docs/architecture-boundaries.md`](../../../../docs/architecture-boundaries.md)。
