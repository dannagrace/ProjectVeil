# `adapters/`

面向外部系统的适配器——微信支付 / Apple IAP / Google Play / 移动 push / 微信订阅消息 / 微信社交 / 账号 token 下发。

**允许 import**：`infra/` / `domain/` / `@veil/shared`
**禁止 import**：`transport/`（适配器不回调协议层）

规则由 `.dependency-cruiser.cjs` 强制；完整说明见 [`docs/architecture-boundaries.md`](../../../../docs/architecture-boundaries.md)。

#1567（`PaymentGateway` 抽象）落地后，支付类 adapter 会实现同一接口。
