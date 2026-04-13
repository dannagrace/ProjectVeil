# Config Deployment Safety

Use config hot reload only inside a planned safety window. The current runtime behavior is:

- schema-incompatible hot reloads are rejected before persistence with an explicit error
- compatible updates are delayed while any room still has an in-progress battle
- once the update applies, the server watches the configured rollback window (`CONFIG_ROLLBACK_WINDOW_MS`, default `120000` ms) for multiplayer runtime error spikes and rolls back automatically if the threshold is crossed

Recommended operator workflow:

1. Prefer the low-traffic deployment window between 03:00 and 05:00 local server time.
2. Confirm no high-priority live event, tournament, or guided playtest is running.
3. Check active room count and active battle count before publishing.
4. In Config Center, load the staged `diff-preview` for every document in the publish bundle and confirm the grouped `added / modified / removed` blast radius before enabling publish.
5. Publish config changes through Config Center staged publish rather than ad hoc file edits. The publish request should carry the latest `confirmedDiffHash` so drift between preview and publish is rejected.
6. Watch room/runtime errors for at least the configured rollback window after the update clears the battle gate.
7. If the publish remains pending because battles are still active, wait for settlement instead of forcing a room restart.

Rollback guidance:

- treat repeated room retirement, reconnect failure, or battle abort errors during the rollback watch window as a release blocker
- if auto-rollback triggers, stop further config publishes until the failing diff is isolated
- capture the rejected or rolled-back publish id in the release calendar so the next window starts from the last known good snapshot
