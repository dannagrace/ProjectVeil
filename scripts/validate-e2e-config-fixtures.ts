import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { EXTRA_CONTENT_PACK_MAP_PACKS } from "./content-pack-map-packs.ts";

function validateAdditionalMapPackFixtures(): void {
  for (const definition of EXTRA_CONTENT_PACK_MAP_PACKS) {
    for (const fileName of [definition.worldFileName, definition.mapObjectsFileName]) {
      JSON.parse(readFileSync(resolve(process.cwd(), "configs", fileName), "utf8")) as unknown;
    }
  }
}

function main(): void {
  validateE2EConfigFixtures();
  validateAdditionalMapPackFixtures();

  const reward = getNeutralBattleReward();
  const recruitmentCost = getRecruitmentCost();

  console.log(
    `[validate:e2e-config-fixtures] loaded heroes=${e2eConfigFixtures.world.heroes.length} buildings=${e2eConfigFixtures.mapObjects.buildings.length} neutralArmies=${e2eConfigFixtures.mapObjects.neutralArmies.length}`
  );
  console.log(
    `[validate:e2e-config-fixtures] additional map packs=${EXTRA_CONTENT_PACK_MAP_PACKS.map((definition) => definition.id).join(", ")}`
  );
  console.log(
    `[validate:e2e-config-fixtures] player-1 move=${getHeroMoveTotal()} recruitCount=${getRecruitmentCount()} recruitGold=${recruitmentCost.gold} mineIncome=${getMineIncome()} shrine="${getShrineVisitLogText()}" battleReward=${reward.kind}+${reward.amount}`
  );
}

main();
