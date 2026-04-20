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
| 7 | `server-root-entry-only` | error | `apps/server/src/*.ts` 根目录只允许保留 `index.ts`、`config-center.ts`、`persistence.ts` 这类 entry/barrel glue；其余服务端代码必须归位到 `transport/` / `domain/` / `infra/` / `adapters/`。 |
| 8 | `no-circular` | warn | 循环依赖降级为 warning，记录为技术债，不阻断 CI。 |
| 9 | `no-orphans` | info | 孤儿模块（没有任何文件 import）只做信息提示。 |

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

## 当前落地状态

> 这是 [#1558](https://github.com/dannagrace/ProjectVeil/issues/1558) 和 [#1608](https://github.com/dannagrace/ProjectVeil/issues/1608) 收口后的当前状态：服务端根目录已经压成 entry/barrel glue，分层规则对绝大多数服务端代码生效。

当前 `apps/server/src/*.ts` 仅保留 3 个根文件：
- `index.ts`
- `config-center.ts`
- `persistence.ts`

其余服务端实现已经归位到：
- `transport/`：HTTP 路由、Colyseus room 入口与协议辅助
- `domain/`：`account / economy / battle / social / ops / config-center / payment`
- `infra/`：`dev-server`、`memory-room-snapshot-store`、`mysql-persistence`、`schema-migrations`、`http-rate-limit`、`http-request-context`
- `adapters/`：第三方平台与推送/支付/社交集成

这意味着规则 `server-infra-no-up` / `server-domain-no-transport` / `server-adapters-no-transport` 已经覆盖到 >95% 的服务端源码；新增的 `server-root-entry-only` 则负责阻止新代码重新回流到 `apps/server/src/` 根目录。

仍保留 4 个精确豁免文件，它们本质上是组合根或基础设施包装层，而不是可复用的纯 infra 叶子模块：
- `apps/server/src/infra/dev-server.ts`
- `apps/server/src/infra/http-rate-limit.ts`
- `apps/server/src/infra/http-request-context.ts`
- `apps/server/src/infra/memory-room-snapshot-store.ts`

这些豁免是为了让 `lint:arch` 反映“绝大多数代码已被守卫覆盖”的真实状态，而不是为了放松整体边界。新增 infra 模块默认仍会命中 `server-infra-no-up`。

另外保留 1 个 domain→transport 例外：
- `apps/server/src/domain/ops/admin-console.ts`

它承担的是 GM/运营总控台聚合入口，需要拼接运行中房间和若干 transport-admin 子路由；这不是普通业务服务的依赖方向，因此单独记录为受控例外。

## 运行方式

本地：
```bash
npm run lint:arch
```

CI：`arch-boundaries` job 在每次 push / PR 触发，error 阻断合并。

## `project-shared` 镜像契约

`apps/cocos-client/assets/scripts/project-shared/**` 是 Cocos 运行时对 `packages/shared/src/**` 的受控镜像层。之所以存在这层镜像，是因为 Cocos 脚本不能直接跨出 `assets/` 目录引用 workspace 外部源码。

这层镜像有 3 条强约束：

1. `project-shared` 里的业务源码不能手改。变更应先落在 `packages/shared/src/**`，再通过：
   ```bash
   node ./scripts/sync-project-shared.mjs
   ```
   回写镜像。
2. 镜像范围不是“shared 根目录全量复制”，而是由 [scripts/project-shared-parity.mjs](/Users/grace/Documents/project/codex/ProjectVeil/scripts/project-shared-parity.mjs) 里的入口清单决定，并自动补齐这些入口在 `packages/shared/src/**` 内继续引用到的相对依赖。
3. CI 会在 `npm run lint:arch` 中执行：
   ```bash
   node ./scripts/check-project-shared-parity.mjs
   ```
   只要镜像缺文件、出现未登记的额外 `.ts` 文件，或内容与 manifest 生成结果不一致，就会直接阻断合并。

额外约定：
- `project-shared/map.ts` 是兼容层入口，实际指向 `project-shared/world/index.ts`，用来承接 `packages/shared/src/world/**` 这组模块的镜像。
- 如果 Cocos 需要新增 shared 能力，必须更新入口清单，让 mirror 重新计算闭包并让 parity check 跟着生效，不能只“顺手复制一个文件”。

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

这些 issue 落地后，剩余的重点会转向更细的域内拆分，而不是继续把文件从根目录搬家。
