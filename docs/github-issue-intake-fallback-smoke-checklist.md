# GitHub Issue Intake Fallback Smoke Checklist

Use this checklist during a model outage or a scheduled drill to prove GitHub issue intake still works when the primary Claude-led path is unavailable.

Run the checklist against `dannagrace/ProjectVeil` and record the resulting issue URL in the incident log, drill notes, or handoff thread.

## Preconditions

- `gh auth status` succeeds for the operator who will create the issue
- the operator can reach `dannagrace/ProjectVeil`
- the repo's `ProjectVeil Ops Intake` template is still available in GitHub
- the operator has a short outage or drill note to link from the test issue body, or can record `unknown`

## Smoke Steps

- [ ] Confirm the fallback trigger is explicit: Claude is `unavailable`, `degraded`, or the drill is intentionally simulating that condition.
- [ ] Create a test issue with `gh issue create` using the `ProjectVeil Ops Intake` template or an equivalent non-interactive body with the same headings.
- [ ] Use a title that clearly marks the issue as fallback verification, for example `ops: fallback intake smoke check <YYYY-MM-DD>`.
- [ ] Verify the posted issue contains all required sections: `Summary`, `Problem`, `Proposed change`, `Acceptance criteria`, `Context`, and `Fallback / operator notes`.
- [ ] Verify the body records fallback provenance: Claude availability state and that GPT or the operator created the issue directly through the fallback path.
- [ ] Verify the issue includes enough metadata to triage without reopening the source chat:
  - summary describes the outage or drill purpose
  - problem states why the primary intake path was bypassed
  - proposed change states the fallback verification action that was taken
  - acceptance criteria describe what a successful fallback issue proves
  - context includes the trigger source, affected area, environment or branch, and an evidence link or `unknown`
- [ ] Verify the issue lands in the correct repository with the expected title prefix and no missing required headings.
- [ ] Add or confirm the follow-up routing note in the issue body or first comment:
  - whether the issue should remain open for tracking
  - whether it should be closed after the drill
  - who owns follow-up once the primary path recovers
- [ ] If the smoke issue is only a drill artifact, close it with a short comment linking back to the outage or drill record.

## Expected Outcome

The smoke check passes when all of the following are true:

- a fallback issue can be created without Claude
- the issue preserves the minimum intake metadata quality bar
- the fallback reason is auditable later
- follow-up ownership or closure routing is explicit

If any item fails, treat the fallback path as degraded and update the runbook before the next drill or outage.
