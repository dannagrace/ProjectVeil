import {
  e2eConfigFixtures,
  getHeroMoveTotal,
  getMineIncome,
  getNeutralBattleReward,
  getRecruitmentCount,
  getRecruitmentCost,
  getShrineVisitLogText,
  validateE2EConfigFixtures
} from "../tests/e2e/config-fixtures.ts";

function main(): void {
  validateE2EConfigFixtures();

  const reward = getNeutralBattleReward();
  const recruitmentCost = getRecruitmentCost();

  console.log(
    `[validate:e2e-config-fixtures] loaded heroes=${e2eConfigFixtures.world.heroes.length} buildings=${e2eConfigFixtures.mapObjects.buildings.length} neutralArmies=${e2eConfigFixtures.mapObjects.neutralArmies.length}`
  );
  console.log(
    `[validate:e2e-config-fixtures] player-1 move=${getHeroMoveTotal()} recruitCount=${getRecruitmentCount()} recruitGold=${recruitmentCost.gold} mineIncome=${getMineIncome()} shrine="${getShrineVisitLogText()}" battleReward=${reward.kind}+${reward.amount}`
  );
}

main();
