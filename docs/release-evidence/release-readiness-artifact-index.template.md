# Release-Readiness Artifact Index

Use this template as the release-call catalog for `artifacts/release-readiness/`.

Copy one candidate-scoped copy into `artifacts/release-readiness/release-readiness-artifact-index-<candidate>-<short-sha>.md`. Keep it beside the manual evidence ledger while the release call is active. The goal is simple:

- point reviewers at the latest accepted packet
- keep one previous comparable packet for the same target surface
- record the exact artifact paths used for comparison

This file is an index, not proof. The linked JSON / Markdown artifacts remain the canonical evidence.

## Candidate

- Candidate: `rc-YYYY-MM-DD`
- Target surface: `h5 | wechat`
- Current revision: `<git-sha>`
- Previous comparable revision: `<git-sha>`
- Release owner: `<name>`
- Last updated: `<YYYY-MM-DDTHH:MM:SSZ>`

## Retention Rules

- Keep one `Current packet` for the active candidate revision.
- Keep one `Previous comparable packet` for the same target surface.
- Keep the linked manual evidence ledger while any row is still `pending` or `in-review`.
- After the new packet is accepted, move older superseded packets out of the working set by attaching them to the release PR / CI artifacts or deleting the local copy.
- Do not keep multiple unlabeled "latest" packets in `artifacts/release-readiness/`. Update this index when the current packet changes.

## Current Packet

| Artifact | Path | Notes |
| --- | --- | --- |
| Snapshot | `artifacts/release-readiness/release-readiness-<timestamp>.json` | Must match `Current revision`. |
| Manual evidence ledger | `artifacts/release-readiness/manual-release-evidence-owner-ledger-<candidate>-<short-sha>.md` | Required when manual sign-offs exist. |
| Gate summary | `artifacts/release-readiness/release-gate-summary-<short-sha>.json` | Use the same target surface recorded above. |
| Candidate-level evidence audit | `artifacts/release-readiness/candidate-evidence-audit-<candidate>-<short-sha>.json` | Must pass for this packet or carry only accepted warnings for the selected surface. |
| Cocos RC bundle | `artifacts/release-readiness/cocos-rc-evidence-bundle-<candidate>-<short-sha>.json` | Include paired checklist / blockers paths in notes when relevant. |
| Reconnect soak | `artifacts/release-readiness/colyseus-reconnect-soak-summary-<candidate>-<short-sha>.json` | Optional unless reconnect scope applies. |
| Persistence/content artifact | `artifacts/release-readiness/phase1-release-persistence-regression-<scope>.json` | Optional unless persistence or shipped content scope applies. |
| Dashboard | `artifacts/release-readiness/release-readiness-dashboard-<candidate>-<short-sha>.json` | Final reviewer summary. |
| Go/no-go packet | `artifacts/release-readiness/release-go-no-go-decision-packet-<candidate>-<short-sha>.json` | Final decision artifact. |

## Previous Comparable Packet

| Artifact | Path | Notes |
| --- | --- | --- |
| Snapshot | `artifacts/release-readiness/<previous-snapshot>.json` | Same target surface as the current packet. |
| Gate summary | `artifacts/release-readiness/<previous-gate-summary>.json` | Prefer the last accepted release-call packet, not an arbitrary older run. |
| Candidate-level evidence audit | `artifacts/release-readiness/<previous-audit>.json` | Optional when older packets predate the audit workflow. |
| Dashboard | `artifacts/release-readiness/<previous-dashboard>.json` | Use the packet reviewers actually referenced. |
| Go/no-go packet | `artifacts/release-readiness/<previous-decision-packet>.json` | Optional when the previous release call stopped before decision-packet generation. |

## Comparison Workflow

1. Pin the `Current packet` to one candidate revision and target surface.
2. Point `Previous comparable packet` at the last accepted packet for the same surface.
3. Compare the current and previous gate summaries first. If a gate regressed, refresh the current packet instead of editing notes around the regression.
4. Compare the same-candidate audit, dashboard, and any scope-specific artifacts such as reconnect soak or persistence regression.
5. Record the result in `Comparison notes` and update the release PR with the current packet paths.

## Comparison Notes

- Gate comparison: `<same | improved | regressed>`
- Scope-specific differences: `<wechat evidence refreshed | reconnect soak added | persistence unchanged>`
- Follow-up required: `<none | describe blocker>`
