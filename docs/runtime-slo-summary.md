# Runtime SLO Summary

`GET /api/runtime/slo-summary` condenses the Colyseus runtime health surface into one alert-friendly summary.

It aggregates the key fields operators keep checking by hand:

- room count
- reconnect backlog
- token-delivery queue latency
- action throughput
- gameplay, reconnect, and token-delivery error-rate snapshots

The endpoint supports:

- JSON: `/api/runtime/slo-summary`
- Markdown: `/api/runtime/slo-summary?format=markdown`
- plain text: `/api/runtime/slo-summary?format=text`

For PR or release evidence, use the CLI wrapper:

```bash
npm run release -- runtime:slo-summary -- \
  --server-url http://127.0.0.1:2567 \
  --profile pr_diagnostics
```

Default outputs:

- `artifacts/release-readiness/runtime-slo-summary-<short-sha>.json`
- `artifacts/release-readiness/runtime-slo-summary-<short-sha>.md`
- `artifacts/release-readiness/runtime-slo-summary-<short-sha>.txt`

## Threshold Recommendations

The summary evaluates three recommendation profiles:

- `local_smoke`
  - room count `>= 1`
  - reconnect backlog `<= 0` with `1` treated as warning
  - queue latency `<= 1000ms`, warning at `5000ms`
  - action throughput `>= 1/s`, warning below `0.25/s`
  - gameplay error rate `<= 5%`, warning at `10%`
  - reconnect error rate `<= 2%`, warning at `5%`
  - token-delivery error rate `<= 5%`, warning at `10%`
- `pr_diagnostics`
  - room count `>= 12`, warning below `8`
  - reconnect backlog `<= 0` with `1` treated as warning
  - queue latency `<= 500ms`, warning at `2000ms`
  - action throughput `>= 25/s`, warning below `15/s`
  - gameplay error rate `<= 2%`, warning at `5%`
  - reconnect error rate `<= 1%`, warning at `2%`
  - token-delivery error rate `<= 2%`, warning at `5%`
- `candidate_gate`
  - room count `>= 48`, warning below `32`
  - reconnect backlog `<= 0` with `1` treated as warning
  - queue latency `<= 250ms`, warning at `1000ms`
  - action throughput `>= 150/s`, warning below `120/s`
  - gameplay error rate `<= 1%`, warning at `3%`
  - reconnect error rate `= 0%`, warning at `1%`
  - token-delivery error rate `<= 1%`, warning at `3%`

These are recommendations, not a replacement for deeper debugging. The value is that PR comments, release packets, and local smoke captures now point at one stable contract instead of three separate runtime endpoints plus a manual scratchpad.
