import { expect, test } from "./fixtures";
import {
  buildRoomId,
  expectHeroMoveSpent,
  fullMoveTextPattern,
  openRoom,
  pressTile,
  reloadAndExpectAuthoritativeConvergence,
  withSmokeDiagnostics
} from "./smoke-helpers";

const PLAYER_ID = "player-1";

test("reload replays predicted room state and converges back to the authoritative room before further actions", async (
  { page },
  testInfo
) => {
  const roomId = buildRoomId("e2e-reconnect-convergence");

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await test.step("setup: open the room and establish a visible world-state delta", async () => {
      await openRoom(page, {
        roomId,
        playerId: PLAYER_ID,
        expectedMoveText: fullMoveTextPattern(PLAYER_ID)
      });

      await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*0/);

      await pressTile(page, 0, 1);
      await expectHeroMoveSpent(page, 1, PLAYER_ID);

      await pressTile(page, 0, 0);
      await expectHeroMoveSpent(page, 2, PLAYER_ID);

      await pressTile(page, 0, 0);
      await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);
    });

    await test.step("disconnect and reconnect: reload into cached replay and wait for authoritative convergence", async () => {
      await reloadAndExpectAuthoritativeConvergence(page, {
        roomId,
        playerId: PLAYER_ID
      });
      await expectHeroMoveSpent(page, 2, PLAYER_ID);
      await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);
    });

    await test.step("post-reconnect: perform one more authoritative action", async () => {
      await pressTile(page, 1, 0);
      await expectHeroMoveSpent(page, 3, PLAYER_ID);
      await expect(page.getByTestId("event-log")).toContainText("Moved 1 steps", { timeout: 10_000 });
      await expect(page.getByTestId("room-next-action")).not.toContainText("等待权威");
    });
  });
});
