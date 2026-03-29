import { expect, test } from "@playwright/test";
import { buildRoomId, openRoom, pressTile, reloadAndExpectRecoveredSession, withSmokeDiagnostics } from "./smoke-helpers";

const PLAYER_ID = "player-1";

test("page reload restores the remote room session and preserves world state", async ({ page }, testInfo) => {
  const roomId = buildRoomId("e2e-reconnect");

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await openRoom(page, {
      roomId,
      playerId: PLAYER_ID,
      expectedMoveText: /Move 6\/6/
    });

  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*0/);

  await pressTile(page, 0, 1);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 5\/6/);

  await pressTile(page, 0, 0);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 4\/6/);

  await pressTile(page, 0, 0);
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);

    await reloadAndExpectRecoveredSession(page, {
      roomId,
      playerId: PLAYER_ID
    });

    await expect(page.getByTestId("hero-move")).toHaveText(/Move 4\/6/);
    await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);
  });
});
