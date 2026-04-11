# Incident Response Runbook

本手册回答生产环境最关键的三个问题：

- 事故属于哪个级别，首次响应和升级时限是多少
- 第一响应者在 5 分钟内该先跑哪些命令
- 什么时候应该回滚，什么时候应该止血后热修

它补充 [`docs/operational-entry-point-repo-map.md`](./operational-entry-point-repo-map.md) 的入口索引，不替代更细分的支付、配置或数据库专用文档。

## Severity And SLA

| Level | Typical impact | First response SLA | Escalation SLA | Status update cadence | Exit condition |
| --- | --- | --- | --- | --- | --- |
| `P0` | 全服不可用、登录完全失败、支付或核心战斗链路全量不可用、无法安全恢复数据 | `<= 15 min` | `<= 5 min` 内拉起 incident commander、runtime owner、release owner | 每 15 分钟 | 服务恢复或已完成受控回滚，并确认无继续扩散 |
| `P1` | 关键链路显著异常但存在降级路径，例如支付回调失败、登录高失败率、MySQL 连接池耗尽、灰度放量导致大面积断线 | `<= 15 min` | `<= 15 min` 内补齐对应 owner | 每 30 分钟 | 风险被隔离，错误率回到阈值内 |
| `P2` | 部分功能降级、局部热点房间、单一地图/单一配置文档回退、可接受范围内的流量抖动 | `<= 60 min` | `<= 30 min` 内通知负责子系统 owner | 每 60 分钟 | 已恢复或已有明确后续修复排期 |

分级规则：

- 满足更高级别条件时，按更高级别处理，不允许“先当 P2 看看”
- 事故一旦涉及数据一致性、支付金额、错误补偿、或 failover/restore 决策，至少按 `P1`
- 正在放量或发版窗口内出现同类问题时，默认比平时上调一个优先级

## Roles And Escalation Path

| Role | Responsibility | Default trigger |
| --- | --- | --- |
| `primary on-call` | 接警、建群、执行 5 分钟快诊、决定是否宣告事故 | 所有告警与人工报障 |
| `incident commander` | 决策升级范围、状态同步、协调回滚或流量管控 | 所有 `P0`，以及 15 分钟内未稳定的 `P1` |
| `runtime owner` | 处理服务端宕机、房间热点、登录/会话、灰度配置异常 | Runtime / gameplay / feature flag 相关事故 |
| `database owner` | 处理连接池耗尽、复制延迟、恢复点选择 | MySQL 压力、复制、恢复相关事故 |
| `commerce owner` | 处理支付回调、重复扣款、补偿/退款冻结 | WeChat Pay 相关事故 |
| `release owner` | 暂停放量、冻结 candidate、决定 go/no-go | 发版窗口内的任何 `P0/P1` |

升级路径：

1. `primary on-call` 在接警后 5 分钟内完成快诊，并给出 `P0/P1/P2` 初判。
2. `P0` 立即拉 `incident commander + runtime owner + release owner`，并暂停继续发版、灰度或高风险补偿动作。
3. `P1` 按事故类型补齐 owner：
   - 服务端宕机 / 登录异常 / 大面积断线: `runtime owner`
   - MySQL 连接池 / 复制延迟 / 恢复点选择: `database owner`
   - WeChat Pay / 重复回调 / 欺诈信号: `commerce owner`
4. 任何 `P1` 在 15 分钟后仍无缓解趋势，升级到 `incident commander`。
5. 任何事故一旦需要回滚、failover、手工补偿、公告玩家，必须通知 `release owner`。

## On-Call Contact Template

将以下模板放到值班表、群公告、或事故频道固定消息中：

| Field | Template |
| --- | --- |
| Primary on-call | `<name> / <slack-wecom> / <phone>` |
| Secondary on-call | `<name> / <slack-wecom> / <phone>` |
| Incident commander | `<name> / <slack-wecom> / <phone>` |
| Runtime owner | `<name> / <slack-wecom> / <phone>` |
| Database owner | `<name> / <slack-wecom> / <phone>` |
| Commerce owner | `<name> / <slack-wecom> / <phone>` |
| Release owner | `<name> / <slack-wecom> / <phone>` |
| Status page / war room link | `<url>` |

交接最少字段：

- 当前事故级别
- 最新状态更新时间
- 已执行命令与结果
- 下一步动作与 owner
- 是否已冻结发版 / 灰度 / 补偿

## Five-Minute Triage

先设定目标环境：

```bash
export VEIL_RUNTIME_URL="${VEIL_RUNTIME_URL:-http://127.0.0.1:2567}"
export VEIL_MYSQL_EXPORTER_METRICS_URL="${VEIL_MYSQL_EXPORTER_METRICS_URL:-http://127.0.0.1:9104/metrics}"
export VEIL_MYSQL_REPLICA_HOST="${VEIL_MYSQL_REPLICA_HOST:-127.0.0.1}"
export VEIL_MYSQL_REPLICA_PORT="${VEIL_MYSQL_REPLICA_PORT:-3306}"
export VEIL_MYSQL_REPLICA_USER="${VEIL_MYSQL_REPLICA_USER:-root}"
export VEIL_MYSQL_REPLICA_PASSWORD="${VEIL_MYSQL_REPLICA_PASSWORD:-change_me}"
```

5 分钟快诊命令集：

```bash
date -u
curl -fsS "$VEIL_RUNTIME_URL/metrics" > /tmp/project-veil.metrics
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/auth-readiness" | jq .
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/diagnostic-snapshot" | jq '.diagnostics.errorSummary'
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/slo-summary?format=text"
grep -E '^(veil_connected_players|veil_active_rooms(_total)?|veil_http_request_duration_seconds|veil_action_validation_failures_total|veil_feature_flag_config_stale|veil_mysql_pool_|veil_runtime_error_events_total) ' /tmp/project-veil.metrics
```

5 分钟内必须回答：

1. 是单节点/单 shard，还是全环境广泛故障。
2. 是刚刚变更后出现，还是已有一段时间累积放大。
3. 是否影响登录、支付、核心战斗、或数据一致性。
4. 是否需要立刻停止发版、灰度、补偿、或 failover。
5. 是回滚更安全，还是可以在不扩大影响的前提下热修。

如果 `metrics`、`health`、`auth-readiness` 任一无法访问，先按“服务端宕机”处理，不要先深挖次级告警。

## Rollback Decision Tree

按下面顺序做决定：

1. 问题是否由最近 30 分钟内的 deploy、config publish、feature flag 放量触发。
2. 回滚是否能在 15 分钟内恢复到已知安全状态，且不会引入更大的数据偏差。
3. 当前是否已经出现支付、持久化、或复制延迟，导致“继续写入”风险高于“回滚风险”。
4. 热修是否只改局部且无需继续放量验证。

选择规则：

- 优先回滚：
  - 发布后立刻出现全服不可用、登录雪崩、广泛断线、支付回调异常
  - `VeilFeatureFlag*` 告警与大面积会话失败同时出现
  - MySQL 池耗尽或复制延迟导致写入安全性无法确认
- 优先热修：
  - 影响范围稳定在单节点、单房间、单配置文档
  - 已经通过摘流、暂停灰度、冻结补偿把扩散面压住
  - 热修无需修改数据库结构、支付资金流、或核心协议
- 禁止盲目回滚：
  - 已经发生不可逆数据迁移且没有验证过回滚路径
  - 复制延迟过高，无法确认一致恢复点
  - 支付订单状态已部分落库但补偿/退款路径未冻结

## Scenario Playbooks

### Runtime Unavailable

适用信号：

- `/api/runtime/health` 无响应
- 多个运行时告警同时触发
- 玩家报告无法登录或所有房间断开

处置步骤：

1. 先确认是进程不可达、依赖不可达、还是负载导致探活超时。
2. 冻结当前 deploy、灰度和高频诊断脚本。
3. 抓取 `health`、`auth-readiness`、`metrics` 的失败现象并记录时间点。
4. 若最近有 deploy 或 config publish，优先回滚到最近已知安全版本或快照。
5. 若无明确变更，先摘除故障节点或拉起替代容量，再继续排查。

推荐命令：

```bash
curl -v "$VEIL_RUNTIME_URL/api/runtime/health"
curl -v "$VEIL_RUNTIME_URL/api/runtime/auth-readiness"
curl -fsS "$VEIL_RUNTIME_URL/metrics" | head -n 40
```

升级条件：

- 任何全服不可用默认 `P0`
- 15 分钟内无法恢复探活，升级到 `incident commander`

### Database Pool Exhaustion

适用信号：

- `VeilMySqlPoolPressureHigh`
- HTTP 延迟上升，伴随持久化或配置写入堆积

处置步骤：

1. 先看 `queue_depth` 是否大于 `0`，确认调用方已经在等待。
2. 区分 `room_snapshot` 和 `config_center`，不要把配置写入问题当成全局数据库故障。
3. 如果复制延迟也在恶化，暂停 failover、恢复演练和高风险批量写入。
4. 若 MySQL 本身健康但池长期逼近上限，谨慎提高 `VEIL_MYSQL_POOL_CONNECTION_LIMIT`，并同步记录变更。
5. 若是最近发版后开始恶化，优先回滚相关版本，而不是只扩池掩盖问题。

推荐命令：

```bash
grep '^veil_mysql_pool_' /tmp/project-veil.metrics | sort
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/health" | jq '{activeRoomCount: .runtime.activeRoomCount, connectionCount: .runtime.connectionCount, activeBattleCount: .runtime.activeBattleCount}'
curl -fsS "$VEIL_MYSQL_EXPORTER_METRICS_URL" | grep '^mysql_slave_status_seconds_behind_master'
```

升级条件：

- 连接池等待持续 10 分钟以上按 `P1`
- 如果已影响支付、登录或回滚安全性，提升为 `P0`

### Config Push Or Feature Flag Rollout Causing Disconnects

适用信号：

- `VeilFeatureFlagConfigStale`
- `VeilFeatureFlagBattlePassSessionFailuresHigh`
- `VeilFeatureFlagBattlePassErrorRateHigh`
- `VeilFeatureFlagBattlePassPaymentFailuresHigh`
- 玩家在放量或 config publish 后出现大面积断线/失败

处置步骤：

1. 立即暂停继续放量，不要一边排查一边扩大暴露面。
2. 对比 `/api/runtime/feature-flags` 或诊断摘要中的 checksum，确认是否有节点拿到过期配置。
3. 如果知道故障来源于某次 publish，使用 `npm run config-center:restore -- --document <id> --publish-id <publish-id>` 回退对应文档。
4. 如果故障来源于灰度比例，先回退到上一个安全 rollout 比例或直接置零。
5. 如果已经出现广泛断线，按 `P0/P1` 同步 `runtime owner + release owner`，并补跑 [`docs/reconnect-smoke-gate.md`](./reconnect-smoke-gate.md)。

推荐命令：

```bash
grep '^veil_feature_flag_' /tmp/project-veil.metrics
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/diagnostic-snapshot" | jq '.runtime.featureFlags'
npm run config-center:restore -- --help
```

升级条件：

- 配置不一致但尚未影响玩家，按 `P1`
- 已造成大面积会话失败、支付失败或断线，按 `P0`

### WeChat Payment Callback Failure

适用信号：

- `VeilWechatPaymentFraudSignalsHigh`
- 支付成功但未到账、重复扣款、回调重放怀疑
- 灰度期间 battle pass 支付错误率升高

处置步骤：

1. 先冻结高风险补偿、退款和继续放量，避免把对账面扩大。
2. 确认是 `payment_fraud_signal`、重复 `out_trade_no`、签名异常，还是候选版本逻辑回归。
3. 单玩家异常先隔离玩家；候选版本级异常立即暂停该版本。
4. 涉及资金、错发、或重复扣款时，必须拉 `commerce owner`。
5. 详细支付补偿、退款和反欺诈操作继续遵循 [`docs/wechat-pay-ops-runbook.md`](./wechat-pay-ops-runbook.md)。

推荐命令：

```bash
grep 'payment_fraud_signal' /tmp/project-veil.metrics
curl -fsS "$VEIL_RUNTIME_URL/api/runtime/diagnostic-snapshot" | jq '.diagnostics.errorSummary'
```

升级条件：

- 单玩家风控信号且可隔离，按 `P1`
- 候选版本级支付异常、重复扣款或大面积未到账，按 `P0`

## Alert Routing Index

### Alert-VeilConnectedPlayersHigh

先执行 [Five-Minute Triage](#five-minute-triage)，再检查热点房间与容量。若伴随 HTTP 延迟或房间密度恶化，按 [Runtime Unavailable](#runtime-unavailable) 处理；否则按 `P2/P1` 进行扩容或摘除测试流量。

### Alert-VeilActiveRoomsHigh

先确认 `veil_active_rooms_total` 是否和 `activeRoomCount`、房间摘要、以及最近 `room.disposed` 事件一致。若连接数不高但房间数持续上升，优先按僵尸房间或房间退役失败处理；若确实在跑大规模压测，则保留告警并监控是否继续自行回落。

### Alert-VeilRoomsHot

先检查是否是局部热点房间。若只影响单 shard，优先摘流和重建房间；若多房间同时恶化并伴随断线或 battle 卡住，升级到 [Runtime Unavailable](#runtime-unavailable)。

### Alert-VeilBattleDurationP95High

优先判断是热点房间、战斗循环卡死、还是版本回归。若为发版后广泛回归，套用 [Rollback Decision Tree](#rollback-decision-tree) 并通知 `runtime owner`。

### Alert-VeilActionValidationFailuresHigh

把它视为协议漂移或 gameplay desync 的强信号。先暂停可疑 rollout；若同一窗口内也有 feature flag 或会话失败，直接跳到 [Config Push Or Feature Flag Rollout Causing Disconnects](#config-push-or-feature-flag-rollout-causing-disconnects)。

### Alert-VeilHttpRequestLatencyP95High

结合 `auth-readiness` 和连接数判断是否为服务整体饱和。若探活和诊断接口同时退化，走 [Runtime Unavailable](#runtime-unavailable)；若主要由 MySQL 背压带来，走 [Database Pool Exhaustion](#database-pool-exhaustion)。

### Alert-VeilMySqlPoolPressureHigh

直接使用 [Database Pool Exhaustion](#database-pool-exhaustion)。如果复制延迟同时升高，不要做 failover 或恢复点切换。

### Alert-VeilMySqlReplicationLagHigh

先确认 exporter 不是误报，再暂停 failover、恢复演练和备份提升。若 lag 持续扩大或线程停摆，至少按 `P1` 拉起 `database owner`，并参考 [`docs/db-restore-runbook.md`](./db-restore-runbook.md) 做恢复点选择。

### Alert-VeilWechatPaymentFraudSignalsHigh

直接使用 [WeChat Payment Callback Failure](#wechat-payment-callback-failure)，并继续打开 [`docs/wechat-pay-ops-runbook.md`](./wechat-pay-ops-runbook.md) 完成支付专属核查。

### Alert-VeilFeatureFlagConfigStale

直接使用 [Config Push Or Feature Flag Rollout Causing Disconnects](#config-push-or-feature-flag-rollout-causing-disconnects)。如果只是单节点 stale 但玩家未受影响，先阻止继续放量，不要立刻扩大操作面。

### Alert-VeilFeatureFlagBattlePassSessionFailuresHigh

这是灰度导致会话层面失败的明确信号。立即停止放量，必要时把 battle pass rollout 比例降回 `0`，然后按 [Config Push Or Feature Flag Rollout Causing Disconnects](#config-push-or-feature-flag-rollout-causing-disconnects) 执行。

### Alert-VeilFeatureFlagBattlePassErrorRateHigh

把它当作 gameplay 回归或配置不兼容。先冻结 rollout，再判断是版本回滚更快还是仅需单文档回退。

### Alert-VeilFeatureFlagBattlePassPaymentFailuresHigh

同时涉及灰度和支付，默认至少 `P1`。先停 rollout，再按 [WeChat Payment Callback Failure](#wechat-payment-callback-failure) 与 [Config Push Or Feature Flag Rollout Causing Disconnects](#config-push-or-feature-flag-rollout-causing-disconnects) 双线处理。

## Post-Mortem Template

事故关闭后 24 小时内至少补齐下面内容：

```md
# Post-Mortem: <incident title>

- Incident level: P0 | P1 | P2
- Incident commander: <name>
- Date: <YYYY-MM-DD>
- Start time: <ISO-8601>
- End time: <ISO-8601>
- Detection: <alert name / user report / release gate>
- Impact summary: <who was affected and how>
- Player impact window: <duration>
- Affected systems: <runtime / mysql / config / payment / release>
- Release context: <candidate / branch / deploy / config publish id>

## Timeline

| Time | Event | Owner |
| --- | --- | --- |
| 00:00 | Alert fired | monitoring |
| 00:05 | Incident declared P1 | primary on-call |

## Root Cause

- Technical root cause:
- Trigger:
- Why existing guardrails did not stop it:

## Mitigation

- What stopped the impact:
- Why rollback or hotfix was chosen:
- Residual risk after restore:

## Corrective Actions

| Action | Owner | Due date | Tracking issue |
| --- | --- | --- | --- |
| Add guardrail | <owner> | <date> | #1234 |

## Evidence

- Metrics / logs:
- Commands run:
- Artifacts / PR / dashboard links:
```

演练要求：

- 新流程首次启用后一周内，至少用一次值班演练或桌面推演回填上面的模板
- 演练也要记录时间线和改进项，不允许只写“流程通过”

## Closeout Checklist

- 记录事故级别、触发时间、恢复时间、影响范围
- 记录是否执行了回滚、配置回退、补偿冻结、或 failover 冻结
- 链接相关 PR、issue、artifact、dashboard、war room
- 为后续修复或演练创建跟踪 issue，再关闭事故
