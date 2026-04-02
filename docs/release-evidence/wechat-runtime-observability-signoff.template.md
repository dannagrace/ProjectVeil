# WeChat Runtime Observability Sign-Off Template

将本模板复制到当前 candidate 的 `artifacts/wechat-release/` 或 `artifacts/release-readiness/` 中回填。它用于证明同一候选 revision 在目标 release 环境里不仅能启动，而且仍然可观测、可排障。

建议文件名：`runtime-observability-signoff-<candidate>-<short-sha>.md`

## When Required

- WeChat `release candidate` / `shipping candidate` 必填。
- 进入 same-revision release evidence packet 时必填，和 readiness snapshot、WeChat smoke、RC checklist / blockers、manual evidence owner ledger 一起组成同一 candidate 的最小证据包。
- 若本次候选包涉及运行时观测口径、指标维度、告警阈值、诊断接口或 auth/runtime 健康路径，也应重新生成，而不要复用旧 candidate 的签核。

## Candidate

- Candidate: `rc-YYYY-MM-DD`
- Surface: `wechat_preview | wechat_upload_candidate`
- Target revision: `<git-sha>`
- Environment: `staging | production-like | production`
- Reviewer: `<name>`
- Reviewer role: `ops | oncall | release-owner`
- Recorded at: `<YYYY-MM-DDTHH:MM:SSZ>`
- Related RC checklist:
- Related blocker register:
- Related owner ledger:

## Linked Evidence

- [ ] `GET /api/runtime/health`
  Artifact / link:
  Captured at:
- [ ] `GET /api/runtime/diagnostic-snapshot`
  Artifact / link:
  Captured at:
- [ ] `GET /api/runtime/metrics`
  Artifact / link:
  Captured at:

## Review Questions

- [ ] 三个 endpoint 都对应同一 candidate revision 的目标环境，而不是本地 dev server 或旧 staging
  Notes:
- [ ] `/api/runtime/health` 已确认 `activeRoomCount`、`connectionCount`、`gameplayTraffic` 与 auth 摘要形状合理
  Evidence:
  Notes:
- [ ] `/api/runtime/diagnostic-snapshot` 已确认 room summary、diagnostics 状态与 log tail 没有明显陈旧或缺口
  Evidence:
  Notes:
- [ ] `/api/runtime/metrics` 已确认关键 runtime metrics 可抓取，且没有未知缺维、空白导出或权限失败
  Evidence:
  Notes:
- [ ] 若存在告警、缺口或接受风险，已同步写入 blocker register 或 owner ledger
  Evidence:
  Notes:

## Endpoint Summary

| Endpoint | Status | Reviewer summary | Evidence path / link |
| --- | --- | --- | --- |
| `/api/runtime/health` | `pass | hold | fail` |  |  |
| `/api/runtime/diagnostic-snapshot` | `pass | hold | fail` |  |  |
| `/api/runtime/metrics` | `pass | hold | fail` |  |  |

## Release Decision

- Conclusion: `passed | hold | ship-with-followups`
- Summary:
- Accepted risks:
- Follow-ups / owners:
- Blocker IDs:

## Ledger Mirror

将以下字段同步回填到 manual evidence owner ledger 对应行：

- `Evidence item`: `runtime-observability-signoff`
- `Owner`: `<reviewer>`
- `Status`: `<conclusion>`
- `Target revision`: `<git-sha>`
- `Recorded at`: `<recorded-at>`
- `Artifact path / link`: `<this-file>`
