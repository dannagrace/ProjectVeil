# Production Rollback Drill

`LAUNCH-P1` 之前，Project Veil 需要一份可以复用的“生产灰度 -> smoke -> 自动回滚”演练流程，而不是只停在 deploy/rollback 文字说明。

这份文档配套：

- `k8s/canary/`
- `npm run release:production:rollback-drill`
- `npm run release:gate:summary -- --target-surface wechat --stage production`

## 目标

- 让 canary 流量切换有一套 reviewable 的 Kubernetes 基线
- 把 smoke 失败时的 `kubectl rollout undo` 回滚动作变成可记录证据
- 让 `release:gate:summary` 在 `wechat + production` 组合下要求看到最近 30 天内的 rollback drill 证据

## 流程

1. 应用 `k8s/canary/` 清单
2. 把 canary 镜像 pin 到待发布 tag
3. 通过 `nginx.ingress.kubernetes.io/canary-weight` 切一小部分流量
4. 执行 smoke
5. smoke 失败后自动执行 `kubectl rollout undo`
6. 产出 JSON / Markdown 证据，并把它交给 `release:gate:summary`

## 推荐命令

先做一份本地模拟，确认命令参数与产物路径：

```bash
npm run release:production:rollback-drill -- --candidate "$(git rev-parse HEAD)"
```

真正演练时，使用真实 smoke 并显式切到执行模式：

```bash
npm run release:production:rollback-drill -- \
  --candidate "$(git rev-parse HEAD)" \
  --mode execute \
  --image-tag "ghcr.io/dannagrace/projectveil-server:$(git rev-parse --short HEAD)" \
  --smoke-command "curl -fsS https://game.projectveil.prod/api/runtime/health && curl -fsS https://game.projectveil.prod/api/runtime/auth-readiness"
```

如果要指定 namespace / canary ingress / manifests，可以追加：

```bash
--namespace project-veil \
--canary-manifest-dir k8s/canary \
--canary-ingress project-veil-server-canary \
--canary-weight 10
```

## 通过标准

一次有效的生产 rollback drill 需要同时满足：

- `mode = execute`
- smoke 实际失败
- rollback 实际执行
- rollback 成功恢复 canary
- 证据生成时间在最近 `30` 天内

只跑了模拟模式的产物可以用来预演命令和走查文档，但不会满足 production release gate。

## 证据

默认输出到：

- `artifacts/release-readiness/production-rollback-drill-<candidate>.json`
- `artifacts/release-readiness/production-rollback-drill-<candidate>.md`

JSON 里会记录：

- 候选 revision / image tag
- namespace / deployment / ingress / canary weight
- smoke 命令与结果
- rollback 是否触发、是否成功
- 完整命令日志

## SLO

这条演练的最低要求是：

- 每个待发生产候选至少有 `1` 份当前 revision 的 rollback drill 证据
- 证据需要在最近 `30` 天内
- 发现 smoke 失败到 rollback 完成的路径必须已经被真实走过

## 与 Release Gate 的关系

当运行：

```bash
npm run release:gate:summary -- --target-surface wechat --stage production
```

`release:gate:summary` 会把 production rollback drill 当成 required evidence。

缺失、过期、仅模拟、revision 不一致、或者 rollback 没真正恢复，都应阻塞 production promotion。
