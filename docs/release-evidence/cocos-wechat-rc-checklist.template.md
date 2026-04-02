# Cocos / WeChat Release-Surface Checklist Template

将本模板复制到当前 RC 的 `artifacts/release-evidence/` 或 PR 描述中回填。它不是 JSON 快照的替代品，而是把目标发布面的放行 contract 固定下来，帮助 reviewer 快速确认“这次 RC 是否已经把该补的证据补齐”。

当目标面是 `wechat_preview` 或 `wechat_upload_candidate` 时，本清单必须和同一 revision 的 `codex.wechat.release-candidate-summary.json`、runtime observability sign-off、blocker register 一起使用。`H5` 或桌面调试面通过，不等于 WeChat 目标面通过。

## Candidate

- Candidate: `rc-YYYY-MM-DD`
- Surface: `creator_preview | wechat_preview | wechat_upload_candidate`
- Commit: `<git-sha>`
- Owner: `<name>`
- Recorded at: `<YYYY-MM-DDTHH:MM:SSZ>`
- Freshness window: `24h for manual/runtime evidence unless a stricter gate says otherwise`
- Device / Client:
- Server / Environment:
- Release summary:
  `artifacts/release-readiness/release-gate-summary-<short-sha>.json`
- WeChat candidate summary:
  `artifacts/wechat-release/codex.wechat.release-candidate-summary.json`

## Release-Surface Contract

- [ ] 当前 release decision 明确绑定 `Surface`，没有把 H5 / Creator 结果当成 WeChat 放行证据
  Evidence:
  Notes:
- [ ] 所有 required evidence 都绑定到同一 `Commit`，且时间戳仍在 freshness window 内
  Evidence:
  Notes:
- [ ] 若存在 blocker / waiver，已同步写入 blocker register、manual review metadata，并可从 release summary 直接追踪
  Evidence:
  Notes:

## Linked Evidence

- [ ] Release readiness snapshot 已生成：
  `artifacts/release-readiness/<candidate>.json`
- [ ] Release gate summary 已明确选择 `--target-surface wechat`，并显示 surface status 非 `blocked`：
  `artifacts/release-readiness/release-gate-summary-<short-sha>.json`
- [ ] Cocos RC snapshot 已生成并通过 `--check`：
  `artifacts/release-evidence/<candidate>.<surface>.json`
- [ ] 若为 WeChat RC，已附上 `codex.wechat.smoke-report.json`，且 `executedAt` 未过期
- [ ] 若为 WeChat RC，已附上 runtime observability sign-off：
  `artifacts/wechat-release/runtime-observability-signoff.json`
- [ ] 若为 WeChat RC，已附上 manual review JSON，并带 `owner` / `recordedAt` / `revision` / `artifactPath`
  `docs/release-evidence/wechat-release-manual-review.example.json`
- [ ] 若为上传候选包，已附上 `*.package.json` / `*.upload.json`

## Canonical Journey

- [ ] Lobby entry
  Evidence:
  Notes:
- [ ] Room join
  Evidence:
  Notes:
- [ ] Map explore
  Evidence:
  Notes:
- [ ] First battle
  Evidence:
  Notes:
- [ ] Reconnect / restore
  Evidence:
  Notes:
- [ ] Return to world
  Evidence:
  Notes:

## Required Evidence

- [ ] `roomId` 已记录，且截图/录屏中可见
  Value:
  Evidence:
- [ ] `reconnectPrompt` 已记录，且与 reconnect gate 口径一致
  Value:
  Evidence:
- [ ] `restoredState` 已记录，能证明恢复后未回档
  Value:
  Evidence:
- [ ] `firstBattleResult` 已记录，包含胜负与关键结算结果
  Value:
  Evidence:

## WeChat-Specific Checks

- [ ] 已用真实导出目录在微信开发者工具中完成导入与启动验证
  Evidence:
  Notes:
- [ ] 登录进入 Lobby 或游客降级结果已记录
- [ ] 进房成功并记录 `roomId`
- [ ] `reconnect-recovery` 已复用 `docs/reconnect-smoke-gate.md` 的 canonical scenario
- [ ] 分享回流已验证，或明确标记 `not_applicable`
- [ ] 关键资源加载无 404 / 白名单 / 缺图阻断
- [ ] 真机或微信开发者工具真机调试的 runtime smoke 已记录设备、客户端版本、执行时间
- [ ] Runtime observability sign-off 已附上同一 revision 的 `/api/runtime/health`、`/api/runtime/auth-readiness`、`/api/runtime/metrics` 证据
- [ ] 若 smoke / manual review / observability 任何一项 `pending`、`failed`、`blocked` 或 `stale`，release decision 仍为 hold

## Runtime Observability Sign-Off

- [ ] `/api/runtime/health` 已复核 activeRoomCount / connectionCount / gameplayTraffic / auth 摘要
  Evidence:
  Notes:
- [ ] `/api/runtime/auth-readiness` 已复核 auth 状态、阻塞项与目标环境一致
  Evidence:
  Notes:
- [ ] `/api/runtime/metrics` 已抓取关键指标样本并确认无未知缺口
  Evidence:
  Notes:
- [ ] 若附上 `/api/runtime/diagnostic-snapshot`，仅作为补充排障上下文，不替代 required endpoint review
  Evidence:
  Notes:
- [ ] 任何告警、缺口或接受风险都已写入 blocker register 或 sign-off artifact
  Evidence:
  Notes:

## Manual Review Metadata

- [ ] 每条 required manual review 都已记录 `owner`
- [ ] 每条 required manual review 都已记录 `recordedAt`
- [ ] 每条 required manual review 都已记录 `revision`
- [ ] 每条 required manual review 都已记录 `artifactPath`
- [ ] 若为带条件放行，已记录 `waiver.approvedBy` / `waiver.approvedAt` / `waiver.reason`
- [ ] checklist / blocker review 已记录 `blockerIds`

## Release Decision

- Decision: `ship | hold | ship-with-followups`
- Summary:
- Remaining blockers doc:
- Follow-ups / owners:
