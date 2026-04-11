# Project Veil Capacity Planning Summary
Generated at: 2026-04-11T16:32:04.758Z
Revision: e5e752d (codex/issue-1304-load-test-capacity-thresholds-0412-0019)
## Capacity Summary
- Safe limit per instance: 10 concurrent rooms
- Prometheus warning threshold: 8 active rooms
- First sampled latency breach: 50
- Scale-out trigger: Scale out when a single node sustains 8+ active rooms because that is 80% of the current 10-room safe limit.
- Estimated peak rooms per 1000 DAU: 50
- Estimated instance count per 1000 DAU: 5
- Estimated app-server cost per 1000 DAU: $240/month
## Sample Results
| Rooms | Status | Worst Scenario | P95 Latency (ms) | Max Latency (ms) | Peak CPU Core % | Peak RSS MB | Peak Heap MB | Avg Actions/s | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | passed | world_progression | 100.03 | 100.22 | 68.53 | 242.6 | 77.26 | 57.2 | within limit |
| 50 | failed | world_progression | 153.76 | 154.21 | 59.12 | 249.29 | 104.59 | 92.85 | p95 action latency breached 100ms |
| 100 | failed | world_progression | 333.16 | 334.34 | 57.98 | 318.45 | 128.71 | 123.03 | p95 action latency breached 100ms |
| 200 | failed | world_progression | 553.99 | 555.21 | 56.5 | 358.6 | 156.46 | 154.5 | p95 action latency breached 100ms |
## Assumptions
- Hard latency limit: p95 action latency must stay <= 100 ms.
- Cost estimate basis: $48/month per server instance.
- DAU planning basis: peak concurrent users = DAU * 0.1, 2 players per room.
