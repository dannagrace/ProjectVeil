import { expect, test } from "@playwright/test";
import {
  buildRoomId,
  expectHeroMoveSpent,
  fullMoveTextPattern,
  openRoom,
  pressTile,
  reloadAndExpectRecoveredSession,
  withSmokeDiagnostics
} from "./smoke-helpers";

const PLAYER_ID = "player-1";

test("page reload restores the remote room session and preserves world state", async ({ page }, testInfo) => {
  const roomId = buildRoomId("e2e-reconnect");

  await withSmokeDiagnostics(testInfo, [page], async () => {
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

    await reloadAndExpectRecoveredSession(page, {
      roomId,
      playerId: PLAYER_ID
    });

    await expectHeroMoveSpent(page, 2, PLAYER_ID);
    await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);
  });
});
