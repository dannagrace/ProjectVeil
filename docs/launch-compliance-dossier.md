# Launch Compliance Dossier

`configs/launch-compliance.json` 是上线合规材料的单一登记源。上线前请把真实凭证写入配置，并使用：

```bash
npm run release:launch-compliance:gate
```

来生成结构化 gate 报告。

## 必备材料

### 版号
- 版号编号
- 批次号 / 版本号
- 最近复核时间
- 有效期（如适用）

### ICP 备案
- ICP 备案号
- 备案主体
- 最近复核时间
- 有效期（如适用）

### 对外政策
- 隐私政策 URL + 版本号
- 用户协议 URL + 版本号
- 未成年人保护说明 URL + 版本号
- 数据出境公示 URL + 版本号
- 每项都需要最近复核时间；如政策有明确失效时间，也要登记有效期

### 实名认证接入凭证
- 供应方名称
- 测试环境凭证 / 合同编号
- 生产环境凭证 / 合同编号
- 最近复核时间
- 有效期

### 支付渠道准入凭证
- 微信支付商户号
- Apple App Store 账号
- Google Play 开发者账号
- 最近复核时间
- 有效期

## 维护建议

1. 每次 candidate rehearsal 前更新 `configs/launch-compliance.json`
2. 运行 `npm run release:launch-compliance:gate`
3. 对 `WARN` 项补齐 owner 和时间；对 `FAIL` 项先处理再提审
4. 在 `target-surface=wechat` 的 `release:gate:summary` 中检查合规 warning 是否被前置暴露
