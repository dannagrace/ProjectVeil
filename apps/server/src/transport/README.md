# `transport/`

HTTP 路由与 Colyseus room 入口。**薄层**——只做协议翻译（解析请求、调用 domain、序列化响应），不承载业务逻辑。

**允许 import**：`domain/` / `infra/` / `adapters/` / `@veil/shared`
**禁止 import**：—

规则由 `.dependency-cruiser.cjs` 强制；完整说明见 [`docs/architecture-boundaries.md`](../../../../docs/architecture-boundaries.md)。

当前为 #1558 Phase 1 创建的占位目录，实际文件将由后续 issue 逐步归位。
