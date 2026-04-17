# 架构分层边界

本仓库的代码分层由 `dependency-cruiser` 在 CI 中强制执行。规则来源于 [issue #1558](https://github.com/dannagrace/ProjectVeil/issues/1558)。

## 规则总览

| # | 规则 | 级别 | 说明 |
|---|------|------|------|
| 1 | `shared-no-node-natives` | error | `packages/shared/src/**` 不得 import Node 核心模块（`fs` / `http` / `crypto` / `path` 等）。shared 必须同时运行于 Node、浏览器、微信小游戏、Cocos runtime。 |
| 2 | `shared-no-apps` | error | `packages/shared/src/**` 不得依赖任何 app。App 依赖 shared，反向不允许。 |
| 3 | `cocos-no-server` | error | `apps/cocos-client/**` 不得 import `apps/server/**`。Cocos 客户端发给终端用户，不能带服务端代码。 |
| 4 | `server-infra-no-up` | error | `apps/server/src/infra/**` 是最底层，不得 import `domain/` / `transport/` / `adapters/`。infra 只被引用，不引用更高层。 |
| 5 | `server-domain-no-transport` | error | `apps/server/src/domain/**` 不得 import `apps/server/src/transport/**`。业务逻辑不应该知道协议。 |
| 6 | `server-adapters-no-transport` | error | `apps/server/src/adapters/**` 不得 import `apps/server/src/transport/**`。适配器面向外部系统，不回调协议层。 |
| 7 | `no-circular` | warn | 循环依赖降级为 warning，记录为技术债，不阻断 CI。 |
| 8 | `no-orphans` | info | 孤儿模块（没有任何文件 import）只做信息提示。 |

## 服务端 4 层目录

```
apps/server/src/
  transport/   # HTTP 路由、Colyseus room 入口（薄层，只做协议翻译）
  domain/      # 业务服务，按子域再分
  infra/       # mysql-pool、redis、schema-migrations、backup-storage
  adapters/    # wechat-pay、apple-iap、google-play、mobile-push、wechat-subscribe、wechat-social、wechat-session-key、account-token-delivery
```

依赖方向为单向：

```
transport ─▶ domain ─▶ infra
            └▶ adapters ─▶ infra
```

## 当前落地状态（Phase 1）

> 这是 [#1558](https://github.com/dannagrace/ProjectVeil/issues/1558) 第一阶段的落地：规则先全量生效，文件逐步归位。

已落地：
- `apps/server/src/adapters/`：8 个文件（所有第三方平台 adapter）
- `apps/server/src/infra/`：4 个文件（`mysql-pool`、`redis`、`schema-migrations`、`backup-storage`）
- `apps/server/src/transport/` / `domain/`：已创建占位目录，文件将由后续 issue 逐步归位

尚未归位的文件（约 46 个）暂留在 `apps/server/src/` 根目录，这些文件在目录维度上不归属于任何层，因此前述规则 4/5/6 对它们暂不生效。规则对已归位的文件立即生效。

## 运行方式

本地：
```bash
npm run lint:arch
```

CI：`arch-boundaries` job 在每次 push / PR 触发，error 阻断合并。

## 异常豁免流程

如果确实需要违反某条规则，处理顺序为：

1. **先重构**：90% 的违规可以通过抽取接口、移动文件、引入依赖注入解决。
2. **临时豁免**：在 `.dependency-cruiser.cjs` 对应规则的 `from` 或 `to` 段加 `pathNot`，并在注释里写明：
   - 对应的 tracking issue 编号
   - 为什么无法立即修复
   - 预计修复时间窗口
3. **永久豁免**：不存在。每一条豁免必须有 tracking issue 与关闭条件。

## 后续规划

见：
- #1559 切分 `persistence.ts`（9984 行）
- #1561 切分 `VeilRoot.ts`（6904 行）
- #1562 切分 `map.ts`（3423 行）
- #1563 切分 `config-center.ts` + `colyseus-room.ts`
- #1567 抽象 `PaymentGateway` 接口

这些 issue 落地后，`transport/` / `domain/` 目录会逐步填满，规则 4/5/6 的覆盖面会自动扩大。
