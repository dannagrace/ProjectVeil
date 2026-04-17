# Project Veil On-call Roster

Use this template to publish the current LAUNCH-P2 duty rotation. Keep one active row per role and update the `handoffNotes` field when coverage changes mid-shift.

| role | primary | secondary | timezone | handoffNotes |
| --- | --- | --- | --- | --- |
| `ops-oncall` | `grace` | `backup-ops` | `Asia/Shanghai` | `Owns Grafana, Alertmanager, launch dashboards, and MTTA/MTTR follow-up.` |
| `server-oncall` | `runtime-owner` | `backend-backup` | `Asia/Shanghai` | `Owns room health, reconnects, maintenance mode, and rollback drills.` |
| `commerce-oncall` | `payments-owner` | `risk-backup` | `Asia/Shanghai` | `Owns WeChat/Apple/Google purchase incidents and compensations.` |
| `support-oncall` | `support-lead` | `moderation-backup` | `Asia/Shanghai` | `Owns tickets, reports, bans, mailbox comms, and GM escalations.` |
| `release-owner` | `release-oncall` | `qa-oncall` | `Asia/Shanghai` | `Owns go/no-go packet, incident bridge, and final sign-off.` |

## Weekly handoff checklist

1. Confirm each role has one reachable primary and one reachable backup.
2. Re-run `scripts/oncall-ack-audit.ts` against the latest incident export and review MTTA / MTTR drift.
3. Update PagerDuty schedule links, Slack channel links, and escalation aliases if they changed.
4. Record the handoff timestamp in the release log or incident channel.
