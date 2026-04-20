# 多人同步治理回归矩阵

这份矩阵用于把“多人主链路还能跑”进一步收口成“最容易回归的同步治理场景仍然稳定”。它服务于两个目标：

- 固定一组长期维护的多人关键场景，避免时序类问题在后续迭代里悄悄回归。
- 让 release/readiness 产出结构化摘要，而不是只保留一个多人 smoke 通过位。

## 当前命令

```bash
npm test -- sync-governance:matrix
```

默认会运行固定的 Playwright 场景，并把 JSON artifact 写到：

- `artifacts/release-readiness/sync-governance-matrix-<short-sha>.json`

如果要和 release snapshot 使用同一个稳定文件名：

```bash
npm test -- sync-governance:matrix -- \
  --output artifacts/release-readiness/sync-governance-matrix.json
```

## 首批长期维护场景

| 场景 | 风险面 | 当前覆盖 |
| --- | --- | --- |
| 远端移动推送脱敏 | 其他客户端收到 push 后必须收敛到同一房间态，但不能泄露对方局部移动细节 | 自动化：`multiplayer-sync.spec.ts` |
| 建筑归属同步后，旁观客户端刷新恢复 | peer reload 后必须从权威快照恢复最近的 POI 归属，而不是回到旧状态 | 自动化：`multiplayer-sync.spec.ts` |
| PvP 战斗中断线重连 | 重连后不能丢失遭遇会话、当前回合归属或 battle panel 行为 | 自动化：`pvp-reconnect-recovery.spec.ts` |
| 战后结算后的移动锁纠偏 | 结算恢复后，失败方必须重新吃到 `0 move` 的权威限制，不能被本地预测放行 | 自动化：`pvp-postbattle-continue.spec.ts` |
| 竞争移动 / 同格抢占 | 多客户端竞争同一关键格时，最终胜负、拒绝原因和 UI 纠偏必须一致 | 待补强：后续矩阵扩到更显式的竞争用例 |
| 客户端预测回滚明细 | 预测路径与服务端拒绝/改写不一致时，需要保留更细的自动化摘要 | 待补强：先以战后移动锁纠偏覆盖最容易回归的 authority correction |

## Artifact 结构

矩阵 artifact 记录：

- git revision
- 实际执行命令
- 总通过 / 失败 / 跳过数
- 每个治理场景的 `id / category / risk / status / durationMs`

`npm run release -- readiness:snapshot` 已把这份矩阵作为必过自动化检查之一，因此 release/readiness 会明确暴露同步治理结果，而不再只显示多人 smoke。
