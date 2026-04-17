# Experiment Authoring Guide

`configs/feature-flags.json` 现在支持把 feature flag 和 A/B experiment 放在同一份配置里维护。  
这份说明聚焦 3 件事：实验怎么写、怎么验证、怎么回看结果。

## Config Shape

每个 experiment 现在支持这些核心字段：

```json
{
  "experiments": {
    "shop_headline_2026_05": {
      "name": "Shop Headline May 2026",
      "owner": "monetization",
      "enabled": true,
      "startAt": "2026-05-01T00:00:00.000Z",
      "endAt": "2026-05-31T23:59:59.999Z",
      "trafficAllocation": 100,
      "stickyBucketKey": "player_id",
      "fallbackVariant": "control",
      "variants": [
        { "key": "control", "allocation": 50 },
        { "key": "value", "allocation": 50 }
      ],
      "whitelist": {
        "pm-demo-player": "value"
      }
    }
  }
}
```

说明：

- `trafficAllocation`：实验总流量上限，单位是 `0-100`。
- `stickyBucketKey`：稳定分桶依据。当前支持 `player_id`、`login_id`、`wechat_open_id`。
- `variants[].allocation`：variant 在实验流量中的占比。
- `fallbackVariant`：未命中实验或实验关闭时的兜底 variant。
- `whitelist`：QA / PM 强制指定 variant。

## Stable Assignment

- 同一个 `stickyBucketKey + experimentKey` 会稳定命中同一 bucket。
- 默认推荐用 `player_id`，除非业务明确要求跨账号或跨设备黏住同一组。
- 如果只是改文案、布局、奖励展示，优先保持 `player_id`。

## Metrics Rollup

运营回看可以直接跑：

```bash
npm run experiment:metrics-rollup -- --input ./artifacts/analytics/experiment-events.json
```

常用参数：

- `--input <file>`：analytics event envelope 或纯 event 数组 JSON
- `--output-dir <dir>`：输出 JSON / CSV / Markdown 的目录
- `--experiment <key>`：只导出某一个实验

脚本会产出：

- `experiment-metrics-rollup.json`
- `experiment-metrics-rollup.csv`
- `experiment-metrics-rollup.md`

当前默认回看指标：

- exposure
- conversion
- conversion rate
- purchasers
- revenue
- ARPU
- chi-square
- Welch t

其中：

- conversion uplift 用 `chi-square` 做 first-pass significance
- revenue / ARPU 用 `Welch t` 做 first-pass significance

## Admin Review

Admin console 现在提供：

- `GET /api/admin/experiments`

它会把当前 config 里的实验定义和实时 analytics 摘要拼起来，适合运营或 PM 快速看：

- 当前有哪些活跃实验
- variant 配比是多少
- 近一段时间曝光 / 收入情况
- 哪个 variant 已经出现显著差异

## Recommended Workflow

1. 先在 `configs/feature-flags.json` 写 experiment 定义。
2. 用 `whitelist` 验证 treatment 文案或入口。
3. 再把 `trafficAllocation` 放到真实目标比例。
4. 跑 `experiment:metrics-rollup` 导出报告。
5. 在 `/api/admin/experiments` 或对应运营前台做 spot check。
