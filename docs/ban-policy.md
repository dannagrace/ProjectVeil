# Player Ban Policy

This document defines the minimum moderation standard for the current support slice.

## Enforcement Levels

### Warning

Use a warning when the behavior is disruptive but low-severity or first-time:

- abusive chat without targeted threats
- repeated AFK or surrender griefing
- spam reports that are not coordinated abuse

Actions:

- resolve the player report as `warned`
- add the case reference in the support system
- do not suspend account access

### Temporary Ban

Use a temporary ban when the behavior is repeated, harmful, or materially degrades matches:

- repeat harassment after warning
- repeated AFK griefing across multiple matches
- exploit abuse without clear automation
- payment abuse that looks reversible or under review

Suggested durations:

- 24 hours for first confirmed repeat offense
- 72 hours for second offense in 30 days
- 7 days for severe disruption without clear cheating evidence

Requirements:

- `support-moderator`, `support-supervisor`, or `admin` credentials may apply the ban
- temporary bans must include a clear `banReason`
- the player should receive the appeal entrypoint and expected SLA

### Permanent Ban

Use a permanent ban only for high-confidence, account-level abuse:

- confirmed botting or scripted automation
- chargeback fraud or account theft
- targeted harassment, threats, or severe repeated abuse
- ban evasion after prior enforcement

Requirements:

- only `support-supervisor` or `admin` credentials may apply the ban
- the request must include `approval.approvedBy` and `approval.approvalReference`
- the approval record should point to the internal ticket, chat thread, or case note that captured the second review

Current limitation:

- this slice records approval details inside the saved ban reason and response payload, but it does not yet provide a separate audited approval ledger

## Report Review Threshold

Automatic player reports should trigger manual review when either condition is met:

- 3 unique reporters target the same player within 24 hours
- 5 pending reports target the same player across 7 days

The current server stores reports and exposes them through `/api/admin/reports`; threshold-based queueing is still an operational workflow, not an automated gate.

## Appeals

- Primary intake: in-game support entry or WeChat service account
- Fallback intake: support email alias managed by operations
- First response SLA: 48 hours
- Final disposition target: 5 business days

Appeal outcomes:

- `uphold`: keep the enforcement and send rationale
- `reduce`: convert permanent to temporary or shorten duration
- `revoke`: remove the ban and restore access

Permanent-ban revocations must be handled by `support-supervisor` or `admin`.
