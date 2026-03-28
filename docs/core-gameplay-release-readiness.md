# 核心玩法发布就绪检查清单

本清单用于回答一个更具体的问题：`Project Veil` 当前哪些“核心玩法面”必须达标，才适合进入更广范围测试或对外提审。它不是长期规划文档，而是一次发布 / 扩大 playtest 范围前的最小门禁。

适用范围：

- 权威房间与观测面：`apps/server`
- H5 调试 / 回归壳：`apps/client`
- Cocos Creator 主客户端：`apps/cocos-client`

相关命令与补充文档：

- 基础测试回归：`npm test`
- 类型检查：`npm run typecheck:ci`
- H5 / Lobby 冒烟：`npm run test:e2e:smoke`
- 多人同步冒烟：`npm run test:e2e:multiplayer:smoke`
- 微信小游戏构建校验：`npm run check:wechat-build`
- Cocos 发布证据模板：`docs/cocos-release-evidence-template.md`
- 微信小游戏提审前冒烟：`docs/wechat-minigame-release.md`

## 发布判断规则

- `P0 blocker`：未通过则不能进入外部 playtest，也不能视为发布就绪。
- `P1 follow-up`：可以进入受控范围测试，但必须有明确 owner 和修复窗口。
- `P2 polish`：不阻断测试扩大，但需要继续收口体验。

建议在每次 release candidate 上记录状态：`pass / partial / fail / n/a`，并附上证据链接、执行人和日期。

## 必过用户旅程

以下旅程是本仓库当前最值得做发布门禁的路径，缺一不可：

| 旅程 | 目标面 | 为什么必须门禁 |
| --- | --- | --- |
| Lobby / 登录进入房间 | Server + H5 + Cocos | 没有稳定进房，后续玩法全部失去意义 |
| 大地图探索 -> 拾取资源 -> 建筑交互 | Shared + Server + Cocos | 这是 Phase 1 的基础循环入口 |
| 遭遇战进入 -> 至少一场完整结算 -> 返回世界 | Shared + Server + Cocos | 战斗是核心价值，不允许只验证地图不验证战斗 |
| 断线 / 切后台 / 刷新后恢复 | Server + H5 + Cocos | 更广范围测试时最常见的真实失败面 |
| 运行时健康面 / 指标可读 | Server | 没有观测面就无法低成本排障和放量 |
| 微信小游戏构建 / 冒烟 / 提审资料 | Cocos release surface | 主客户端已收口到 Cocos，发布链路必须能重复执行 |

## 分面检查清单

### 1. 权威玩法与多人同步

`P0 blocker`

- [ ] `connect -> session.state` 能稳定建立房间，且玩家身份与房间 ID 一致。
- [ ] 英雄移动、资源拾取、建筑访问、战斗结算都由 shared/server 权威结果驱动，而不是前端本地写死。
- [ ] 至少覆盖一条“探索 -> 遭遇战 -> 战后回写世界状态”的完整回归链路。
- [ ] 双客户端或多客户端进入同一房间后，同步不会出现长期分叉；断线重连后能收敛到权威状态。
- [ ] 失败路径可读：非法 action、超时、会话失效时，客户端能收到明确错误而不是静默卡死。

`P1 follow-up`

- [ ] 高并发 / 多房间压测结果有最新记录，且波动没有超过团队可接受阈值。
- [ ] 房间快照、玩家房间档案、账号读模型在启用持久化时完成一次回归验证。

建议证据：

- `npm test`
- `npm run test:e2e:multiplayer:smoke`
- 必要时补跑：`npm run stress:rooms -- --rooms=<n>`

### 2. H5 调试壳与回归验证面

`P0 blocker`

- [ ] H5 Lobby 能游客进入房间，且缓存会话 / 账号登录 / 找回链路至少各通过一次。
- [ ] H5 壳可稳定复现大地图、资源点、建筑、战斗和结果弹窗，作为快速回归基线。
- [ ] 关键 E2E 用例与当前配置一致，没有依赖过期坐标、旧数值或旧文案。
- [ ] H5 回归壳在失败时能提供足够诊断信息，例如 trace、screenshot、事件文案或运行时摘要。

`P1 follow-up`

- [ ] 新增核心系统后，优先在 H5 壳补一个最小回归用例，而不是只依赖人工点测。
- [ ] 自动化键盘 / hook 路径持续可用，避免后续长链路回归重新退回手工验证。

建议证据：

- `npm run test:e2e:smoke`
- 必要时补跑：`npm run test:e2e`

### 3. Cocos 主客户端体验面

`P0 blocker`

- [ ] Lobby、进房、地图探索、遭遇战、战报/结果反馈、账号会话恢复能在 Cocos 主运行时串成完整链路。
- [ ] 关键 HUD / 面板文案足够可理解，玩家能知道当前房间、玩家身份、资源、移动力和战斗状态。
- [ ] 首场战斗中的反馈最少完整：选中态、受击 / 伤害反馈、胜败结果、返回世界。
- [ ] 发布目标若是微信小游戏，必须完成真实导出目录校验、发布包校验和真机 / 准真机 smoke 记录。

`P1 follow-up`

- [ ] Cocos 脚本层的展示配置、图集、动画 fallback 与资源清单在每次 release candidate 上重新核对一次。
- [ ] H5 与 Cocos 对同一 shared 规则的表现差异有记录，避免“规则一致但表现不一致”。

建议证据：

- `npm test`
- `npm run check:wechat-build`
- 按 [`docs/wechat-minigame-release.md`](/home/gpt/project/ProjectVeil/docs/wechat-minigame-release.md) 完成 `verify` 与 `smoke`

### 4. 观测、诊断与运维门禁

`P0 blocker`

- [ ] `/api/runtime/health`、`/api/runtime/auth-readiness`、`/api/runtime/metrics` 在候选包对应环境可访问。
- [ ] 至少能看到活跃房间数、连接数、世界 / 战斗 action 计数，以及鉴权会话摘要。
- [ ] 日志或接口输出足以区分登录失败、进房失败、同步失败和资源 / 配置失败。

`P1 follow-up`

- [ ] 扩大 playtest 前，明确谁负责看 health / metrics，多久看一次，异常后如何回滚或限流。
- [ ] 微信登录、注册令牌、找回令牌等投递链路在目标环境有一次演练记录。

建议证据：

- `npm test`
- 手动抓取：`GET /api/runtime/health`
- 手动抓取：`GET /api/runtime/auth-readiness`
- 手动抓取：`GET /api/runtime/metrics`

## 当前顶级发布风险

以下风险来自当前仓库中的现有文档、测试和脚本边界，可直接作为 wider playtest 的阻断项或优先 follow-up：

1. `Cocos 表现层仍有占位资源风险`
当前仓库已有 `cocos-presentation-readiness` 测试，且默认摘要仍体现“像素占位 / 音频混合 / 动画回退”。这说明主客户端玩法可跑，但表现层仍未完全达到可对外展示质量。

2. `主客户端是 Cocos，但自动化回归仍以 H5 为主`
H5 冒烟和多人 Playwright 已经比较成熟，但真实发布面是 `apps/cocos-client`，目前更依赖脚本级单测、微信构建校验和人工 / 真机 smoke。扩大测试前，必须把 Cocos 链路证据收集标准化。

3. `微信小游戏发布门禁仍需要人工执行`
仓库已经有 build / package / verify / smoke 流程，但真机或准真机验证、分享回流、关键资源加载仍需要人填报告。没有这份报告，不应把“构建通过”误当成“可提审”。

4. `多人同步与恢复是最容易在放量后暴露的问题`
仓库已经覆盖 reconnect / multiplayer smoke，但每次扩大测试范围前，仍要重新确认断线恢复和状态收敛，不要只看单机世界流转。

## 可直接拆出的后续事项

如果本清单中有项为 `partial` 或 `fail`，建议直接按下面方式拆 issue，避免下次再重新梳理：

- `Cocos 表现收口`
  - 正式像素资源替换占位资源
  - 首场战斗反馈统一到正式动画 / 音频方案
- `Cocos 主链路发布证据`
  - 固定一条 Lobby -> 进房 -> 战斗 -> 重连 -> 返回世界的验收脚本
  - 使用 `docs/cocos-release-evidence-template.md` 回填统一 evidence
- `多人放量门禁`
  - 固定压测参数
  - 记录可接受阈值和回退条件
- `微信提审门禁`
  - 固定 smoke 设备矩阵
  - 固定分享回流、资源白名单和登录回归证据

## 建议执行顺序

1. 先跑 `npm run typecheck:ci` 和 `npm test`，确认 shared/server/client 基线未坏。
2. 再跑 `npm run test:e2e:smoke` 与 `npm run test:e2e:multiplayer:smoke`，确认 H5 回归面和多人主链路。
3. 若候选包涉及微信小游戏，再跑 `npm run check:wechat-build`，并按微信发布文档回填真实 smoke 报告。
4. 用本清单逐项标记 `pass / partial / fail`，只要存在 `P0 blocker = fail`，该候选版本就不应进入更广范围测试。
